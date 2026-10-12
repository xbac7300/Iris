import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Queue, Worker, Job, UnrecoverableError } from 'bullmq';
import { ObjectStorage } from '@lms/media-core';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WorkerConfig, redisConnection } from './config';

const execute = promisify(execFile);
type JobData = { jobId: string; generation: number };
export class MediaRuntime {
  readonly db: DataSource;
  readonly queue: Queue;
  readonly storage: ObjectStorage;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;
  constructor(private readonly config: WorkerConfig) {
    this.db = new DataSource({ type: 'postgres', url: config.DATABASE_URL, synchronize: false, logging: false,
      extra: { max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 } });
    this.storage = new ObjectStorage(config);
    this.queue = new Queue(config.MEDIA_QUEUE_NAME, { connection: { ...redisConnection(config.REDIS_URL), commandTimeout: 5000 } });
    this.queue.on('error', () => console.error('Kết nối queue tạm thời lỗi.'));
  }
  async start(): Promise<void> {
    await this.db.initialize();
    await mkdir(resolve(this.config.MEDIA_TEMP_DIR), { recursive: true });
    await this.queue.waitUntilReady();
    this.worker = new Worker(this.config.MEDIA_QUEUE_NAME, job => this.process(job), {
      connection: redisConnection(this.config.REDIS_URL), concurrency: 1, lockDuration: 60000, stalledInterval: 15000, maxStalledCount: 3,
    });
    this.worker.on('error', () => console.error('Worker gặp lỗi kết nối, sẽ thử phục hồi.'));
    this.timer = setInterval(() => { void this.poll(); }, 2000);
    await this.poll();
  }
  async poll(): Promise<void> {
    if (this.closing) return;
    if (this.polling) return this.polling;
    this.polling = this.dispatchAndReconcile().catch(() => {
      console.error('Outbox chưa gửi được; giữ dữ liệu để thử lại.');
    }).finally(() => { this.polling = undefined; });
    return this.polling;
  }
  private queueId(jobId: string, generation: number): string { return `${jobId}-${generation}`; }
  private async enqueue(jobId: string, generation: number): Promise<void> {
    await this.queue.add('validate-media', { jobId, generation }, {
      jobId: this.queueId(jobId, generation), attempts: 4, backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 },
    });
  }
  private async dispatchAndReconcile(): Promise<void> {
    await this.db.transaction(async tx => {
      const rows = await tx.query(`SELECT o.* FROM outbox o JOIN jobs j ON j.id=o.job_id
        WHERE o.dispatched_at IS NULL AND o.generation=j.generation ORDER BY o.created_at
        LIMIT 20 FOR UPDATE OF o SKIP LOCKED`);
      for (const row of rows) {
        await this.enqueue(row.job_id, row.generation);
        await tx.query('UPDATE outbox SET dispatched_at=now() WHERE id=$1', [row.id]);
      }
    });
    // Nếu Redis mất queue sau khi outbox ACK, phục hồi từ trạng thái chuẩn trong DB.
    const pending = await this.db.query(`SELECT id,generation FROM jobs WHERE status IN ('PENDING','RUNNING')
      AND (lease_until IS NULL OR lease_until < now()) AND updated_at < now()-interval '5 seconds'
      ORDER BY updated_at LIMIT 50`);
    for (const row of pending) {
      const queued = await this.queue.getJob(this.queueId(row.id, row.generation));
      if (queued) {
        const state = await queued.getState();
        if (state !== 'completed' && state !== 'failed') continue;
        await queued.remove();
      }
      await this.enqueue(row.id, row.generation);
    }
  }
  private async claim(data: JobData, lease: string) {
    return this.db.transaction(async tx => {
      const [job] = await tx.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [data.jobId]);
      if (!job || job.generation !== data.generation || ['READY','FAILED'].includes(job.status)
        || (job.lease_until && new Date(job.lease_until).getTime() > Date.now())) return null;
      if (job.attempts >= 4) {
        await tx.query("UPDATE jobs SET status='FAILED',error_code='RETRY_EXHAUSTED',lease_id=NULL,lease_until=NULL WHERE id=$1", [job.id]);
        await tx.query("UPDATE media_assets SET status='FAILED',error_code='RETRY_EXHAUSTED' WHERE id=$1 AND status<>'READY'", [job.media_id]);
        return null;
      }
      await tx.query("UPDATE jobs SET status='RUNNING',attempts=attempts+1,lease_id=$1,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=$2", [lease, job.id]);
      const [asset] = await tx.query('SELECT * FROM media_assets WHERE id=$1', [job.media_id]);
      return asset;
    });
  }
  private async process(job: Job<JobData>): Promise<void> {
    const { jobId, generation } = job.data;
    if (!/^[a-f0-9-]{36}$/i.test(jobId) || !Number.isInteger(generation)) throw new UnrecoverableError('INVALID_JOB');
    const lease = randomUUID();
    const asset = await this.claim(job.data, lease);
    if (!asset) return;
    const heartbeat = setInterval(() => {
      void this.db.query("UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_id=$2 AND generation=$3", [jobId, lease, generation]).catch(() => {});
    }, 10000);
    const root = resolve(this.config.MEDIA_TEMP_DIR);
    let directory: string | undefined;
    const playbackKey = `media/${asset.id}/${lease}.mp4`;
    let promoted = false;
    let committed = false;
    try {
      directory = await mkdtemp(join(root, `${jobId}-`));
      const file = join(directory, 'video.mp4');
      const signal = AbortSignal.timeout(180000);
      const source = await this.storage.client.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET,
        Key: asset.upload_key, IfMatch: asset.source_etag }), { abortSignal: signal });
      if (source.ContentLength !== Number(asset.expected_bytes) || !source.Body) {
        (source.Body as Readable | undefined)?.destroy();
        throw new UnrecoverableError('SOURCE_CHANGED');
      }
      let received = 0;
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(received > Number(asset.expected_bytes) ? new Error('SOURCE_CHANGED') : null, chunk);
      } });
      await pipeline(source.Body as Readable, limiter, createWriteStream(file, { flags: 'wx' }), { signal });
      if ((await stat(file)).size !== Number(asset.expected_bytes)) throw new UnrecoverableError('SOURCE_CHANGED');
      const { stdout } = await execute(this.config.PYTHON_EXECUTABLE, [resolve(this.config.MEDIA_PROBE_SCRIPT),
        '--input', file, '--max-bytes', String(this.config.UPLOAD_MAX_BYTES), '--max-duration', String(this.config.UPLOAD_MAX_DURATION_SEC)],
      { shell: false, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout) as { ok: boolean; duration_sec: number; code?: string };
      if (!result.ok) throw new UnrecoverableError(result.code ?? 'INVALID_MEDIA');
      if (!Number.isFinite(result.duration_sec) || result.duration_sec <= 0 || result.duration_sec > this.config.UPLOAD_MAX_DURATION_SEC) throw new UnrecoverableError('INVALID_DURATION');
      // Key phục vụ playback tách khỏi key mà URL upload cho phép ghi.
      await this.storage.client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: playbackKey,
        Body: createReadStream(file), ContentLength: received, ContentType: 'video/mp4' }), { abortSignal: AbortSignal.timeout(180000) });
      promoted = true;
      committed = await this.db.transaction(async tx => {
        const [current] = await tx.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
        if (current.lease_id !== lease || current.generation !== generation || current.status !== 'RUNNING') return false;
        await tx.query("UPDATE media_assets SET status='READY',playback_key=$1,duration_sec=$2,actual_bytes=$3,error_code=NULL WHERE id=$4", [playbackKey, result.duration_sec, received, asset.id]);
        await tx.query("UPDATE jobs SET status='READY',error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [jobId]);
        await tx.query("INSERT INTO ai_tasks(id,media_id,stage,job_key) VALUES($1,$2,'ASR',$3) ON CONFLICT(job_key) DO NOTHING", [randomUUID(),asset.id,`${asset.id}/asr/small-v1`]);
        return true;
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode;
      const permanent = error instanceof UnrecoverableError || status === 404 || status === 412;
      const code = error instanceof UnrecoverableError ? error.message : permanent ? 'SOURCE_CHANGED' : 'MEDIA_PROCESSING_ERROR';
      await this.db.transaction(async tx => {
        const [current] = await tx.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
        if (current.lease_id !== lease || current.generation !== generation) return;
        const failed = permanent || current.attempts >= 4;
        await tx.query('UPDATE jobs SET status=$1,error_code=$2,retryable=$3,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$4', [failed ? 'FAILED' : 'PENDING', code, !permanent, jobId]);
        if (failed) await tx.query("UPDATE media_assets SET status='FAILED',error_code=$1 WHERE id=$2", [code, asset.id]);
      });
      if (permanent) throw new UnrecoverableError(code);
      throw new Error(code);
    } finally {
      clearInterval(heartbeat);
      if (promoted && !committed) {
        // COMMIT có thể thành công dù mất phản hồi; chỉ dọn khi DB xác nhận không dùng object.
        const referenced = await this.db.query('SELECT id FROM media_assets WHERE playback_key=$1', [playbackKey]).catch(() => null);
        if (referenced?.length === 0) await this.storage.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: playbackKey })).catch(() => {});
      }
      if (directory) {
        const child = relative(root, directory);
        if (!child.startsWith('..') && child.startsWith(`${jobId}-`)) await rm(directory, { recursive: true, force: true });
      }
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.polling; await this.worker?.close(); await this.queue.close();
    this.storage.close();
    if (this.db.isInitialized) await this.db.destroy();
  }
}
