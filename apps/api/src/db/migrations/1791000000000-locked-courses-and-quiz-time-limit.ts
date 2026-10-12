import { MigrationInterface, QueryRunner } from 'typeorm';

export class LockedCoursesAndQuizTimeLimit1791000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS locked_reason TEXT;
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE quiz_versions ADD COLUMN IF NOT EXISTS time_limit_minutes INT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_courses_is_locked ON courses(is_locked);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_courses_is_locked;
      ALTER TABLE courses DROP COLUMN IF EXISTS is_locked;
      ALTER TABLE courses DROP COLUMN IF EXISTS locked_at;
      ALTER TABLE courses DROP COLUMN IF EXISTS locked_reason;
      ALTER TABLE courses DROP COLUMN IF EXISTS locked_by;
      ALTER TABLE quiz_versions DROP COLUMN IF EXISTS time_limit_minutes;
    `);
  }
}
