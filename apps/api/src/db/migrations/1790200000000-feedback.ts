import { MigrationInterface, QueryRunner } from 'typeorm';

export class Feedback1790200000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE course_feedback (
        id uuid PRIMARY KEY,
        course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(course_id, user_id)
      );
      CREATE INDEX course_feedback_course_idx ON course_feedback(course_id, created_at DESC);

      CREATE TABLE course_likes (
        course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (course_id, user_id)
      );
      CREATE INDEX course_likes_course_idx ON course_likes(course_id);
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback feedback cần kế hoạch riêng.');
  }
}

