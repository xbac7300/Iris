const { test, before: beforeAll, after: afterAll } = require('node:test');
const { expect } = require('expect');
const request = require('supertest');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createDataSource } = require('../apps/api/dist/db/data-source');
const { createApp } = require('../apps/api/dist/app');
let db, app, api;
const password = 'Test-password-12345';
const origin = 'https://lms.example';
const input = (email) => ({ email, password, display_name: 'Người kiểm thử', client_type: 'mobile' });
const loginInput = (email) => ({ email, password, client_type: 'mobile' });
const bearer = result => `Bearer ${result.access_token}`;
const register = async (email) => (await api.post('/api/v1/auth/register').send(input(email)).expect(201)).body;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL?.endsWith('/lms_test')) throw new Error('Chỉ chạy trên database kiểm thử biệt lập.');
  db = await createDataSource(process.env.TEST_DATABASE_URL).initialize();
  const migrations = db.migrations;
  db.migrations = [migrations[0]];
  expect(await db.runMigrations()).toHaveLength(1);
  await db.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',
    [randomUUID(), 'upgrade-check@example.com', 'fixture-unused', 'Kiểm tra nâng cấp']);
  db.migrations = migrations;
  expect(await db.runMigrations()).toHaveLength(migrations.length - 1);
  expect(await db.query("SELECT id FROM users WHERE email='upgrade-check@example.com'")).toHaveLength(1);
  app = await createApp({ DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: randomBytes(48).toString('hex'),
    WEB_ORIGIN: origin, NODE_ENV: 'test', PORT: 4000 }, db);
  await app.init(); api = request(app.getHttpServer());
});
afterAll(async () => { if (app) await app.close(); if (db?.isInitialized) await db.destroy(); });

test('migration chạy lại không thay đổi dữ liệu', async () => {
  await register('migration@example.com');
  expect(await db.runMigrations()).toHaveLength(0);
  expect((await db.query('SELECT id FROM users WHERE email=$1', ['migration@example.com']))).toHaveLength(1);
});
test('đăng ký luôn Student, chặn role/owner từ body, email chuẩn hóa và trùng', async () => {
  const result = await register('Student@Example.com');
  expect(result.user.roles).toEqual(['STUDENT']); expect(result.user.email).toBe('student@example.com');
  await api.post('/api/v1/auth/register').send({ ...input('attacker@example.com'), roles: ['ADMIN'] }).expect(422);
  await api.post('/api/v1/auth/register').send(input('student@example.com')).expect(409);
  const [row] = await db.query('SELECT password_hash FROM users WHERE id=$1', [result.user.id]);
  expect(row.password_hash).not.toContain(password);
});
test('tài khoản sai trả 401; refresh hash và logout vô hiệu hóa access ngay', async () => {
  const result = await register('login@example.com');
  await api.post('/api/v1/auth/login').send({ ...loginInput('login@example.com'), password: 'Wrong-password-123' }).expect(401);
  await api.post('/api/v1/auth/login').send(loginInput('absent@example.com')).expect(401);
  const login = (await api.post('/api/v1/auth/login').send(loginInput('login@example.com')).expect(200)).body;
  expect(JSON.stringify(await db.query('SELECT * FROM refresh_tokens'))).not.toContain(login.refresh_token);
  await api.get('/api/v1/auth/me').set('Authorization', bearer(login)).expect(200);
  await api.post('/api/v1/auth/logout').set('Authorization', bearer(login)).expect(204);
  await api.get('/api/v1/auth/me').set('Authorization', bearer(login)).expect(401);
  await api.post('/api/v1/auth/refresh').send({ client_type: 'mobile', refresh_token: login.refresh_token }).expect(401);
  expect(result.user.id).toBe(login.user.id);
});
test('token đã dùng lại thu hồi cả phiên; refresh đồng thời chỉ có một thành công', async () => {
  const session = await register('rotation@example.com');
  const responses = await Promise.all([0, 1].map(() => api.post('/api/v1/auth/refresh')
    .send({ client_type: 'mobile', refresh_token: session.refresh_token })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
  const success = responses.find(r => r.status === 200).body;
  expect(success.refresh_token).not.toBe(session.refresh_token);
  await api.get('/api/v1/auth/me').set('Authorization', bearer(success)).expect(401);
});
test('refresh không gia hạn quá bảy ngày, token của sai transport bị từ chối', async () => {
  const session = await register('expires@example.com');
  const [before] = await db.query('SELECT expires_at FROM sessions WHERE user_id=$1', [session.user.id]);
  await api.post('/api/v1/auth/refresh').set('Origin', origin).set('X-CSRF-Protection', '1')
    .set('Cookie', `lms_refresh=${session.refresh_token}`).send({ client_type: 'web' }).expect(401);
  await api.post('/api/v1/auth/refresh').send({ client_type: 'mobile', refresh_token: session.refresh_token }).expect(200);
  const [after] = await db.query('SELECT expires_at FROM sessions WHERE user_id=$1', [session.user.id]);
  expect(after.expires_at).toEqual(before.expires_at);
});
test('web dùng cookie Secure HttpOnly; chặn thiếu CSRF và Origin khác', async () => {
  const body = { ...input('web@example.com'), client_type: 'web' };
  await api.post('/api/v1/auth/register').send(body).expect(403);
  const result = await api.post('/api/v1/auth/register').set('Origin', origin).set('X-CSRF-Protection', '1').send(body).expect(201);
  expect(result.body.refresh_token).toBeUndefined();
  const cookie = result.headers['set-cookie'][0];
  expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Strict');
  await api.post('/api/v1/auth/refresh').set('Origin', 'https://evil.example').set('X-CSRF-Protection', '1')
    .set('Cookie', cookie.split(';')[0]).send({ client_type: 'web' }).expect(403);
  await api.post('/api/v1/auth/refresh').set('Origin', origin).set('X-CSRF-Protection', '1')
    .set('Cookie', cookie.split(';')[0]).send({ client_type: 'web' }).expect(200);
  await api.post('/api/v1/auth/login').set('Origin', origin).send(loginInput('web@example.com')).expect(403);
});
test('Student không tạo/sửa; Instructor A không đọc/sửa nháp của B', async () => {
  const student = await register('s@example.com');
  const a = await register('a@example.com'); const b = await register('b@example.com');
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR'),($2,'INSTRUCTOR')", [a.user.id, b.user.id]);
  await api.post('/api/v1/courses').set('Authorization', bearer(student)).send({ title: 'Bị chặn' }).expect(403);
  const course = (await api.post('/api/v1/courses').set('Authorization', bearer(a)).send({ title: 'Python' }).expect(201)).body;
  expect(course.owner_id).toBe(a.user.id); expect(course.status).toBe('DRAFT');
  await api.post('/api/v1/courses').set('Authorization', bearer(a)).send({ title: 'Giả mạo', owner_id: b.user.id }).expect(422);
  await api.patch(`/api/v1/courses/${course.id}`).set('Authorization', bearer(student)).send({ title: 'Sai' }).expect(403);
  await api.patch(`/api/v1/courses/${course.id}`).set('Authorization', bearer(b)).send({ title: 'Sai' }).expect(404);
  await api.get(`/api/v1/courses/${course.id}`).set('Authorization', bearer(b)).expect(404);
  expect((await api.get('/api/v1/courses').set('Authorization', bearer(student)).expect(200)).body).toEqual([]);
  const updated = await api.patch(`/api/v1/courses/${course.id}`).set('Authorization', bearer(a)).send({ title: 'Python cơ bản' }).expect(200);
  expect(updated.body.title).toBe('Python cơ bản');
  await api.patch(`/api/v1/courses/${course.id}`).set('Authorization', bearer(a)).send({ status: 'PUBLISHED' }).expect(422);
  await api.get('/api/v1/courses?limit=9999').set('Authorization', bearer(a)).expect(422);
});
test('khóa tài khoản thu hồi các phiên và ghi audit; Student không gọi admin', async () => {
  const admin = await register('admin-test@example.com'); const user = await register('locked@example.com');
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'ADMIN')", [admin.user.id]);
  await api.post(`/api/v1/admin/users/${admin.user.id}/status`).set('Authorization', bearer(user)).send({ disabled: true }).expect(403);
  await api.post(`/api/v1/admin/users/${user.user.id}/status`).set('Authorization', bearer(admin)).send({ disabled: true }).expect(204);
  await api.get('/api/v1/auth/me').set('Authorization', bearer(user)).expect(401);
  await api.post('/api/v1/auth/login').send(loginInput('locked@example.com')).expect(401);
  expect(await db.query('SELECT id FROM audit_logs WHERE actor_id=$1 AND resource_id=$2', [admin.user.id, user.user.id])).toHaveLength(1);
  await api.post(`/api/v1/admin/users/${randomUUID()}/status`).set('Authorization', bearer(admin)).send({ disabled: true }).expect(404);
});

test('phiên hết hạn bị chặn cả access và refresh', async () => {
  const session = await register('expired@example.com');
  const payload = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
  expect(payload.exp - payload.iat).toBe(900);
  await db.query("UPDATE sessions SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE user_id=$1", [session.user.id]);
  await api.get('/api/v1/auth/me').set('Authorization', bearer(session)).expect(401);
  await api.post('/api/v1/auth/refresh').send({ client_type: 'mobile', refresh_token: session.refresh_token }).expect(401);
});

test('seed ba vai trò có thể chạy lại, không nâng quyền email đã đăng ký trước', async () => {
  const existing = await register('admin@lms.example');
  const runSeed = () => execFileSync(process.execPath, ['apps/api/dist/db/seed.js'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, SEED_PASSWORD: password },
    stdio: 'pipe', windowsHide: true,
  });
  runSeed(); runSeed();
  const rows = await db.query('SELECT role FROM user_roles WHERE user_id=$1', [existing.user.id]);
  expect(rows).toEqual([{ role: 'STUDENT' }]);
  expect(await db.query("SELECT id FROM users WHERE email IN ('student@lms.example','instructor@lms.example','admin@lms.example')")).toHaveLength(3);
  const instructor = (await api.post('/api/v1/auth/login').send(loginInput('instructor@lms.example')).expect(200)).body;
  expect(instructor.user.roles).toEqual(['INSTRUCTOR']);
});

require('./learning-checks.cjs')(() => ({db,api,register}));
