const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const request = require('supertest');
const { createDataSource } = require('../apps/api/dist/db/data-source');
const { createApp } = require('../apps/api/dist/app');
const { ObjectStorage, storageConfigSchema } = require('../packages/media-core/dist');
const { CreateBucketCommand, DeleteObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
const { MediaRuntime } = require('../apps/worker/dist/runtime');
let db, adminDb, app, api, storage, runtime, workerConfig, video;
let instructor, other, student, outsider;
let course, moduleRow, lesson, validUpload, validJob;
const suffix = randomUUID();
const password = 'Media-test-password-123';
const authorization = user => `Bearer ${user.access_token}`;
const send = (method, path, user, body) => {
  const call = api[method](`/api/v1/${path}`).set('Authorization', authorization(user));
  return body === undefined ? call : call.send(body);
};
async function register(name, role = 'STUDENT') {
  const response = await api.post('/api/v1/auth/register').send({ email: `${name}@media.example`, password,
    display_name: name, client_type: 'mobile' }).expect(201);
  if (role !== 'STUDENT') await db.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2)', [response.body.user.id, role]);
  return response.body;
}
async function uploadTo(targetLesson, data) {
  const result = await send('post', `lessons/${targetLesson.id}/upload-url`, instructor, { size_bytes: data.length }).expect(201);
  const response = await fetch(result.body.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: data });
  const body = await response.text();
  assert.equal(response.status, 200, body.match(/<Code>([^<]+)<\/Code>/)?.[1] || `S3 trả HTTP ${response.status}`);
  return result.body;
}
async function waitForJob(id, expected) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const result = await send('get', `jobs/${id}`, instructor).expect(200);
    if (result.body.status === expected) return result.body;
    if (result.body.status === 'FAILED' && expected !== 'FAILED') assert.fail(result.body.error_code);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.fail(`Job chưa đạt ${expected} trong thời gian kiểm thử.`);
}
before(async () => {
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname), 'Chỉ chạy media test trên DB local.');
  const storageUrl = new URL(process.env.S3_ENDPOINT);
  assert(['localhost', '127.0.0.1'].includes(storageUrl.hostname), 'Chỉ chạy media test trên S3 local.');
  adminDb = await createDataSource(dbUrl.toString()).initialize();
  const database = `lms_media_test_${Date.now()}`;
  await adminDb.query(`CREATE DATABASE "${database}"`);
  dbUrl.pathname = `/${database}`;
  db = await createDataSource(dbUrl.toString()).initialize(); await db.runMigrations();
  const config = storageConfigSchema.parse({ ...process.env, S3_BUCKET: `lms-test-${suffix}` });
  storage = new ObjectStorage(config); await storage.client.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  app = await createApp({ DATABASE_URL: dbUrl.toString(), JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: 'test', WEB_ORIGIN: 'http://localhost:3000', PORT: 4000 }, db, storage);
  await app.init(); api = request(app.getHttpServer());
  const python = process.env.PYTHON_EXECUTABLE || resolve('services/asr/.venv/Scripts/python.exe');
  const fixture = resolve('.local/test-fixtures/valid.mp4');
  execFileSync(python, ['services/asr/make_test_video.py', '--output', fixture], { windowsHide: true });
  video = readFileSync(fixture);
  workerConfig = { ...config, DATABASE_URL: dbUrl.toString(), REDIS_URL: process.env.REDIS_URL,
    MEDIA_QUEUE_NAME: `test-${suffix}`, PYTHON_EXECUTABLE: python,
    MEDIA_PROBE_SCRIPT: resolve('services/asr/probe.py'), MEDIA_TEMP_DIR: resolve(`.local/test-media-${suffix}`) };
  instructor = await register('owner', 'INSTRUCTOR'); other = await register('other', 'INSTRUCTOR');
  student = await register('student'); outsider = await register('outsider');
});
after(async () => {
  if (runtime) await runtime.close();
  if (workerConfig) {
    const { Queue } = require('bullmq');
    const { redisConnection } = require('../apps/worker/dist/config');
    const cleanup = new Queue(workerConfig.MEDIA_QUEUE_NAME, { connection: redisConnection(workerConfig.REDIS_URL) });
    try { await cleanup.obliterate({ force: true }); } finally { await cleanup.close(); }
  }
  if (storage && db?.isInitialized) {
    const assets = await db.query('SELECT upload_key,playback_key FROM media_assets');
    for (const asset of assets) for (const key of [asset.upload_key, asset.playback_key].filter(Boolean)) {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.config.S3_BUCKET, Key: key }));
    }
    await storage.client.send(new DeleteBucketCommand({ Bucket: storage.config.S3_BUCKET }));
  }
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy(); if (adminDb?.isInitialized) await adminDb.destroy();
});

test('tạo cấu trúc, kiểm tra owner và chặn xuất bản khi chưa có media', async () => {
  course = (await send('post', 'courses', instructor, { title: 'Khóa kiểm thử media' }).expect(201)).body;
  await send('post', `courses/${course.id}/publish`, instructor).expect(422);
  await send('post', `courses/${course.id}/modules`, other, { title: 'Sai quyền', position: 0 }).expect(404);
  moduleRow = (await send('post', `courses/${course.id}/modules`, instructor, { title: 'Chương 1', position: 0 }).expect(201)).body;
  const modules = await send('get', `courses/${course.id}/modules?limit=1`, instructor).expect(200);
  assert.equal(modules.body[0].id, moduleRow.id);
  await send('get', `courses/${course.id}/modules`, other).expect(404);
  await send('get', `courses/${course.id}/modules?limit=101`, instructor).expect(422);
  lesson = (await send('post', `modules/${moduleRow.id}/lessons`, instructor, { title: 'Bài 1', position: 0 }).expect(201)).body;
  await send('post', `modules/${moduleRow.id}/lessons`, instructor, { title: 'Trùng vị trí', position: 0 }).expect(409);
  await send('get', `courses/${course.id}/lessons`, student).expect(404);
  const page = await send('get', `courses/${course.id}/lessons?limit=1`, instructor).expect(200);
  assert.equal(page.body.length, 1); assert.equal(page.body[0].id, lesson.id);
  await send('get', `courses/${course.id}/lessons?limit=101`, instructor).expect(422);
  await send('post', `lessons/${lesson.id}/upload-url`, student, { size_bytes: 10 }).expect(403);
  await send('post', `lessons/${lesson.id}/upload-url`, other, { size_bytes: 10 }).expect(404);
});
test('upload-complete đồng thời tạo một job/outbox; reconcile khôi phục queue bị mất', async () => {
  validUpload = await uploadTo(lesson, video);
  const responses = await Promise.all([0, 1].map(() => send('post', `lessons/${lesson.id}/upload-complete`, instructor,
    { media_id: validUpload.media_id }).expect(202)));
  validJob = responses[0].body.job_id;
  assert.equal(responses[1].body.job_id, validJob);
  assert.equal((await db.query('SELECT id FROM outbox WHERE job_id=$1', [validJob])).length, 1);
  await send('get', `jobs/${validJob}`, other).expect(404);
  // Giả lập outbox đã gửi trước khi Redis mất job; không sửa dữ liệu ngoài DB test.
  await db.query('UPDATE outbox SET dispatched_at=now() WHERE job_id=$1', [validJob]);
  await db.query("UPDATE jobs SET updated_at=now()-interval '10 seconds' WHERE id=$1", [validJob]);
  runtime = new MediaRuntime(workerConfig); await runtime.start();
  await waitForJob(validJob, 'READY');
  await send('post', `lessons/${lesson.id}/upload-complete`, instructor, { media_id: validUpload.media_id }).expect(202);
});
test('video đã kiểm tra không bị ghi đè qua URL upload cũ', async () => {
  const result = await send('get', `lessons/${lesson.id}/playback`, instructor).expect(200);
  assert(result.body.duration_sec > 0);
  const tamper = await fetch(validUpload.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: Buffer.alloc(video.length) });
  assert.equal(tamper.status, 200); await tamper.arrayBuffer();
  const playback = await fetch(result.body.url);
  assert.equal(playback.status, 200); assert.deepEqual(Buffer.from(await playback.arrayBuffer()), video);
  const range = await fetch(result.body.url, { headers: { Range: 'bytes=4-7' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
});
test('publication đóng băng, enrollment đồng thời idempotent, archive giữ quyền cũ', async () => {
  const published = await send('post', `courses/${course.id}/publish`, instructor).expect(200);
  assert.equal(published.body.id, course.id); assert.equal(published.body.status, 'PUBLISHED');
  await send('get', `lessons/${lesson.id}/playback`, student).expect(404);
  const results = await Promise.all(Array.from({ length: 5 }, () => send('post', `courses/${course.id}/enrollments`, student).expect(200)));
  assert.equal(new Set(results.map(r => r.body.id)).size, 1);
  await send('get', `lessons/${lesson.id}/playback`, student).expect(200);
  await send('post', `courses/${course.id}/modules`, instructor, { title: 'Không đổi mẫu số', position: 1 }).expect(409);
  await send('post', `lessons/${lesson.id}/upload-url`, instructor, { size_bytes: 10 }).expect(409);
  const archived = await send('post', `courses/${course.id}/archive`, instructor).expect(200);
  assert.equal(archived.body.id, course.id); assert.equal(archived.body.status, 'ARCHIVED');
  await send('post', `courses/${course.id}/enrollments`, outsider).expect(404);
  await send('get', `lessons/${lesson.id}/playback`, student).expect(200);
  await db.query('UPDATE enrollments SET revoked_at=now() WHERE course_id=$1 AND user_id=$2', [course.id, student.user.id]);
  await send('get', `lessons/${lesson.id}/playback`, student).expect(404);
  await send('post', `courses/${course.id}/enrollments`, student).expect(403);
});
test('worker khởi động lại nhận outbox; file hỏng không retry vô hạn', async () => {
  await runtime?.close(); runtime = undefined;
  const draft = (await send('post', 'courses', instructor, { title: 'File hỏng' }).expect(201)).body;
  const m = (await send('post', `courses/${draft.id}/modules`, instructor, { title: 'Chương', position: 0 }).expect(201)).body;
  const l = (await send('post', `modules/${m.id}/lessons`, instructor, { title: 'Bài', position: 0 }).expect(201)).body;
  const upload = await uploadTo(l, Buffer.from('not an mp4'));
  const accepted = await send('post', `lessons/${l.id}/upload-complete`, instructor, { media_id: upload.media_id }).expect(202);
  runtime = new MediaRuntime(workerConfig); await runtime.start();
  const job = await waitForJob(accepted.body.job_id, 'FAILED');
  assert.equal(job.attempts, 1); assert.equal(job.retryable, false); assert.equal(job.error_code, 'INVALID_CONTAINER');
  await send('post', `jobs/${job.id}/retry`, instructor).expect(409);
  await send('post', `courses/${draft.id}/publish`, instructor).expect(422);
});

test('job bản cũ hoàn tất không đổi active media; source thay sau complete bị chặn', async () => {
  await runtime?.close(); runtime = undefined;
  const draft = (await send('post', 'courses', instructor, { title: 'Kiểm tra version' }).expect(201)).body;
  const m = (await send('post', `courses/${draft.id}/modules`, instructor, { title: 'Chương', position: 0 }).expect(201)).body;
  const l = (await send('post', `modules/${m.id}/lessons`, instructor, { title: 'Bài', position: 0 }).expect(201)).body;
  const abandoned = await uploadTo(l, video);
  const old = await uploadTo(l, video);
  await send('post', `lessons/${l.id}/upload-complete`, instructor, { media_id: abandoned.media_id }).expect(409);
  const oldJob = (await send('post', `lessons/${l.id}/upload-complete`, instructor, { media_id: old.media_id }).expect(202)).body.job_id;
  const current = await uploadTo(l, video);
  const currentJob = (await send('post', `lessons/${l.id}/upload-complete`, instructor, { media_id: current.media_id }).expect(202)).body.job_id;
  const changed = await fetch(current.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: Buffer.alloc(video.length) });
  assert.equal(changed.status, 200); await changed.arrayBuffer();
  runtime = new MediaRuntime(workerConfig); await runtime.start();
  await waitForJob(oldJob, 'READY');
  const failed = await waitForJob(currentJob, 'FAILED');
  assert.equal(failed.error_code, 'SOURCE_CHANGED'); assert.equal(failed.attempts, 1);
  const [stored] = await db.query('SELECT active_media_id FROM lessons WHERE id=$1', [l.id]);
  assert.equal(stored.active_media_id, current.media_id);
  await send('get', `lessons/${l.id}/playback`, instructor).expect(409);
});

test('lỗi tạm thời dừng sau 4 lượt; retry đồng thời chỉ tạo một generation mới', async () => {
  await runtime.close(); runtime = undefined;
  const draft = (await send('post', 'courses', instructor, { title: 'Retry tạm thời' }).expect(201)).body;
  const m = (await send('post', `courses/${draft.id}/modules`, instructor, { title: 'Chương', position: 0 }).expect(201)).body;
  const l = (await send('post', `modules/${m.id}/lessons`, instructor, { title: 'Bài', position: 0 }).expect(201)).body;
  const upload = await uploadTo(l, video);
  const { job_id } = (await send('post', `lessons/${l.id}/upload-complete`, instructor, { media_id: upload.media_id }).expect(202)).body;
  runtime = new MediaRuntime({ ...workerConfig, PYTHON_EXECUTABLE: resolve('.local/missing-python-test-only') });
  await runtime.start();
  const failed = await waitForJob(job_id, 'FAILED');
  assert.equal(failed.attempts, 4); assert.equal(failed.retryable, true);
  await runtime.close(); runtime = undefined;
  const retry = await Promise.all([0, 1].map(() => send('post', `jobs/${job_id}/retry`, instructor)));
  assert.deepEqual(retry.map(r => r.status).sort(), [202, 409]);
  assert.equal((await db.query('SELECT id FROM outbox WHERE job_id=$1 AND generation=1', [job_id])).length, 1);
  runtime = new MediaRuntime(workerConfig); await runtime.start();
  const ready = await waitForJob(job_id, 'READY');
  assert.equal(ready.generation, 1); assert.equal(ready.attempts, 1);
});
