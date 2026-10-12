import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduleRangeReason1790600000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS scheduled_until timestamptz NULL,
        ADD COLUMN IF NOT EXISTS action_reason text NULL;
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback schedule range & reason cần kế hoạch riêng.');
  }
}

