import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { createDataSource } = require('../apps/api/dist/db/data-source');
const { createApp } = require('../apps/api/dist/app');
const { ObjectStorage, storageConfigSchema } = require('../packages/media-core/dist');
const { workerConfigSchema } = require('../apps/worker/dist/config');
const { MediaRuntime } = require('../apps/worker/dist/runtime');

// Chỉ demo trên dịch vụ local; video không được gửi ra nhà cung cấp bên ngoài.
for (const key of ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT']) {
  assert(['localhost', '127.0.0.1'].includes(new URL(process.env[key]).hostname), `${key} phải là local.`);
}
assert(process.argv[2], 'Cần đường dẫn video local.');
const source = resolve(process.argv[2]);
const data = await readFile(source);
const db = await createDataSource(process.env.DATABASE_URL).initialize();
const storage = new ObjectStorage(storageConfigSchema.parse(process.env));
const app = await createApp({ ...process.env, PORT: 0 }, db, storage);
const worker = new MediaRuntime(workerConfigSchema.parse(process.env));
let token;
let base;
async function call(method, path, body) {
  const response = await fetch(`${base}/${path}`, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  assert(response.ok, `API ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
try {
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1`;
  await worker.start();
  token = (await call('POST', 'auth/login', { email: 'instructor@lms.example', password: process.env.SEED_PASSWORD, client_type: 'mobile' })).access_token;
  const course = await call('POST', 'courses', { title: 'Demo video local — Course Overview' });
  const module = await call('POST', `courses/${course.id}/modules`, { title: 'Giới thiệu', position: 0 });
  const lesson = await call('POST', `modules/${module.id}/lessons`, { title: 'Course Overview', position: 0 });
  const upload = await call('POST', `lessons/${lesson.id}/upload-url`, { size_bytes: data.length });
  const sent = await fetch(upload.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: data, signal: AbortSignal.timeout(120000) });
  assert.equal(sent.status, 200); await sent.arrayBuffer();
  const { job_id } = await call('POST', `lessons/${lesson.id}/upload-complete`, { media_id: upload.media_id });
  console.log('Đã upload local; đang chờ worker kiểm tra toàn bộ video.');
  const deadline = Date.now() + 360000;
  let job;
  do {
    job = await call('GET', `jobs/${job_id}`);
    assert.notEqual(job.status, 'FAILED', job.error_code);
    if (job.status === 'READY') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  assert.equal(job.status, 'READY', 'Worker chưa READY trong thời hạn demo.');
  const playback = await call('GET', `lessons/${lesson.id}/playback`);
  const range = await fetch(playback.url, { headers: { Range: 'bytes=4-7' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
  const result = { checked_at: new Date().toISOString(), course_id: course.id, lesson_id: lesson.id,
    media_id: upload.media_id, job_id, bytes: data.length, source_sha256: createHash('sha256').update(data).digest('hex'),
    duration_sec: playback.duration_sec, status: job.status, http_range: 206, course_status: 'DRAFT',
    ai_status: playback.ai_status, source_license: 'Chưa được xác nhận; chỉ dùng local, không phân phối.' };
  await mkdir('.local', { recursive: true });
  await writeFile('.local/demo-media.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (token) await call('POST', 'auth/logout').catch(() => {});
  await worker.close(); await app.close(); await db.destroy();
}
