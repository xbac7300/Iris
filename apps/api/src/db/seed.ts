import { randomUUID } from 'node:crypto';
import { createDataSource } from './data-source';
import { hashPassword } from '../auth/password';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed demo không chạy ở production.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.startsWith('REPLACE_') || password.length < 12 || !process.env.DATABASE_URL) throw new Error('Cần DATABASE_URL và SEED_PASSWORD dài ít nhất 12 ký tự.');
  const db = await createDataSource(process.env.DATABASE_URL).initialize();
  try {
    const hash = await hashPassword(password);
    await db.transaction(async tx => {
      for (const role of ['STUDENT', 'INSTRUCTOR', 'ADMIN']) {
        const rows = await tx.query(`INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)
          ON CONFLICT(email) DO NOTHING RETURNING id`, [randomUUID(), `${role.toLowerCase()}@lms.example`, hash, `Tài khoản ${role}`]);
        // Không nâng quyền tài khoản trùng email đã tồn tại trước seed.
        if (rows[0]) await tx.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2)', [rows[0].id, role]);
      }
    });
    console.log('Seed hoàn tất; tài khoản đã tồn tại được giữ nguyên.');
  } finally { await db.destroy(); }
}
void main().catch(() => { console.error('Seed thất bại; kiểm tra cấu hình và migration.'); process.exitCode = 1; });
