import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp, createOpenApi } from './app';
import { createDataSource } from './db/data-source';

async function main(): Promise<void> {
  // Chỉ đọc metadata controller, không kết nối hoặc thay đổi database.
  const config = { DATABASE_URL: 'postgresql://unused/unused', JWT_SECRET: 'schema-only-'.repeat(8),
    WEB_ORIGIN: 'http://localhost:3000', NODE_ENV: 'test' as const, PORT: 4000 };
  const app = await createApp(config, createDataSource(config.DATABASE_URL));
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/openapi.json', JSON.stringify(createOpenApi(app), null, 2) + '\n');
  await app.close();
}
void main();
