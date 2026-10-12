import { MigrationInterface, QueryRunner } from 'typeorm';

export class CourseTags1790300000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS tag text NOT NULL DEFAULT 'CNTT & Phần mềm';
      CREATE INDEX IF NOT EXISTS courses_tag_idx ON courses(tag);
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback course tags cần kế hoạch riêng.');
  }
}

