import { MigrationInterface, QueryRunner } from 'typeorm';

export class Enhancements1790500000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS thumbnail_url text NULL;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS disabled_until timestamptz NULL,
        ADD COLUMN IF NOT EXISTS disabled_reason text NULL;

      CREATE TABLE IF NOT EXISTS announcements (
        id uuid PRIMARY KEY,
        title text NOT NULL,
        message text NOT NULL,
        target_type text NOT NULL CHECK (target_type IN ('ALL', 'INSTRUCTOR', 'STUDENT', 'USER')),
        target_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS announcements_target_idx ON announcements(target_type, target_user_id);
      CREATE INDEX IF NOT EXISTS announcements_created_idx ON announcements(created_at DESC);

      CREATE TABLE IF NOT EXISTS announcement_reads (
        announcement_id uuid REFERENCES announcements(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (announcement_id, user_id)
      );
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback enhancements cần kế hoạch riêng.');
  }
}

