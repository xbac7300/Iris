import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env') || existsSync('.local/s3.json')) throw new Error('Đã có cấu hình local; không ghi đè.');
mkdirSync('.local', { recursive: true });
const databasePassword = randomBytes(24).toString('hex');
const accessKey = randomBytes(12).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const content = [
  'NODE_ENV=development', `DATABASE_URL=postgresql://lms:${databasePassword}@localhost:5432/lms`,
  `POSTGRES_PASSWORD=${databasePassword}`, `JWT_SECRET=${randomBytes(48).toString('hex')}`,
  'WEB_ORIGIN=http://localhost:3000', 'PORT=4000', 'API_PUBLIC_URL=http://localhost:4000',
  'REDIS_URL=redis://localhost:6379', 'S3_ENDPOINT=http://localhost:8333', 'S3_BUCKET=lms-private', 'S3_REGION=us-east-1',
  `PYTHON_EXECUTABLE=services/asr/.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`,
  'MEDIA_PROBE_SCRIPT=services/asr/probe.py', 'MEDIA_TEMP_DIR=.local/media-temp', 'MEDIA_QUEUE_NAME=media',
  `S3_ACCESS_KEY=${accessKey}`, `S3_SECRET_KEY=${secretKey}`, `SEED_PASSWORD=${randomBytes(18).toString('hex')}`,
];
writeFileSync('.env', content.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync('.local/s3.json', JSON.stringify({ identities: [{ name: 'lms-server',
  credentials: [{ accessKey, secretKey }], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] }] }, null, 2), { flag: 'wx', mode: 0o600 });
console.log('Đã tạo cấu hình local riêng, không in secret. Mở .env tại máy để xem mật khẩu seed.');
