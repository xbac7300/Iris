import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubmissionGrading1790800000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE attempts
        ADD COLUMN IF NOT EXISTS score numeric(5,2),
        ADD COLUMN IF NOT EXISTS instructor_feedback text,
        ADD COLUMN IF NOT EXISTS graded_at timestamptz,
        ADD COLUMN IF NOT EXISTS graded_by uuid REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_attempts_quiz_status ON attempts(quiz_id, status);
      CREATE INDEX IF NOT EXISTS idx_attempts_user_quiz ON attempts(user_id, quiz_id);
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE attempts
        DROP COLUMN IF EXISTS graded_by,
        DROP COLUMN IF EXISTS graded_at,
        DROP COLUMN IF EXISTS instructor_feedback,
        DROP COLUMN IF EXISTS score;
    `);
  }
}

