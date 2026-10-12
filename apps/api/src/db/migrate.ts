import { createDataSource } from './data-source';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL.');
  const db = await createDataSource(process.env.DATABASE_URL).initialize();
  try {
    const migrations = await db.runMigrations();
    console.log(`Đã áp dụng ${migrations.length} migration.`);
  } finally { await db.destroy(); }
}
void main().catch(() => { console.error('Migration thất bại; kiểm tra kết nối và trạng thái schema.'); process.exitCode = 1; });
