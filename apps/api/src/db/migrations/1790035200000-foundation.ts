import { MigrationInterface, QueryRunner } from 'typeorm';

export class Foundation1790035200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK (email = lower(email)),
        password_hash text NOT NULL, display_name text NOT NULL,
        disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE roles (name text PRIMARY KEY CHECK (name IN ('STUDENT','INSTRUCTOR','ADMIN')));
      INSERT INTO roles VALUES ('STUDENT'), ('INSTRUCTOR'), ('ADMIN');
      CREATE TABLE user_roles (
        user_id uuid REFERENCES users(id) NOT NULL, role text REFERENCES roles(name) NOT NULL,
        PRIMARY KEY (user_id, role)
      );
      CREATE TABLE sessions (
        id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) NOT NULL,
        client_type text NOT NULL CHECK (client_type IN ('web','mobile')),
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
        revoked_at timestamptz, CHECK (expires_at > created_at)
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);
      CREATE TABLE refresh_tokens (
        token_hash text PRIMARY KEY, session_id uuid REFERENCES sessions(id) NOT NULL,
        consumed_at timestamptz
      );
      CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id);
      CREATE TABLE courses (
        id uuid PRIMARY KEY, owner_id uuid REFERENCES users(id) NOT NULL,
        title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
        description text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX courses_owner_idx ON courses(owner_id);
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id) NOT NULL,
        action text NOT NULL, resource_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async down(): Promise<void> {
    throw new Error('Rollback xóa dữ liệu cần kế hoạch và xác nhận riêng.');
  }
}
