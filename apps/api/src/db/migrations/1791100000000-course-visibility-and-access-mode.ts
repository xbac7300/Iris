import { MigrationInterface, QueryRunner } from 'typeorm';

export class CourseVisibilityAndAccessMode1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS access_mode VARCHAR(20) NOT NULL DEFAULT 'PUBLIC';
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS share_code VARCHAR(64);
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS allowed_emails TEXT[] NOT NULL DEFAULT '{}';

      CREATE INDEX IF NOT EXISTS idx_courses_access_mode ON courses(access_mode);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_courses_access_mode;
      ALTER TABLE courses DROP COLUMN IF EXISTS allowed_emails;
      ALTER TABLE courses DROP COLUMN IF EXISTS share_code;
      ALTER TABLE courses DROP COLUMN IF EXISTS access_mode;
    `);
  }
}
