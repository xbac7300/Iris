import EmbeddedPostgres from 'embedded-postgres';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const { createDataSource } = require('../../apps/api/dist/db/data-source.js');
const { createApp } = require('../../apps/api/dist/app.js');
const { hashPassword } = require('../../apps/api/dist/auth/password.js');

export default async function setup() {
  const directory = resolve('.local', `postgres-e2e-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  const password = randomBytes(24).toString('hex');
  // Windows/Hyper-V có thể giữ cổng cố định sau restart; để OS chọn cổng khả dụng.
  const port = await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(() => resolve(address.port)); });
  });
  let postgresOutput = '';
  const pg = new EmbeddedPostgres({ databaseDir: directory, port, user: 'lms_test', password,
    persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'],
    onLog: value => { postgresOutput = (postgresOutput + String(value)).slice(-2000); },
    onError: value => { postgresOutput = (postgresOutput + String(value)).slice(-2000); }, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  let app, db, web, storage, runtime, queueName;
  const media = process.env.E2E_MEDIA === '1';
  let started = false;
  const cleanup = async () => {
    if (web?.pid && web.exitCode === null) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(web.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      else web.kill('SIGTERM');
    }
    if (runtime) await runtime.close();
    if (queueName) {
      const { Queue } = require('bullmq'); const { redisConnection } = require('../../apps/worker/dist/config');
      const queue = new Queue(queueName, { connection: redisConnection(process.env.REDIS_URL) });
      try { await queue.obliterate({ force: true }); } finally { await queue.close(); }
    }
    if (storage && db?.isInitialized) {
      const { ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
      const Bucket = storage.config.S3_BUCKET;
      // Bucket UUID chỉ chứa fixture của lần kiểm thử này.
      const objects = await storage.client.send(new ListObjectsV2Command({ Bucket }));
      for (const object of objects.Contents ?? []) await storage.client.send(new DeleteObjectCommand({ Bucket, Key: object.Key }));
      await storage.client.send(new DeleteBucketCommand({ Bucket }));
    }
    if (app) await app.close(); if (db?.isInitialized) await db.destroy(); if (started) await pg.stop();
  };
  try {
    await pg.initialise(); await pg.start(); started = true; await pg.createDatabase('lms_test');
    const url = `postgresql://lms_test:${password}@127.0.0.1:${port}/lms_test`;
    db = await createDataSource(url).initialize(); await db.runMigrations();
    const id = randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',
      [id, 'instructor@e2e.example', await hashPassword('E2E-only-password-123'), 'Giảng viên thử nghiệm']);
    await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR')", [id]);
    if (media) {
      const { ObjectStorage, storageConfigSchema } = require('../../packages/media-core/dist');
      const { CreateBucketCommand } = require('@aws-sdk/client-s3');
      if (!['localhost','127.0.0.1'].includes(new URL(process.env.S3_ENDPOINT).hostname)) throw new Error('E2E chỉ dùng S3 local.');
      if (!['localhost','127.0.0.1'].includes(new URL(process.env.REDIS_URL).hostname)) throw new Error('E2E chỉ dùng Redis local.');
      storage = new ObjectStorage(storageConfigSchema.parse({ ...process.env, S3_BUCKET: `lms-e2e-${randomUUID()}` }));
      await storage.client.send(new CreateBucketCommand({ Bucket: storage.config.S3_BUCKET }));
      await storage.configureBrowser('http://localhost:3300');
      const python = process.env.PYTHON_EXECUTABLE || resolve('services/asr/.venv/Scripts/python.exe');
      execFileSync(python, ['services/asr/make_test_video.py', '--output', '.local/test-fixtures/browser.mp4'], { windowsHide: true });
      const { MediaRuntime } = require('../../apps/worker/dist/runtime');
      queueName = `e2e-${randomUUID()}`;
      runtime = new MediaRuntime({ ...storage.config, DATABASE_URL: url, REDIS_URL: process.env.REDIS_URL, MEDIA_QUEUE_NAME: queueName,
        PYTHON_EXECUTABLE: python, MEDIA_PROBE_SCRIPT: resolve('services/asr/probe.py'), MEDIA_TEMP_DIR: resolve(`.local/${queueName}`) });
      await runtime.start();
    }
    app = await createApp({ DATABASE_URL: url, JWT_SECRET: randomBytes(48).toString('hex'), WEB_ORIGIN: 'http://localhost:3300', NODE_ENV: 'test', PORT: 4300 }, db, storage ?? null);
    await app.listen(4300, '127.0.0.1');
    web = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '--port', '3300'], {
      cwd: resolve('apps/web'), env: { ...process.env, NEXT_PUBLIC_API_URL: 'http://localhost:4300', NEXT_TELEMETRY_DISABLED: '1' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    web.stdout.on('data', chunk => { output = (output + chunk).slice(-5000); });
    web.stderr.on('data', chunk => { output = (output + chunk).slice(-5000); });
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch('http://localhost:3300')).ok) return cleanup; } catch { /* Chờ server khởi động. */ }
      if (web.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Web không sẵn sàng: ${output}`);
  } catch (error) { await cleanup(); throw error ?? new Error(`PostgreSQL E2E không khởi động: ${postgresOutput}`); }
}
