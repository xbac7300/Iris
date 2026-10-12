import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Principal } from '../auth/auth.service';
import { MediaService } from '../media/media.service';
import { QuizInputDto, SubmitDto, WatchBatchDto } from './dto';
import { grade, mergeIntervals, validWatch } from './rules';
@Injectable()
export class LearningService {
  constructor(private readonly db:DataSource,private readonly media:MediaService) {}
  async createQuiz(course: string, input: QuizInputDto, p: Principal) {
    if (!p.roles.includes('INSTRUCTOR')) throw new ForbiddenException('Cần quyền giảng viên.');
    if (!input.title.trim()) throw new UnprocessableEntityException('Cần tên bài kiểm tra.');
    for (const q of input.questions) {
      if (!q.text.trim()) throw new UnprocessableEntityException('Mỗi câu hỏi cần có nội dung.');
      const type = q.question_type ?? 'MULTIPLE_CHOICE';
      if (type === 'MULTIPLE_CHOICE') {
        if (!q.options || q.options.length < 2 || q.options.some(o => !o.text.trim()) || q.options.filter(o => o.is_correct).length !== 1) {
          throw new UnprocessableEntityException('Câu trắc nghiệm cần ít nhất 2 lựa chọn và đúng một đáp án đúng.');
        }
      }
    }
    const id = await this.db.transaction(async tx => {
      const [c] = await tx.query('SELECT * FROM courses WHERE id=$1 AND owner_id=$2 FOR UPDATE', [course, p.id]);
      if (!c) throw new NotFoundException('Không tìm thấy khóa thuộc quyền quản lý.');
      if (c.is_locked) throw new ForbiddenException('Khóa học này đang bị Quản trị viên khóa. Không thể tạo bài kiểm tra.');

      if (input.module_id) {
        const [m] = await tx.query('SELECT id FROM modules WHERE id=$1 AND course_id=$2', [input.module_id, course]);
        if (!m) throw new NotFoundException('Không tìm thấy chương trong khóa học.');
      }
      if (input.lesson_id) {
        const [l] = await tx.query('SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=$1 AND m.course_id=$2', [input.lesson_id, course]);
        if (!l) throw new NotFoundException('Không tìm thấy bài học trong khóa học.');
      }

      const id = randomUUID();
      const timeLimit = input.time_limit_minutes && Number(input.time_limit_minutes) > 0 ? Number(input.time_limit_minutes) : null;
      await tx.query(
        "INSERT INTO quiz_versions(id,course_id,module_id,lesson_id,title,status,required,pass_threshold,max_attempts,time_limit_minutes) VALUES($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8,$9)",
        [id, course, input.module_id ?? null, input.lesson_id ?? null, input.title.trim(), input.required, input.pass_threshold, input.max_attempts, timeLimit]
      );
      for (let position = 0; position < input.questions.length; position++) {
        const q = input.questions[position];
        const questionId = randomUUID();
        const type = q.question_type ?? 'MULTIPLE_CHOICE';
        await tx.query(
          'INSERT INTO questions(id,quiz_id,position,text,question_type) VALUES($1,$2,$3,$4,$5)',
          [questionId, id, position, q.text.trim(), type]
        );
        if (type === 'MULTIPLE_CHOICE' && q.options) {
          for (let j = 0; j < q.options.length; j++) {
            const o = q.options[j];
            await tx.query(
              'INSERT INTO options(id,question_id,position,text,is_correct) VALUES($1,$2,$3,$4,$5)',
              [randomUUID(), questionId, j, o.text.trim(), o.is_correct]
            );
          }
        }
      }
      return id;
    });
    return this.quiz(id, p);
  }
  async deleteQuiz(id: string, p: Principal) {
    return this.db.transaction(async tx => {
      const [quiz] = await tx.query('SELECT * FROM quiz_versions WHERE id=$1', [id]);
      if (!quiz) throw new NotFoundException('Không tìm thấy bài kiểm tra.');
      const isInstructor = p.roles.includes('INSTRUCTOR');
      const isAdmin = p.roles.includes('ADMIN');
      if (!isInstructor && !isAdmin) throw new ForbiddenException('Chỉ giảng viên sở hữu hoặc quản trị viên mới được xóa.');
      const [course] = await tx.query('SELECT * FROM courses WHERE id=$1 AND (owner_id=$2 OR $3::boolean)', [quiz.course_id, p.id, isAdmin]);
      if (!course) throw new ForbiddenException('Không có quyền quản lý bài kiểm tra của khóa học này.');
      if (course.is_locked && !isAdmin) {
        throw new ForbiddenException('Khóa học này đang bị Quản trị viên khóa. Không thể xóa bài kiểm tra.');
      }

      await tx.query('DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE quiz_id=$1) OR question_id IN (SELECT id FROM questions WHERE quiz_id=$1)', [id]);
      await tx.query('DELETE FROM attempts WHERE quiz_id=$1', [id]);
      await tx.query('DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id=$1)', [id]);
      await tx.query('DELETE FROM questions WHERE quiz_id=$1', [id]);
      await tx.query('DELETE FROM quiz_versions WHERE id=$1', [id]);
      return { success: true, id };
    });
  }
  async quiz(id: string, p: Principal) {
    const [q] = await this.db.query("SELECT * FROM quiz_versions WHERE id=$1 AND status='PUBLISHED'", [id]);
    if (!q) throw new NotFoundException('Không tìm thấy bài kiểm tra.');
    await this.media.requireRead(this.db.manager, q.course_id, p);
    const questions = await this.db.query('SELECT id,text,question_type FROM questions WHERE quiz_id=$1 ORDER BY position', [id]);
    for (const question of questions) {
      if (question.question_type === 'MULTIPLE_CHOICE') {
        question.options = await this.db.query('SELECT id,text FROM options WHERE question_id=$1 ORDER BY position', [question.id]);
      } else {
        question.options = [];
      }
    }
    return {
      ...q,
      pass_threshold: Number(q.pass_threshold),
      time_limit_minutes: q.time_limit_minutes ? Number(q.time_limit_minutes) : null,
      module_id: q.module_id ?? null,
      lesson_id: q.lesson_id ?? null,
      questions,
    };
  }
  async quizzes(course: string, p: Principal) {
    await this.media.requireRead(this.db.manager, course, p);
    const rows = await this.db.query("SELECT id FROM quiz_versions WHERE course_id=$1 AND status='PUBLISHED' ORDER BY created_at", [course]);
    return Promise.all(rows.map((r: { id: string }) => this.quiz(r.id, p)));
  }
  async attempt(quiz: string, p: Principal) {
    if (!p.roles.includes('STUDENT') && !p.roles.includes('INSTRUCTOR') && !p.roles.includes('ADMIN')) {
      throw new ForbiddenException('Cần tài khoản học viên hoặc giảng viên.');
    }
    const q = await this.quiz(quiz, p);
    const id = await this.db.transaction(async tx => {
      // Cùng người/đề chỉ được tạo một lượt tại một thời điểm.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${p.id}/${quiz}`]);
      await this.media.requireRead(tx, q.course_id, p);
      const [active] = await tx.query("SELECT id FROM attempts WHERE user_id=$1 AND quiz_id=$2 AND status='IN_PROGRESS'", [p.id, quiz]);
      if (active) return active.id;
      const [{ count }] = await tx.query('SELECT count(*)::int count FROM attempts WHERE user_id=$1 AND quiz_id=$2', [p.id, quiz]);
      if (count >= q.max_attempts) throw new ConflictException('Đã hết số lượt làm bài.');
      if (!q.questions.length) throw new ConflictException('Đề chưa có câu hỏi.');
      const id = randomUUID();
      await tx.query('INSERT INTO attempts(id,user_id,quiz_id,attempt_number,pass_threshold,max_attempts) VALUES($1,$2,$3,$4,$5,$6)', [id, p.id, quiz, count + 1, q.pass_threshold, q.max_attempts]);
      return id;
    });
    return this.getAttempt(id, p);
  }
  async getAttempt(id: string, p: Principal) {
    const [a] = await this.db.query('SELECT a.*,q.course_id FROM attempts a JOIN quiz_versions q ON q.id=a.quiz_id WHERE a.id=$1', [id]);
    if (!a) throw new NotFoundException('Không tìm thấy lượt làm bài.');
    const isOwner = a.user_id === p.id;
    const [course] = await this.db.query('SELECT owner_id FROM courses WHERE id=$1', [a.course_id]);
    const isInstructor = (course && course.owner_id === p.id) || p.roles.includes('ADMIN');
    if (!isOwner && !isInstructor) throw new ForbiddenException('Không có quyền xem bài làm này.');
    await this.media.requireRead(this.db.manager, a.course_id, p);

    const answers = await this.db.query(`
      SELECT aa.question_id, aa.option_id, aa.text_response, aa.file_url, aa.file_name,
             q.text as question_text, q.question_type, q.position,
             o.text as option_text, o.is_correct
      FROM attempt_answers aa
      JOIN questions q ON q.id=aa.question_id
      LEFT JOIN options o ON o.id=aa.option_id
      WHERE aa.attempt_id=$1
      ORDER BY q.position
    `, [id]);

    const finalScore = a.score !== null && a.score !== undefined ? Number(a.score) : (a.question_count ? (100 * a.correct_count / a.question_count) : null);

    return {
      id: a.id,
      quiz_id: a.quiz_id,
      user_id: a.user_id,
      status: a.status,
      attempt_number: a.attempt_number,
      pass_threshold: Number(a.pass_threshold),
      max_attempts: a.max_attempts,
      correct_count: a.correct_count,
      question_count: a.question_count,
      passed: a.passed,
      score: finalScore,
      instructor_feedback: a.instructor_feedback,
      graded_at: a.graded_at,
      graded_by: a.graded_by,
      submitted_at: a.submitted_at,
      answers,
    };
  }

  async gradeAttempt(id: string, input: { score: number; passed?: boolean; instructor_feedback?: string }, p: Principal) {
    return this.db.transaction(async tx => {
      const [a] = await tx.query('SELECT a.*, q.course_id FROM attempts a JOIN quiz_versions q ON q.id=a.quiz_id WHERE a.id=$1 FOR UPDATE', [id]);
      if (!a) throw new NotFoundException('Không tìm thấy lượt làm bài.');
      const [course] = await tx.query('SELECT owner_id FROM courses WHERE id=$1', [a.course_id]);
      const isInstructor = (course && course.owner_id === p.id) || p.roles.includes('ADMIN');
      if (!isInstructor) throw new ForbiddenException('Chỉ giảng viên sở hữu khóa học mới được chấm bài.');

      const score = Math.max(0, Math.min(100, Number(input.score) || 0));
      const passed = input.passed !== undefined ? Boolean(input.passed) : score >= Number(a.pass_threshold);
      const feedback = input.instructor_feedback?.trim() || null;

      await tx.query(`
        UPDATE attempts
        SET score=$2, passed=$3, instructor_feedback=$4, graded_at=now(), graded_by=$5
        WHERE id=$1
      `, [id, score, passed, feedback, p.id]);

      return this.getAttempt(id, p);
    });
  }

  async quizSubmissions(quizId: string, p: Principal) {
    const [quiz] = await this.db.query('SELECT * FROM quiz_versions WHERE id=$1', [quizId]);
    if (!quiz) throw new NotFoundException('Không tìm thấy bài kiểm tra.');
    const [course] = await this.db.query('SELECT owner_id FROM courses WHERE id=$1', [quiz.course_id]);
    const isInstructor = (course && course.owner_id === p.id) || p.roles.includes('ADMIN');
    if (!isInstructor) throw new ForbiddenException('Chỉ giảng viên khóa học mới có quyền xem danh sách bài nộp.');

    return this.db.query(`
      SELECT a.id, a.user_id, u.display_name as user_name, u.email as user_email,
             a.attempt_number, a.status,
             COALESCE(a.score, CASE WHEN a.question_count > 0 THEN 100.0 * a.correct_count / a.question_count ELSE 0 END) as score,
             a.passed, a.submitted_at, a.instructor_feedback, a.graded_at
      FROM attempts a
      JOIN users u ON u.id=a.user_id
      WHERE a.quiz_id=$1 AND a.status='SUBMITTED'
      ORDER BY a.submitted_at DESC NULLS LAST
    `, [quizId]);
  }

  async myAttempts(quizId: string, p: Principal) {
    return this.db.query(`
      SELECT a.id, a.quiz_id, a.status, a.attempt_number, a.pass_threshold, a.max_attempts,
             a.correct_count, a.question_count, a.passed,
             COALESCE(a.score, CASE WHEN a.question_count > 0 THEN 100.0 * a.correct_count / a.question_count ELSE 0 END) as score,
             a.instructor_feedback, a.graded_at, a.submitted_at
      FROM attempts a
      WHERE a.quiz_id=$1 AND a.user_id=$2 AND a.status='SUBMITTED'
      ORDER BY a.attempt_number DESC
    `, [quizId, p.id]);
  }

  async submit(id: string, input: SubmitDto, p: Principal) {
    const payload = [...input.answers].sort((a, b) => a.question_id.localeCompare(b.question_id)).map(a => [a.question_id, a.option_id ?? null, a.text_response ?? null, a.file_url ?? null]);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await this.db.transaction(async tx => {
      const [a] = await tx.query('SELECT a.*,q.course_id FROM attempts a JOIN quiz_versions q ON q.id=a.quiz_id WHERE a.id=$1 AND a.user_id=$2 FOR UPDATE OF a', [id, p.id]);
      if (!a) throw new NotFoundException('Không tìm thấy lượt làm bài.');
      await this.media.requireRead(tx, a.course_id, p);
      if (a.status === 'SUBMITTED') {
        if (a.submit_key === input.idempotency_key && a.payload_hash !== hash) throw new ConflictException('Idempotency key đã dùng cho nội dung khác.');
        return;
      }
      const questions = await tx.query('SELECT id,question_type FROM questions WHERE quiz_id=$1 ORDER BY position', [a.quiz_id]);
      const qMap = new Map<string, { id: string; question_type: string }>();
      for (const q of questions) qMap.set(q.id, q);
      const seen = new Set<string>();
      let correct = 0;
      for (const answer of input.answers) {
        const question = qMap.get(answer.question_id);
        if (!question || seen.has(answer.question_id)) throw new UnprocessableEntityException('Câu hỏi sai đề hoặc bị lặp.');
        seen.add(answer.question_id);
        if (question.question_type === 'MULTIPLE_CHOICE') {
          if (answer.option_id) {
            const [o] = await tx.query('SELECT is_correct FROM options WHERE id=$1 AND question_id=$2', [answer.option_id, answer.question_id]);
            if (!o) throw new UnprocessableEntityException('Đáp án không thuộc câu hỏi.');
            if (o.is_correct) correct++;
          }
        } else if (question.question_type === 'ESSAY') {
          if (answer.text_response && answer.text_response.trim().length > 0) correct++;
        } else if (question.question_type === 'FILE_UPLOAD') {
          if (answer.file_url || answer.file_name) correct++;
        }
        await tx.query(
          'INSERT INTO attempt_answers(attempt_id,question_id,option_id,text_response,file_url,file_name) VALUES($1,$2,$3,$4,$5,$6)',
          [id, answer.question_id, answer.option_id ?? null, answer.text_response?.trim() ?? null, answer.file_url ?? null, answer.file_name ?? null]
        );
      }
      const result = grade(correct, questions.length, Number(a.pass_threshold));
      const initialScore = questions.length ? (100 * correct / questions.length) : 0;
      await tx.query("UPDATE attempts SET status='SUBMITTED',correct_count=$2,question_count=$3,passed=$4,score=$5,submit_key=$6,payload_hash=$7,submitted_at=now() WHERE id=$1",
        [id, correct, questions.length, result.passed, initialScore, input.idempotency_key, hash]);
    });
    return this.getAttempt(id, p);
  }
  private async lesson(id:string,p:Principal) {
    const [l]=await this.db.query("SELECT l.*,m.course_id,a.duration_sec FROM lessons l JOIN modules m ON m.id=l.module_id JOIN media_assets a ON a.id=l.active_media_id AND a.status='READY' WHERE l.id=$1",[id]);
    if(!l)throw new NotFoundException('Bài học chưa có video sẵn sàng.');await this.media.requireRead(this.db.manager,l.course_id,p);return l;
  }
  async playbackSession(id:string,p:Principal) {
    const l=await this.lesson(id,p);
    return this.db.transaction(async tx=>{
      await tx.query('INSERT INTO resume_state(user_id,media_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,l.active_media_id]);
      const [rows]=await tx.query('UPDATE resume_state SET revision=revision+1 WHERE user_id=$1 AND media_id=$2 RETURNING *',[p.id,l.active_media_id]);const state=rows[0];
      const session=randomUUID();await tx.query('INSERT INTO playback_sessions(id,user_id,media_id,auth_session_id,resume_revision) VALUES($1,$2,$3,$4,$5)',[session,p.id,l.active_media_id,p.session_id,state.revision]);
      return {session_id:session,media_version:l.active_media_id,resume_revision:Number(state.revision),position_sec:state.position_sec};
    });
  }
  async watch(id:string,input:WatchBatchDto,p:Principal) {
    const l=await this.lesson(id,p);if(l.active_media_id!==input.media_version)throw new ConflictException('Bản video đã thay đổi.');
    return this.db.transaction(async tx=>{
      await this.media.requireRead(tx,l.course_id,p);
      await tx.query('INSERT INTO lesson_progress(user_id,media_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,l.active_media_id]);
      const [progress]=await tx.query('SELECT * FROM lesson_progress WHERE user_id=$1 AND media_id=$2 FOR UPDATE',[p.id,l.active_media_id]);
      const accepted:string[]=[],duplicate:string[]=[],rejected:{event_id:string;reason:string}[]=[],intervals:number[][]=progress.intervals;
      for(const event of input.events) {
        const [existing]=await tx.query('SELECT media_id,session_id,sequence,start_sec,end_sec,playback_rate,elapsed_ms FROM watch_events WHERE user_id=$1 AND event_id=$2',[p.id,event.event_id]);
        if(existing){if(existing.media_id===event.media_version&&existing.session_id===event.session_id&&existing.sequence===event.sequence&&existing.start_sec===event.start_sec&&existing.end_sec===event.end_sec&&existing.playback_rate===event.playback_rate&&existing.elapsed_ms===event.elapsed_ms)duplicate.push(event.event_id);else rejected.push({event_id:event.event_id,reason:'EVENT_ID_CONFLICT'});continue;}
        const [session]=await tx.query('SELECT * FROM playback_sessions WHERE id=$1 AND user_id=$2 AND media_id=$3 AND auth_session_id=$4',[event.session_id,p.id,l.active_media_id,p.session_id]);
        if(!session||event.media_version!==l.active_media_id||!validWatch(event,l.duration_sec)){rejected.push({event_id:event.event_id,reason:'INVALID_INTERVAL'});continue;}
        const rows=await tx.query('INSERT INTO watch_events(user_id,event_id,session_id,sequence,media_id,start_sec,end_sec,playback_rate,elapsed_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING event_id',[p.id,event.event_id,event.session_id,event.sequence,event.media_version,event.start_sec,event.end_sec,event.playback_rate,event.elapsed_ms]);
        if(!rows.length){rejected.push({event_id:event.event_id,reason:'SEQUENCE_CONFLICT'});continue;}
        accepted.push(event.event_id);intervals.push([event.start_sec,event.end_sec]);
      }
      const merged=mergeIntervals(intervals,l.duration_sec),watched=merged.reduce((sum,[a,b])=>sum+b-a,0);
      await tx.query('UPDATE lesson_progress SET intervals=$3,watched_sec=$4,updated_at=now() WHERE user_id=$1 AND media_id=$2',[p.id,l.active_media_id,JSON.stringify(merged),watched]);
      const [session]=await tx.query('SELECT * FROM playback_sessions WHERE id=$1 AND user_id=$2 AND media_id=$3 AND auth_session_id=$4',[input.session_id,p.id,l.active_media_id,p.session_id]);
      const [state]=await tx.query('SELECT * FROM resume_state WHERE user_id=$1 AND media_id=$2 FOR UPDATE',[p.id,l.active_media_id]);
      if(!state)throw new ConflictException('Cần mở phiên phát trước khi đồng bộ.');
      const checkpoint=!!session&&Number(session.resume_revision)===input.resume_revision&&Number(state.revision)===input.resume_revision&&input.position_sec<=l.duration_sec;
      if(checkpoint){await tx.query('UPDATE resume_state SET position_sec=$3,revision=revision+1 WHERE user_id=$1 AND media_id=$2',[p.id,l.active_media_id,input.position_sec]);await tx.query('UPDATE playback_sessions SET resume_revision=resume_revision+1 WHERE id=$1',[input.session_id]);}
      return {accepted,duplicate,rejected,resume_revision:Number(state.revision)+(checkpoint?1:0),checkpoint_applied:checkpoint,session_current:!!session&&Number(session.resume_revision)===Number(state.revision),watched_ratio:watched/l.duration_sec};
    });
  }
  async progress(course:string,p:Principal) {
    await this.media.requireRead(this.db.manager,course,p);
    const lessons=await this.db.query(`SELECT l.id lesson_id,l.title,l.required,COALESCE(p.watched_sec/NULLIF(a.duration_sec,0),0) watched_ratio,COALESCE(p.watched_sec/NULLIF(a.duration_sec,0)>=0.9,false) complete
      FROM lessons l JOIN modules m ON m.id=l.module_id LEFT JOIN media_assets a ON a.id=l.active_media_id LEFT JOIN lesson_progress p ON p.media_id=a.id AND p.user_id=$2 WHERE m.course_id=$1 ORDER BY m.position,l.position`,[course,p.id]);
    const quizzes=await this.db.query(`SELECT q.id quiz_id,q.title,q.required,COALESCE(bool_or(a.passed),false) passed,max(100.0*a.correct_count/NULLIF(a.question_count,0))::float8 best_score FROM quiz_versions q LEFT JOIN attempts a ON a.quiz_id=q.id AND a.user_id=$2 AND a.status='SUBMITTED' WHERE q.course_id=$1 AND q.status='PUBLISHED' GROUP BY q.id ORDER BY q.created_at`,[course,p.id]);
    const required=lessons.filter((l:{required:boolean})=>l.required).length+quizzes.filter((q:{required:boolean})=>q.required).length;
    const complete=lessons.filter((l:{required:boolean;complete:boolean})=>l.required&&l.complete).length+quizzes.filter((q:{required:boolean;passed:boolean})=>q.required&&q.passed).length;
    return {lessons,quizzes,required_count:required,completed_count:complete,complete:required>0&&required===complete};
  }
  async analytics(course:string,p:Principal) {
    const [c]=await this.db.query('SELECT owner_id FROM courses WHERE id=$1',[course]);if(!c||!(p.roles.includes('ADMIN')||(p.roles.includes('INSTRUCTOR')&&c.owner_id===p.id)))throw new NotFoundException('Không có quyền xem thống kê khóa này.');
    const enrolled=await this.db.query('SELECT user_id FROM enrollments WHERE course_id=$1 AND revoked_at IS NULL',[course]);
    const [stats]=await this.db.query(`SELECT count(*)::int submitted,avg(best)::float8 average_best_score FROM(SELECT a.user_id,max(100.0*a.correct_count/a.question_count) best FROM attempts a JOIN quiz_versions q ON q.id=a.quiz_id JOIN enrollments e ON e.user_id=a.user_id AND e.course_id=q.course_id AND e.revoked_at IS NULL WHERE q.course_id=$1 AND a.status='SUBMITTED' GROUP BY a.user_id) scores`,[course]);
    let completed=0;for(const row of enrolled){const result=await this.progress(course,{...p,id:row.user_id,roles:['STUDENT']});if(result.complete)completed++;}
    return {cohort:'Toàn bộ học viên còn quyền học; mọi thời điểm. Điểm: điểm tốt nhất mỗi người trên các bài đã nộp.',enrolled:enrolled.length,completed,submitted:stats.submitted,not_submitted:enrolled.length-stats.submitted,average_best_score:stats.average_best_score,measured_at:new Date().toISOString()};
  }
}
