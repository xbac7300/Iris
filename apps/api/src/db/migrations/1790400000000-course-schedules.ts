import { MigrationInterface, QueryRunner } from 'typeorm';

export class CourseSchedules1790400000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS scheduled_action text NULL CHECK (scheduled_action IN ('PUBLISH','ARCHIVE','DELETE')),
        ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NULL;
      CREATE INDEX IF NOT EXISTS courses_schedule_idx ON courses(scheduled_at) WHERE scheduled_action IS NOT NULL;
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback course schedules cần kế hoạch riêng.');
  }
}

