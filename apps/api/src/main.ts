import { createApp, createOpenApi } from './app';
import { readConfig } from './config';
import { createDataSource } from './db/data-source';
import { SwaggerModule } from '@nestjs/swagger';
import { ObjectStorage, storageConfigSchema } from '@lms/media-core';

async function main(): Promise<void> {
  const config = readConfig();
  const storageConfig = storageConfigSchema.parse(process.env);
  const db = await createDataSource(config.DATABASE_URL).initialize();
  const storage = new ObjectStorage(storageConfig);
  try { await storage.configureBrowser(config.WEB_ORIGIN); } catch { /* ignore */ }
  const app = await createApp(config, db, storage);
  if (config.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, createOpenApi(app));
  const close = async () => { await app.close(); if (db.isInitialized) await db.destroy(); };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await app.listen(config.PORT, '0.0.0.0');
  console.log(`API sẵn sàng tại cổng ${config.PORT}.`);
}
void main().catch((err) => { console.error('Không khởi động được API:', err); process.exitCode = 1; });
