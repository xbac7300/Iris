import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException, UnprocessableEntityException, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ObjectStorage } from '@lms/media-core';
import { Principal } from '../auth/auth.service';
import { CreateLessonDto, CreateModuleDto, UpdateLessonDto } from './dto';
import { PageDto } from '../courses/courses.controller';

export const STORAGE = Symbol('STORAGE');
type Course = { id: string; owner_id: string; status: string; structure_locked_at: Date | null; is_locked?: boolean; locked_reason?: string | null };

@Injectable()
export class MediaService implements OnModuleDestroy {
  constructor(private readonly db: DataSource, @Inject(STORAGE) private readonly storage: ObjectStorage | null) {}
  onModuleDestroy(): void { this.storage?.close(); }
  private s3(): ObjectStorage {
    if (!this.storage) throw new ServiceUnavailableException('Storage chưa được cấu hình.');
    return this.storage;
  }
  private async ownedCourse(tx: EntityManager, id: string, principal: Principal): Promise<Course> {
    const isInstructor = principal.roles.includes('INSTRUCTOR');
    if (!isInstructor) throw new ForbiddenException('Chỉ giảng viên sở hữu mới có quyền chỉnh sửa cấu trúc khóa học.');
    const [course] = await tx.query('SELECT * FROM courses WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, principal.id]);
    if (!course) throw new NotFoundException('Không tìm thấy khóa học thuộc quyền sở hữu của bạn.');
    if (course.is_locked) {
      throw new ForbiddenException(`Khóa học này đang bị Quản trị viên khóa${course.locked_reason ? `: ${course.locked_reason}` : ''}. Không thể chỉnh sửa hoặc thao tác.`);
    }
    return course;
  }
  private async mutable(_tx: EntityManager, course: Course, _principal: Principal): Promise<void> {
    if (course.is_locked) {
      throw new ForbiddenException(`Khóa học này đang bị Quản trị viên khóa${course.locked_reason ? `: ${course.locked_reason}` : ''}. Không thể chỉnh sửa hoặc thao tác.`);
    }
  }
  private async lessonContext(tx: EntityManager, id: string) {
    const [lesson] = await tx.query(`SELECT l.*,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=$1`, [id]);
    if (!lesson) throw new NotFoundException('Không tìm thấy bài học.');
    return lesson;
  }
  private async deleteLessonsCascade(tx: EntityManager, lessonIds: string[]) {
    if (!lessonIds.length) return;
    await tx.query('UPDATE lessons SET active_transcript_id=NULL, active_index_id=NULL, active_media_id=NULL WHERE id=ANY($1)', [lessonIds]);
    const mediaRows = await tx.query('SELECT id FROM media_assets WHERE lesson_id=ANY($1)', [lessonIds]);
    const mediaIds = mediaRows.map((m: { id: string }) => m.id);

    await tx.query(
      'DELETE FROM ai_tasks WHERE media_id IN (SELECT id FROM media_assets WHERE lesson_id=ANY($1)) OR transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM ai_usage WHERE lesson_id=ANY($1) OR message_id IN (SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM citations WHERE message_id IN (SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query('DELETE FROM conversations WHERE lesson_id=ANY($1)', [lessonIds]);

    await tx.query(
      'DELETE FROM embeddings WHERE chunk_id IN (SELECT c.id FROM chunks c JOIN index_versions i ON i.id=c.index_id JOIN transcript_versions t ON t.id=i.transcript_id WHERE t.lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM chunks WHERE index_id IN (SELECT i.id FROM index_versions i JOIN transcript_versions t ON t.id=i.transcript_id WHERE t.lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM summaries WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM index_versions WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query(
      'DELETE FROM segments WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
      [lessonIds]
    );
    await tx.query('DELETE FROM transcript_versions WHERE lesson_id=ANY($1)', [lessonIds]);

    if (mediaIds.length > 0) {
      await tx.query('DELETE FROM ai_tasks WHERE media_id=ANY($1)', [mediaIds]);
      await tx.query('DELETE FROM watch_events WHERE session_id IN (SELECT id FROM playback_sessions WHERE media_id=ANY($1))', [mediaIds]);
      await tx.query('DELETE FROM playback_sessions WHERE media_id=ANY($1)', [mediaIds]);
      await tx.query('DELETE FROM lesson_progress WHERE media_id=ANY($1)', [mediaIds]);
      await tx.query('DELETE FROM resume_state WHERE media_id=ANY($1)', [mediaIds]);
      await tx.query('DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE media_id=ANY($1))', [mediaIds]);
      await tx.query('DELETE FROM jobs WHERE media_id=ANY($1)', [mediaIds]);
      await tx.query('DELETE FROM media_assets WHERE id=ANY($1)', [mediaIds]);
    }

    if (lessonIds.length > 0) {
      const lessonQuizzes = await tx.query('SELECT id FROM quiz_versions WHERE lesson_id=ANY($1)', [lessonIds]);
      const lqIds = lessonQuizzes.map((q: { id: string }) => q.id);
      if (lqIds.length > 0) {
        await tx.query('DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE quiz_id=ANY($1)) OR question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))', [lqIds]);
        await tx.query('DELETE FROM attempts WHERE quiz_id=ANY($1)', [lqIds]);
        await tx.query('DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))', [lqIds]);
        await tx.query('DELETE FROM questions WHERE quiz_id=ANY($1)', [lqIds]);
        await tx.query('DELETE FROM quiz_versions WHERE id=ANY($1)', [lqIds]);
      }
    }

    await tx.query('DELETE FROM lessons WHERE id=ANY($1)', [lessonIds]);
  }
  async deleteModule(moduleId: string, principal: Principal) {
    return this.db.transaction(async tx => {
      const [module] = await tx.query('SELECT * FROM modules WHERE id=$1', [moduleId]);
      if (!module) throw new NotFoundException('Không tìm thấy chương.');
      const course = await this.ownedCourse(tx, module.course_id, principal);
      await this.mutable(tx, course, principal);
      const lessons = await tx.query('SELECT id FROM lessons WHERE module_id=$1', [moduleId]);
      const lessonIds = lessons.map((l: { id: string }) => l.id);
      await this.deleteLessonsCascade(tx, lessonIds);

      const moduleQuizzes = await tx.query('SELECT id FROM quiz_versions WHERE module_id=$1', [moduleId]);
      const mqIds = moduleQuizzes.map((q: { id: string }) => q.id);
      if (mqIds.length > 0) {
        await tx.query('DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE quiz_id=ANY($1)) OR question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))', [mqIds]);
        await tx.query('DELETE FROM attempts WHERE quiz_id=ANY($1)', [mqIds]);
        await tx.query('DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))', [mqIds]);
        await tx.query('DELETE FROM questions WHERE quiz_id=ANY($1)', [mqIds]);
        await tx.query('DELETE FROM quiz_versions WHERE id=ANY($1)', [mqIds]);
      }

      await tx.query('DELETE FROM modules WHERE id=$1', [moduleId]);
      return { success: true, id: moduleId };
    });
  }
  async deleteLesson(lessonId: string, principal: Principal) {
    return this.db.transaction(async tx => {
      const lesson = await this.lessonContext(tx, lessonId);
      const course = await this.ownedCourse(tx, lesson.course_id, principal);
      await this.mutable(tx, course, principal);
      await this.deleteLessonsCascade(tx, [lessonId]);
      return { success: true, id: lessonId };
    });
  }
  async addModule(courseId: string, input: CreateModuleDto, principal: Principal) {
    return this.db.transaction(async tx => {
      await this.mutable(tx, await this.ownedCourse(tx, courseId, principal), principal);
      const [module] = await tx.query(`INSERT INTO modules(id,course_id,title,position) VALUES($1,$2,$3,$4)
        ON CONFLICT(course_id,position) DO NOTHING RETURNING *`, [randomUUID(), courseId, input.title.trim(), input.position]);
      if (!module) throw new ConflictException('Vị trí chương đã được sử dụng.');
      return module;
    });
  }
  async addLesson(moduleId: string, input: CreateLessonDto, principal: Principal) {
    return this.db.transaction(async tx => {
      const [module] = await tx.query('SELECT course_id FROM modules WHERE id=$1', [moduleId]);
      if (!module) throw new NotFoundException('Không tìm thấy chương.');
      await this.mutable(tx, await this.ownedCourse(tx, module.course_id, principal), principal);
      const [lesson] = await tx.query(`INSERT INTO lessons(id,module_id,title,position,required) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(module_id,position) DO NOTHING RETURNING *`, [randomUUID(), moduleId, input.title.trim(), input.position, input.required ?? true]);
      if (!lesson) throw new ConflictException('Vị trí bài học đã được sử dụng.');
      return lesson;
    });
  }
  async lessons(courseId: string, principal: Principal, page: PageDto) {
    await this.requireRead(this.db.manager, courseId, principal);
    return this.db.query(`SELECT l.*,a.status media_status,j.id job_id,a.error_code,COALESCE(j.retryable,false) retryable
      FROM lessons l JOIN modules m ON m.id=l.module_id
      LEFT JOIN media_assets a ON a.id=l.active_media_id LEFT JOIN jobs j ON j.media_id=a.id
      WHERE m.course_id=$1 ORDER BY m.position,l.position LIMIT $2 OFFSET $3`, [courseId, page.limit, page.offset]);
  }
  async updateLesson(id:string,input:UpdateLessonDto,p:Principal){
    return this.db.transaction(async tx=>{
      const l=await this.lessonContext(tx,id);const course=await this.ownedCourse(tx,l.course_id,p);if(input.required!==undefined&&input.required!==l.required) await this.mutable(tx,course,p);
      const [rows]=await tx.query('UPDATE lessons SET title=COALESCE($2,title),required=COALESCE($3,required) WHERE id=$1 RETURNING *',[id,input.title?.trim(),input.required]);return rows[0];
    });
  }
  async members(course:string,page:PageDto,p:Principal){
    if(!p.roles.includes('INSTRUCTOR'))throw new ForbiddenException('Cần quyền giảng viên.');const [c]=await this.db.query('SELECT id FROM courses WHERE id=$1 AND owner_id=$2',[course,p.id]);if(!c)throw new NotFoundException('Không có quyền xem học viên.');
    return this.db.query('SELECT e.id,u.display_name,u.email,e.revoked_at FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.course_id=$1 ORDER BY e.created_at DESC LIMIT $2 OFFSET $3',[course,page.limit,page.offset]);
  }
  async enrollmentStatus(id:string,revoked:boolean,p:Principal){
    await this.db.transaction(async tx=>{
      const [e]=await tx.query('SELECT course_id FROM enrollments WHERE id=$1',[id]);if(!e)throw new NotFoundException('Không tìm thấy đăng ký.');await this.ownedCourse(tx,e.course_id,p);
      await tx.query('UPDATE enrollments SET revoked_at=CASE WHEN $2 THEN COALESCE(revoked_at,now()) ELSE NULL END WHERE id=$1',[id,revoked]);
      await tx.query('INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,$3,$4)',[randomUUID(),p.id,revoked?'ENROLLMENT_REVOKED':'ENROLLMENT_RESTORED',id]);
    });return {id};
  }
  async modules(courseId: string, principal: Principal, page: PageDto) {
    await this.requireRead(this.db.manager, courseId, principal);
    return this.db.query('SELECT * FROM modules WHERE course_id=$1 ORDER BY position LIMIT $2 OFFSET $3', [courseId, page.limit, page.offset]);
  }
  async requireRead(tx: EntityManager, courseId: string, principal: Principal): Promise<void> {
    await tx.query(
      "UPDATE courses SET status='PUBLISHED', is_locked=FALSE, locked_at=NULL, locked_reason=NULL, locked_by=NULL, scheduled_until=NULL, action_reason=NULL, updated_at=now() WHERE id=$1 AND is_locked=TRUE AND scheduled_until IS NOT NULL AND scheduled_until <= now()",
      [courseId]
    ).catch(() => {});
    const [allowed] = await tx.query(`SELECT c.id, c.is_locked, c.locked_reason, c.scheduled_until FROM courses c WHERE c.id=$1 AND (
      $4::boolean OR (c.owner_id=$2 AND $3::boolean) OR (c.status IN ('PUBLISHED','ARCHIVED') AND EXISTS(
        SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$2 AND e.revoked_at IS NULL)))`,
    [courseId, principal.id, principal.roles.includes('INSTRUCTOR'), principal.roles.includes('ADMIN')]);
    if (!allowed) throw new NotFoundException('Không tìm thấy nội dung được phép truy cập.');
    if (allowed.is_locked && !principal.roles.includes('ADMIN')) {
      const untilText = allowed.scheduled_until
        ? ` đến ${new Date(allowed.scheduled_until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
        : '';
      const reasonText = allowed.locked_reason ? `. Lý do: ${allowed.locked_reason}` : '';
      throw new ForbiddenException(`Khóa học này đang bị Quản trị viên tạm khóa${untilText}${reasonText}.`);
    }
  }
  async publish(courseId: string, principal: Principal, input?: { scheduled_at?: string }) {
    return this.db.transaction(async tx => {
      const course = await this.ownedCourse(tx, courseId, principal);
      const [stats] = await tx.query(`SELECT count(*)::int total, count(*) FILTER(WHERE l.required)::int required,
        count(*) FILTER(WHERE a.status='READY' AND a.duration_sec>0)::int ready FROM lessons l
        JOIN modules m ON m.id=l.module_id LEFT JOIN media_assets a ON a.id=l.active_media_id WHERE m.course_id=$1`, [courseId]);
      if (!stats.required || stats.total !== stats.ready) throw new UnprocessableEntityException('Cần ít nhất một bài bắt buộc; mọi video phải READY.');

      if (input?.scheduled_at && new Date(input.scheduled_at).getTime() > Date.now()) {
        const [rows] = await tx.query(
          "UPDATE courses SET scheduled_action='PUBLISH', scheduled_at=$1, updated_at=now() WHERE id=$2 RETURNING *",
          [new Date(input.scheduled_at).toISOString(), courseId]
        );
        return rows[0];
      }

      if (course.status === 'PUBLISHED') return course;
      const [rows] = await tx.query("UPDATE courses SET status='PUBLISHED',scheduled_action=NULL,scheduled_at=NULL,scheduled_until=NULL,action_reason=NULL,updated_at=now() WHERE id=$1 RETURNING *", [courseId]);
      await tx.query('INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,$3,$4)', [randomUUID(), principal.id, 'COURSE_PUBLISHED', courseId]);
      return rows[0];
    });
  }
  async archive(courseId: string, principal: Principal, input?: { scheduled_at?: string; scheduled_until?: string; reason?: string }) {
    return this.db.transaction(async tx => {
      const course = await this.ownedCourse(tx, courseId, principal);
      const reason = input?.reason?.trim() || null;
      const scheduledUntil = input?.scheduled_until ? new Date(input.scheduled_until).toISOString() : null;
      if (input?.scheduled_at && new Date(input.scheduled_at).getTime() > Date.now()) {
        const [rows] = await tx.query(
          "UPDATE courses SET scheduled_action='ARCHIVE', scheduled_at=$1, scheduled_until=$2, action_reason=$3, updated_at=now() WHERE id=$4 RETURNING *",
          [new Date(input.scheduled_at).toISOString(), scheduledUntil, reason, courseId]
        );
        return rows[0];
      }

      if (course.status === 'ARCHIVED') {
        const [rows] = await tx.query("UPDATE courses SET scheduled_until=COALESCE($1, scheduled_until), action_reason=COALESCE($2, action_reason), updated_at=now() WHERE id=$3 RETURNING *", [scheduledUntil, reason, courseId]);
        return rows[0];
      }
      const [rows] = await tx.query("UPDATE courses SET status='ARCHIVED',scheduled_action=NULL,scheduled_at=NULL,scheduled_until=$1,action_reason=$2,updated_at=now() WHERE id=$3 RETURNING *", [scheduledUntil, reason, courseId]);
      await tx.query('INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,$3,$4)', [randomUUID(), principal.id, 'COURSE_ARCHIVED', courseId]);
      return rows[0];
    });
  }
  async enroll(courseId: string, principal: Principal) {
    if (!principal.roles.includes('STUDENT')) {
      throw new ForbiddenException('Chỉ tài khoản học viên mới có thể đăng ký khóa học.');
    }
    return this.db.transaction(async tx => {
      const [course] = await tx.query('SELECT * FROM courses WHERE id=$1 FOR UPDATE', [courseId]);
      if (!course) throw new NotFoundException('Không tìm thấy khóa học.');
      if (course.is_locked) throw new ForbiddenException('Khóa học này đang bị Quản trị viên khóa, không thể đăng ký.');
      const [existing] = await tx.query('SELECT * FROM enrollments WHERE course_id=$1 AND user_id=$2', [courseId, principal.id]);
      if (existing?.revoked_at) throw new ForbiddenException('Quyền học đã bị thu hồi.');
      if (existing) return existing;
      if (course.status !== 'PUBLISHED') throw new NotFoundException('Khóa học chưa mở đăng ký.');

      if (course.access_mode === 'RESTRICTED' && !principal.roles.includes('ADMIN') && course.owner_id !== principal.id) {
        const userEmail = principal.email?.toLowerCase() || '';
        const allowedEmails = Array.isArray(course.allowed_emails) ? course.allowed_emails.map((e: string) => e.toLowerCase()) : [];
        if (!allowedEmails.includes(userEmail)) {
          throw new ForbiddenException('Bạn không thuộc danh sách học viên được chỉ định tham gia khóa học này.');
        }
      }

      const [enrollment] = await tx.query('INSERT INTO enrollments(id,course_id,user_id) VALUES($1,$2,$3) RETURNING *', [randomUUID(), courseId, principal.id]);
      await tx.query('UPDATE courses SET structure_locked_at=COALESCE(structure_locked_at,now()) WHERE id=$1', [courseId]);
      return enrollment;
    });
  }
  async upload(lessonId: string, size: number, principal: Principal, requestHost?: string) {
    const s3 = this.s3();
    if (size > s3.config.UPLOAD_MAX_BYTES) throw new UnprocessableEntityException('Video vượt giới hạn dung lượng.');
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`upload:${principal.id}`]);
      const lesson = await this.lessonContext(tx, lessonId);
      await this.mutable(tx, await this.ownedCourse(tx, lesson.course_id, principal), principal);
      const [quota] = await tx.query(`SELECT count(*)::int count, COALESCE(sum(expected_bytes),0)::bigint bytes
        FROM media_assets WHERE uploader_id=$1 AND created_at>now()-interval '24 hours'`, [principal.id]);
      if (quota.count >= 20 || Number(quota.bytes) + size > 2 * 1024 ** 3) throw new HttpException('Đã hết hạn mức upload trong 24 giờ.', 429);
      const id = randomUUID();
      const key = `uploads/${lessonId}/${id}.mp4`;
      const url = await s3.uploadUrl(key, size, requestHost);
      await tx.query(`INSERT INTO media_assets(id,lesson_id,uploader_id,upload_key,expected_bytes,status)
        VALUES($1,$2,$3,$4,$5,'UPLOADING')`, [id, lessonId, principal.id, key, size]);
      if (lesson.active_index_id) {
        await tx.query("UPDATE index_versions SET status='STALE' WHERE id=$1", [lesson.active_index_id]);
        await tx.query("UPDATE summaries SET status='STALE' WHERE index_id=$1", [lesson.active_index_id]);
      }
      await tx.query('UPDATE lessons SET active_media_id=$1,active_transcript_id=NULL,active_index_id=NULL WHERE id=$2', [id, lessonId]);
      return { media_id: id, upload_url: url, method: 'PUT', content_type: 'video/mp4', expires_in: 900 };
    });
  }
  async complete(lessonId: string, mediaId: string, principal: Principal) {
    const s3 = this.s3();
    return this.db.transaction(async tx => {
      let lesson = await this.lessonContext(tx, lessonId);
      const course = await this.ownedCourse(tx, lesson.course_id, principal);
      // Đọc lại sau khi có khóa course để không nhận bản upload đã bị thay thế lúc chờ khóa.
      lesson = await this.lessonContext(tx, lessonId);
      const [asset] = await tx.query('SELECT * FROM media_assets WHERE id=$1 AND lesson_id=$2 FOR UPDATE', [mediaId, lessonId]);
      if (!asset) throw new NotFoundException('Không tìm thấy bản upload.');
      const [existing] = await tx.query('SELECT id FROM jobs WHERE media_id=$1', [mediaId]);
      if (existing) return { job_id: existing.id };
      await this.mutable(tx, course, principal);
      if (lesson.active_media_id !== mediaId) throw new ConflictException('Đã có bản upload mới hơn.');
      let head;
      try { head = await s3.head(asset.upload_key); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode === 404) throw new ConflictException('Upload chưa hoàn tất.');
        throw new ServiceUnavailableException('Không kiểm tra được storage.');
      }
      if (!head.ETag || head.ContentLength !== Number(asset.expected_bytes) || head.ContentType !== 'video/mp4') {
        throw new UnprocessableEntityException('Dung lượng hoặc Content-Type không khớp bản upload.');
      }
      const jobId = randomUUID();
      await tx.query("UPDATE media_assets SET status='VALIDATING',source_etag=$1 WHERE id=$2", [head.ETag, mediaId]);
      await tx.query(`INSERT INTO jobs(id,media_id,job_key,stage,status) VALUES($1,$2,$3,'VALIDATE_MEDIA','PENDING')`,
        [jobId, mediaId, `${lessonId}/${mediaId}/validate/v1`]);
      await tx.query('INSERT INTO outbox(id,job_id) VALUES($1,$2)', [randomUUID(), jobId]);
      return { job_id: jobId };
    });
  }
  async playback(lessonId: string, principal: Principal, requestHost?: string) {
    const lesson = await this.lessonContext(this.db.manager, lessonId);
    await this.requireRead(this.db.manager, lesson.course_id, principal);
    const [asset] = await this.db.query("SELECT * FROM media_assets WHERE id=$1 AND status='READY'", [lesson.active_media_id]);
    if (!asset) throw new ConflictException('Video chưa sẵn sàng.');
    const url = await this.s3().playbackUrl(asset.playback_key, requestHost);
    await this.requireRead(this.db.manager, lesson.course_id, principal);
    return { lesson_id: lessonId, media_version: asset.id, duration_sec: asset.duration_sec, url, expires_in: 300, ai_status: lesson.active_index_id ? 'READY' : lesson.active_transcript_id ? 'INDEXING' : 'PROCESSING' };
  }
  async job(id: string, principal: Principal) {
    if (!principal.roles.includes('INSTRUCTOR')) throw new ForbiddenException('Cần quyền giảng viên.');
    const [job] = await this.db.query(`SELECT j.id,j.media_id,j.status,j.attempts,j.generation,j.error_code,j.retryable FROM jobs j
      JOIN media_assets a ON a.id=j.media_id JOIN lessons l ON l.id=a.lesson_id JOIN modules m ON m.id=l.module_id
      JOIN courses c ON c.id=m.course_id WHERE j.id=$1 AND c.owner_id=$2`, [id, principal.id]);
    if (!job) throw new NotFoundException('Không tìm thấy job thuộc quyền quản lý.');
    return job;
  }
  async retry(id: string, principal: Principal) {
    await this.job(id, principal);
    return this.db.transaction(async tx => {
      const [job] = await tx.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [id]);
      if (job.status !== 'FAILED' || !job.retryable || job.generation >= 3) throw new ConflictException('Job không thể retry; file hỏng cần upload bản mới.');
      await tx.query("UPDATE jobs SET status='PENDING',attempts=0,generation=generation+1,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [id]);
      await tx.query("UPDATE media_assets SET status='VALIDATING',error_code=NULL WHERE id=$1", [job.media_id]);
      await tx.query('INSERT INTO outbox(id,job_id,generation) VALUES($1,$2,$3)', [randomUUID(), id, job.generation + 1]);
      await tx.query('INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,$3,$4)', [randomUUID(), principal.id, 'JOB_RETRIED', id]);
      return { job_id: id };
    });
  }
}
