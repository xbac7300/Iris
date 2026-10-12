import { MigrationInterface, QueryRunner } from 'typeorm';

export class Media1790035201000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE courses ADD COLUMN structure_locked_at timestamptz;
      CREATE TABLE modules (
        id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id), title text NOT NULL,
        position integer NOT NULL CHECK(position >= 0), UNIQUE(course_id,position), CHECK(length(trim(title)) BETWEEN 1 AND 200)
      );
      CREATE TABLE lessons (
        id uuid PRIMARY KEY, module_id uuid NOT NULL REFERENCES modules(id), title text NOT NULL,
        position integer NOT NULL CHECK(position >= 0), required boolean NOT NULL DEFAULT true,
        active_media_id uuid, UNIQUE(module_id,position), CHECK(length(trim(title)) BETWEEN 1 AND 200)
      );
      CREATE TABLE enrollments (
        id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id), user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, UNIQUE(user_id,course_id)
      );
      CREATE TABLE media_assets (
        id uuid PRIMARY KEY, lesson_id uuid NOT NULL REFERENCES lessons(id), uploader_id uuid NOT NULL REFERENCES users(id),
        upload_key text NOT NULL UNIQUE, playback_key text UNIQUE,
        expected_bytes bigint NOT NULL CHECK(expected_bytes > 0 AND expected_bytes <= 524288000),
        source_etag text, duration_sec double precision, actual_bytes bigint, error_code text,
        status text NOT NULL CHECK(status IN ('UPLOADING','VALIDATING','READY','FAILED')),
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,lesson_id),
        CHECK(duration_sec IS NULL OR (duration_sec > 0 AND duration_sec <= 3600)),
        CHECK(status <> 'READY' OR (duration_sec IS NOT NULL AND playback_key IS NOT NULL AND actual_bytes > 0))
      );
      ALTER TABLE lessons ADD CONSTRAINT lesson_media_fk FOREIGN KEY(active_media_id,id) REFERENCES media_assets(id,lesson_id);
      CREATE INDEX media_uploader_idx ON media_assets(uploader_id,created_at);
      CREATE TABLE jobs (
        id uuid PRIMARY KEY, media_id uuid NOT NULL REFERENCES media_assets(id), job_key text NOT NULL UNIQUE,
        stage text NOT NULL CHECK(stage='VALIDATE_MEDIA'), status text NOT NULL CHECK(status IN ('PENDING','RUNNING','READY','FAILED')),
        attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
        generation integer NOT NULL DEFAULT 0 CHECK(generation >= 0), error_code text, retryable boolean NOT NULL DEFAULT true,
        lease_id uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE outbox (
        id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id), generation integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, UNIQUE(job_id,generation)
      );
      CREATE INDEX outbox_pending_idx ON outbox(created_at) WHERE dispatched_at IS NULL;
    `);
  }
  async down(): Promise<void> { throw new Error('Rollback dữ liệu cần kế hoạch riêng.'); }
}
