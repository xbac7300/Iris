import { MigrationInterface, QueryRunner } from 'typeorm';
export class Learning1790121600000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN CREATE EXTENSION IF NOT EXISTS vector; END IF; END $$;
      CREATE TABLE transcript_versions(id uuid PRIMARY KEY, lesson_id uuid NOT NULL REFERENCES lessons(id), media_id uuid NOT NULL REFERENCES media_assets(id),
        version int NOT NULL CHECK(version>0), language text NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(lesson_id,version));
      CREATE TABLE segments(id uuid PRIMARY KEY, transcript_id uuid NOT NULL REFERENCES transcript_versions(id), position int NOT NULL CHECK(position>=0),
        start_sec float8 NOT NULL CHECK(start_sec>=0), end_sec float8 NOT NULL, text text NOT NULL CHECK(length(trim(text))>0), CHECK(end_sec>start_sec), UNIQUE(transcript_id,position));
      CREATE TABLE index_versions(id uuid PRIMARY KEY, transcript_id uuid NOT NULL REFERENCES transcript_versions(id), model_id text NOT NULL, dimensions int NOT NULL CHECK(dimensions BETWEEN 32 AND 4096),
        status text NOT NULL CHECK(status IN ('BUILDING','READY','STALE','FAILED')), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE chunks(id uuid PRIMARY KEY, index_id uuid NOT NULL REFERENCES index_versions(id), position int NOT NULL, text text NOT NULL,
        start_sec float8 NOT NULL CHECK(start_sec>=0), end_sec float8 NOT NULL CHECK(end_sec>start_sec), segment_ids uuid[] NOT NULL, UNIQUE(index_id,position));
      CREATE TABLE embeddings(chunk_id uuid PRIMARY KEY REFERENCES chunks(id), model_id text NOT NULL, dimensions int NOT NULL, values float8[] NOT NULL, CHECK(cardinality(values)=dimensions));
      CREATE TABLE summaries(id uuid PRIMARY KEY, transcript_id uuid NOT NULL REFERENCES transcript_versions(id), index_id uuid NOT NULL REFERENCES index_versions(id),
        model_id text NOT NULL, prompt_version text NOT NULL, status text NOT NULL CHECK(status IN ('PENDING','READY','STALE','FAILED')), content jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(index_id,model_id,prompt_version));
      ALTER TABLE lessons ADD COLUMN active_transcript_id uuid REFERENCES transcript_versions(id), ADD COLUMN active_index_id uuid REFERENCES index_versions(id);
      CREATE TABLE ai_tasks(id uuid PRIMARY KEY, media_id uuid NOT NULL REFERENCES media_assets(id), transcript_id uuid REFERENCES transcript_versions(id),
        stage text NOT NULL CHECK(stage IN ('ASR','INDEX','SUMMARY')), job_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','READY','FAILED','STALE')),
        attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4), lease_id uuid, lease_until timestamptz, error_code text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE conversations(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), lesson_id uuid NOT NULL REFERENCES lessons(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE messages(id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id), index_id uuid NOT NULL REFERENCES index_versions(id),
        question text NOT NULL, answer text NOT NULL, evidence_status text NOT NULL CHECK(evidence_status IN ('SUPPORTED','INSUFFICIENT')), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE citations(id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES messages(id), chunk_id uuid NOT NULL REFERENCES chunks(id), UNIQUE(message_id,chunk_id));
      CREATE TABLE ai_usage(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), lesson_id uuid NOT NULL REFERENCES lessons(id), request_key uuid NOT NULL, request_hash text NOT NULL,
        status text NOT NULL CHECK(status IN ('PENDING','COMPLETE','FAILED')), message_id uuid REFERENCES messages(id), input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0,
        latency_ms int, cost numeric(12,6) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key));
      CREATE INDEX ai_usage_daily_idx ON ai_usage(user_id,created_at);
      CREATE TABLE quiz_versions(id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id), title text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),
        required boolean NOT NULL DEFAULT true, pass_threshold numeric(5,2) NOT NULL DEFAULT 70 CHECK(pass_threshold BETWEEN 0 AND 100), max_attempts int NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 3), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE questions(id uuid PRIMARY KEY, quiz_id uuid NOT NULL REFERENCES quiz_versions(id), position int NOT NULL, text text NOT NULL, UNIQUE(quiz_id,position), UNIQUE(id,quiz_id));
      CREATE TABLE options(id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES questions(id), position int NOT NULL, text text NOT NULL, is_correct boolean NOT NULL, UNIQUE(question_id,position), UNIQUE(id,question_id));
      CREATE TABLE attempts(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), quiz_id uuid NOT NULL REFERENCES quiz_versions(id), attempt_number int NOT NULL,
        status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS','SUBMITTED')), pass_threshold numeric(5,2) NOT NULL, max_attempts int NOT NULL,
        correct_count int, question_count int, passed boolean, submit_key uuid, payload_hash text, started_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz, UNIQUE(user_id,quiz_id,attempt_number));
      CREATE UNIQUE INDEX one_active_attempt ON attempts(user_id,quiz_id) WHERE status='IN_PROGRESS';
      CREATE TABLE attempt_answers(attempt_id uuid NOT NULL REFERENCES attempts(id), question_id uuid NOT NULL REFERENCES questions(id), option_id uuid,
        PRIMARY KEY(attempt_id,question_id), FOREIGN KEY(option_id,question_id) REFERENCES options(id,question_id));
      CREATE TABLE playback_sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), media_id uuid NOT NULL REFERENCES media_assets(id), auth_session_id uuid NOT NULL REFERENCES sessions(id), resume_revision bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE lesson_progress(user_id uuid NOT NULL REFERENCES users(id), media_id uuid NOT NULL REFERENCES media_assets(id), intervals jsonb NOT NULL DEFAULT '[]', watched_sec float8 NOT NULL DEFAULT 0 CHECK(watched_sec>=0), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,media_id));
      CREATE TABLE resume_state(user_id uuid NOT NULL REFERENCES users(id), media_id uuid NOT NULL REFERENCES media_assets(id), position_sec float8 NOT NULL DEFAULT 0 CHECK(position_sec>=0), revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), PRIMARY KEY(user_id,media_id));
      CREATE TABLE watch_events(user_id uuid NOT NULL REFERENCES users(id), event_id uuid NOT NULL, session_id uuid NOT NULL REFERENCES playback_sessions(id), sequence int NOT NULL CHECK(sequence>=0),
        media_id uuid NOT NULL REFERENCES media_assets(id), start_sec float8 NOT NULL CHECK(start_sec>=0), end_sec float8 NOT NULL CHECK(end_sec>start_sec), playback_rate float8 NOT NULL CHECK(playback_rate BETWEEN 0.25 AND 2), elapsed_ms float8 NOT NULL CHECK(elapsed_ms>0), created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,event_id), UNIQUE(session_id,sequence));
    `);
  }
  async down(): Promise<void> { throw new Error('Rollback dữ liệu học cần kế hoạch riêng.'); }
}
