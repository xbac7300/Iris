import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChapterQuizzesAndTypes1790700000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE quiz_versions
        ADD COLUMN IF NOT EXISTS module_id uuid REFERENCES modules(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE;

      ALTER TABLE questions
        ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'MULTIPLE_CHOICE'
        CHECK(question_type IN ('MULTIPLE_CHOICE', 'ESSAY', 'FILE_UPLOAD'));

      ALTER TABLE attempt_answers
        ADD COLUMN IF NOT EXISTS text_response text,
        ADD COLUMN IF NOT EXISTS file_url text,
        ADD COLUMN IF NOT EXISTS file_name text;

      CREATE INDEX IF NOT EXISTS idx_quiz_versions_module_id ON quiz_versions(module_id);
      CREATE INDEX IF NOT EXISTS idx_quiz_versions_lesson_id ON quiz_versions(lesson_id);
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE attempt_answers
        DROP COLUMN IF EXISTS file_name,
        DROP COLUMN IF EXISTS file_url,
        DROP COLUMN IF EXISTS text_response;

      ALTER TABLE questions
        DROP COLUMN IF EXISTS question_type;

      ALTER TABLE quiz_versions
        DROP COLUMN IF EXISTS lesson_id,
        DROP COLUMN IF EXISTS module_id;
    `);
  }
}

