import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const databaseDir = resolve('.local', `postgres-test-${Date.now()}`);
mkdirSync(databaseDir, { recursive: true });
const password = randomBytes(24).toString('hex');
const pg = new EmbeddedPostgres({ databaseDir, port, user: 'lms_test', password, persistent: true,
  authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
let started = false;
let exitCode = 1;
try {
  await pg.initialise(); await pg.start(); started = true;
  await pg.createDatabase('lms_test');
  console.log('PostgreSQL thật đã khởi động trong thư mục test riêng.');
  const child = spawn(process.execPath, ['--test', 'tests/auth.integration.cjs'], {
    stdio: 'inherit', env: { ...process.env,
      TEST_DATABASE_URL: `postgresql://lms_test:${password}@127.0.0.1:${port}/lms_test` }, windowsHide: true,
  });
  exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Không chạy được integration test.');
} finally {
  if (started) await pg.stop();
}
// async-exit-hook của embedded-postgres gán 0 khi beforeExit; truyền mã thoát rõ ràng.
process.exit(exitCode);
