'use client';
import { useCallback, useEffect, useState } from 'react';
import type { components } from '@lms/api-client';
import { session } from './session';

type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Attempt = components['schemas']['AttemptDto'];
type Progress = components['schemas']['CourseProgressDto'];
type Analytics = components['schemas']['AnalyticsDto'];
type QuestionType = 'MULTIPLE_CHOICE' | 'ESSAY' | 'FILE_UPLOAD';

export interface QuizQuestionDraft {
  text: string;
  question_type: QuestionType;
  options: { text: string; is_correct: boolean }[];
}

const newQuestion = (type: QuestionType = 'MULTIPLE_CHOICE'): QuizQuestionDraft => ({
  text: '',
  question_type: type,
  options: type === 'MULTIPLE_CHOICE' ? [
    { text: '', is_correct: true },
    { text: '', is_correct: false },
  ] : [],
});

interface AnswerState {
  option_id?: string;
  text_response?: string;
  file_url?: string;
  file_name?: string;
}

interface AttemptDetail extends Attempt {
  user_id?: string;
  user_name?: string;
  user_email?: string;
  created_at?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  graded_by?: string | null;
  instructor_feedback?: string | null;
  answers?: {
    question_id: string;
    option_id?: string | null;
    text_response?: string | null;
    file_url?: string | null;
    file_name?: string | null;
    question_text?: string;
    question_type?: string;
    option_text?: string | null;
    is_correct?: boolean | null;
  }[];
}

export function QuizCard({
  quiz,
  editable,
  owner,
  onDeleted,
}: {
  quiz: Quiz;
  editable: boolean;
  owner: boolean;
  onDeleted?: () => void;
}) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Lịch sử bài làm của học viên
  const [myAttempts, setMyAttempts] = useState<AttemptDetail[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState<AttemptDetail | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // Danh sách bài nộp và chấm bài dành cho Giảng viên
  const [showSubmissionsModal, setShowSubmissionsModal] = useState(false);
  const [submissions, setSubmissions] = useState<AttemptDetail[]>([]);
  const [gradingSubmission, setGradingSubmission] = useState<AttemptDetail | null>(null);
  const [gradingScore, setGradingScore] = useState<number>(0);
  const [gradingPassed, setGradingPassed] = useState<boolean>(false);
  const [gradingFeedback, setGradingFeedback] = useState<string>('');
  const [gradingBusy, setGradingBusy] = useState(false);

  const loadMyAttempts = useCallback(async () => {
    // Chỉ tải nếu là học viên (không phải chế độ giảng viên chấm bài)
    if (owner) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/my-attempts', {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        const list = data as unknown as AttemptDetail[];
        setMyAttempts(list);
        if (list.length > 0) {
          setAttempt(prev => (prev?.status === 'IN_PROGRESS' ? prev : list[0]));
        }
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [quiz.id, owner]);

  const loadSubmissions = useCallback(async () => {
    if (!owner && !editable) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/submissions', {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        setSubmissions(data as unknown as AttemptDetail[]);
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [quiz.id, owner, editable]);

  useEffect(() => {
    void loadMyAttempts();
    void loadSubmissions();
  }, [loadMyAttempts, loadSubmissions]);

  async function startAttempt() {
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await session.api.POST('/api/v1/quizzes/{id}/attempts', {
        params: { path: { id: quiz.id } },
      });
      if (!data) throw new Error(error?.message ?? 'Không thể bắt đầu làm bài.');
      setAttempt(data);
      setAnswers({});
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không thể bắt đầu làm bài.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAttempt() {
    if (!attempt) return;
    setBusy(true);
    setMessage('');
    try {
      const payloadAnswers = quiz.questions.map(q => {
        const ans = answers[q.id];
        return {
          question_id: q.id,
          option_id: ans?.option_id,
          text_response: ans?.text_response?.trim(),
          file_url: ans?.file_url,
          file_name: ans?.file_name,
        };
      });

      const body = {
        idempotency_key: crypto.randomUUID(),
        answers: payloadAnswers,
      };

      try {
        const { data, error } = await session.api.POST('/api/v1/attempts/{id}/submit', {
          params: { path: { id: attempt.id } },
          body,
        });
        if (!data) throw new Error(error?.message ?? 'Chưa nộp được bài.');
        setAttempt(data);
        await loadMyAttempts();
      } catch (error) {
        const check = await session.api.GET('/api/v1/attempts/{id}', {
          params: { path: { id: attempt.id } },
        });
        if (check.data?.status === 'SUBMITTED') {
          setAttempt(check.data);
          await loadMyAttempts();
        } else {
          throw error;
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa nộp được bài.');
    } finally {
      setBusy(false);
    }
  }

  // Bộ đếm thời gian làm bài nếu bài kiểm tra có giới hạn thời gian
  useEffect(() => {
    if (owner || attempt?.status !== 'IN_PROGRESS' || !quiz.time_limit_minutes || quiz.time_limit_minutes <= 0) {
      setTimeLeft(null);
      return;
    }

    const totalSeconds = quiz.time_limit_minutes * 60;
    const startTime = attempt.created_at ? new Date(attempt.created_at).getTime() : Date.now();
    const calculateRemaining = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      return Math.max(0, totalSeconds - elapsed);
    };

    const initial = calculateRemaining();
    setTimeLeft(initial);
    if (initial <= 0) {
      void submitAttempt();
      return;
    }

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        void submitAttempt();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [attempt?.id, attempt?.status, quiz.time_limit_minutes, owner]);

  function formatTimeRemaining(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function openReview(targetAttempt?: AttemptDetail) {
    const a = targetAttempt || attempt || myAttempts[0];
    if (!a) return;
    setReviewBusy(true);
    try {
      const { data, error } = await session.api.GET('/api/v1/attempts/{id}', {
        params: { path: { id: a.id } },
      });
      if (error) throw new Error(error.message);
      setReviewAttempt((data as AttemptDetail) || a);
      setShowReviewModal(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa tải được chi tiết bài làm.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function openGrading(sub: AttemptDetail) {
    setGradingBusy(true);
    try {
      const { data, error } = await session.api.GET('/api/v1/attempts/{id}', {
        params: { path: { id: sub.id } },
      });
      if (error) throw new Error(error.message);
      const detailed = (data as AttemptDetail) || sub;
      setGradingSubmission(detailed);
      const qCount = detailed.question_count ?? 0;
      const cCount = detailed.correct_count ?? 0;
      const initialScore = detailed.score !== null && detailed.score !== undefined
        ? Number(detailed.score)
        : qCount > 0 ? (cCount / qCount) * 100 : 0;
      setGradingScore(Math.round(initialScore * 10) / 10);
      setGradingPassed(detailed.passed ?? (initialScore >= quiz.pass_threshold));
      setGradingFeedback(detailed.instructor_feedback || '');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa tải được bài nộp.');
    } finally {
      setGradingBusy(false);
    }
  }

  async function saveGrade() {
    if (!gradingSubmission) return;
    setGradingBusy(true);
    setMessage('');
    try {
      const { error } = await session.api.POST('/api/v1/attempts/{id}/grade', {
        params: { path: { id: gradingSubmission.id } },
        body: {
          score: gradingScore,
          passed: gradingPassed,
          instructor_feedback: gradingFeedback.trim(),
        },
      });
      if (error) throw new Error(error.message);
      setMessage(`Đã lưu kết quả chấm bài của ${gradingSubmission.user_name || 'học viên'} thành công.`);
      setGradingSubmission(null);
      await loadSubmissions();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi lưu kết quả chấm bài.');
    } finally {
      setGradingBusy(false);
    }
  }

  async function deleteQuiz() {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa bài kiểm tra "${quiz.title}"?`)) return;
    setBusy(true);
    setMessage('');
    try {
      let res = await session.api.DELETE('/api/v1/quizzes/{id}', { params: { path: { id: quiz.id } } });
      if (res.error) {
        res = await session.api.POST('/api/v1/quizzes/{id}/delete', { params: { path: { id: quiz.id } } });
      }
      if (res.error) throw new Error(res.error.message ?? 'Chưa thể xóa bài kiểm tra.');
      onDeleted?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không thể xóa bài kiểm tra.');
      setBusy(false);
    }
  }

  const latestSubmitted = attempt?.status === 'SUBMITTED' ? attempt : myAttempts[0];

  return (
    <article className="panel quiz-card" style={{ marginTop: '12px', borderLeft: '4px solid var(--green)' }}>
      <div className="row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>{quiz.title}</h4>
            <span className="badge" style={{ fontSize: '11px', background: 'var(--green-light)', color: 'var(--green)' }}>
              {quiz.questions.length} câu hỏi
            </span>
            <span
              className="badge"
              style={{
                fontSize: '11px',
                background: quiz.time_limit_minutes ? 'rgba(217, 119, 6, 0.12)' : 'var(--bg-elevated)',
                color: quiz.time_limit_minutes ? '#d97706' : 'var(--text-muted)',
                border: `1px solid ${quiz.time_limit_minutes ? '#d97706' : 'var(--border-color)'}`,
              }}
            >
              {quiz.time_limit_minutes ? `Thời gian: ${quiz.time_limit_minutes} phút` : 'Không giới hạn thời gian'}
            </span>
          </div>
          <p className="small" style={{ margin: '4px 0 0' }}>
            Ngưỡng đạt {quiz.pass_threshold}% · Tối đa {quiz.max_attempts} lượt làm bài
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Nút Xem bài nộp học viên cho Giảng viên */}
          {(owner || editable) && (
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '13px', background: 'var(--bg-elevated)' }}
              onClick={() => {
                void loadSubmissions();
                setShowSubmissionsModal(true);
              }}
              title="Xem danh sách bài nộp và chấm bài cho học viên"
            >
              Xem bài nộp học viên ({submissions.length})
            </button>
          )}

          {/* Học viên: Nút Xem lại bài làm */}
          {!owner && latestSubmitted && (
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '13px' }}
              disabled={reviewBusy}
              onClick={() => void openReview(latestSubmitted)}
              title="Xem lại chi tiết bài làm đã nộp"
            >
              {reviewBusy ? 'Đang mở…' : 'Xem lại bài làm'}
            </button>
          )}

          {/* Xóa bài kiểm tra dành cho Giảng viên sở hữu */}
          {editable && (
            <button
              type="button"
              className="text-button danger"
              style={{ fontSize: '13px' }}
              disabled={busy}
              onClick={() => void deleteQuiz()}
              title="Xóa bài kiểm tra này"
            >
              Xóa bài kiểm tra
            </button>
          )}

          {/* Học viên: Nút Làm bài kiểm tra / Làm lại (ẨN với Giảng viên) */}
          {!owner && (
            <button
              type="button"
              className="secondary"
              disabled={busy || (attempt?.quiz_id === quiz.id && attempt.status === 'IN_PROGRESS')}
              onClick={() => void startAttempt()}
            >
              {latestSubmitted ? 'Làm lại' : 'Làm bài kiểm tra'}
            </button>
          )}
        </div>
      </div>

      {message && <p className="notice" role="alert" style={{ marginTop: '8px' }}>{message}</p>}

      {/* Box kết quả bài làm: CHỈ hiển thị cho Học viên (!owner), KHÔNG hiển thị cho Giảng viên */}
      {!owner && latestSubmitted && attempt?.status !== 'IN_PROGRESS' && (
        <div
          className={`quiz-result ${latestSubmitted.graded_at ? (latestSubmitted.passed ? 'graded-pass' : 'graded-fail') : 'pending'}`}
          role="status"
          style={{
            marginTop: '12px',
            padding: '14px',
            borderRadius: '8px',
            background: latestSubmitted.graded_at
              ? (latestSubmitted.passed ? 'rgba(33, 99, 79, 0.1)' : 'rgba(161, 54, 32, 0.1)')
              : 'rgba(217, 119, 6, 0.08)',
            border: `1px solid ${latestSubmitted.graded_at ? (latestSubmitted.passed ? 'var(--green)' : '#a13620') : '#d97706'}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <strong style={{ color: latestSubmitted.graded_at ? (latestSubmitted.passed ? 'var(--green)' : '#a13620') : '#d97706', fontSize: '15px' }}>
              {latestSubmitted.graded_at
                ? (latestSubmitted.passed ? '[ĐÃ CHẤM: ĐẠT] Giảng viên đã chấm bài' : '[ĐÃ CHẤM: CHƯA ĐẠT] Giảng viên đã chấm bài')
                : '[CHỜ CHẤM ĐIỂM] Đã nộp bài thành công!'}
            </strong>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Lượt {latestSubmitted.attempt_number} / {quiz.max_attempts}
              {latestSubmitted.graded_at && ` · Chấm lúc: ${new Date(latestSubmitted.graded_at).toLocaleString('vi-VN')}`}
            </span>
          </div>

          <p className="small" style={{ margin: '6px 0 0' }}>
            {latestSubmitted.graded_at ? (
              <>
                Điểm số chính thức: <strong style={{ fontSize: '14px', color: latestSubmitted.passed ? 'var(--green)' : '#a13620' }}>{Number(latestSubmitted.score).toFixed(1)} / 100</strong> (Yêu cầu {quiz.pass_threshold}%).
              </>
            ) : (
              <>
                Điểm trắc nghiệm tạm tính: <strong>{latestSubmitted.score !== null && latestSubmitted.score !== undefined ? Number(latestSubmitted.score).toFixed(1) : (((latestSubmitted.correct_count ?? 0) / (latestSubmitted.question_count || 1)) * 100).toFixed(1)} / 100</strong>. Đang chờ giảng viên chấm bài và ghi nhận điểm chính thức.
              </>
            )}
            {latestSubmitted.submitted_at && ` · Nộp lúc: ${new Date(latestSubmitted.submitted_at).toLocaleString('vi-VN')}`}
          </p>

          {latestSubmitted.instructor_feedback && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: '6px', borderLeft: '4px solid var(--green)' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--green)', display: 'block', marginBottom: '2px' }}>
                Lời nhận xét & góp ý của giảng viên:
              </span>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>{latestSubmitted.instructor_feedback}</p>
            </div>
          )}

          <div style={{ marginTop: '10px' }}>
            <button
              type="button"
              className="text-button"
              style={{ fontSize: '12px', padding: 0, textDecoration: 'underline' }}
              onClick={() => void openReview(latestSubmitted)}
            >
              {latestSubmitted.graded_at ? 'Xem lại bài làm và lời chấm của giảng viên >>' : 'Xem lại bài làm đã nộp >>'}
            </button>
          </div>
        </div>
      )}

      {/* Form làm bài thi của Học viên: CHỈ hiển thị khi !owner và attempt đang IN_PROGRESS */}
      {!owner && attempt?.quiz_id === quiz.id && attempt.status === 'IN_PROGRESS' && (
        <form
          onSubmit={e => {
            e.preventDefault();
            void submitAttempt();
          }}
          style={{ marginTop: '14px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}
        >
          {quiz.time_limit_minutes && quiz.time_limit_minutes > 0 && timeLeft !== null && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: '8px',
                background: timeLeft <= 60 ? 'rgba(220, 38, 38, 0.12)' : 'rgba(33, 99, 79, 0.1)',
                border: `1px solid ${timeLeft <= 60 ? '#dc2626' : 'var(--green)'}`,
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: timeLeft <= 60 ? '#dc2626' : 'var(--green)' }}>
                  Thời gian làm bài còn lại:
                </span>
                {timeLeft <= 60 && (
                  <span className="badge" style={{ background: '#dc2626', color: '#fff', fontSize: '11px', fontWeight: 700 }}>
                    Sắp hết giờ!
                  </span>
                )}
              </div>
              <strong style={{ fontSize: '20px', color: timeLeft <= 60 ? '#dc2626' : 'var(--green)', fontFamily: 'monospace' }}>
                {formatTimeRemaining(timeLeft)}
              </strong>
            </div>
          )}
          <p className="small" style={{ color: 'var(--text-muted)' }}>
            Lượt làm {attempt.attempt_number} / {quiz.max_attempts}. Trả lời đầy đủ các câu hỏi dưới đây trước khi nộp bài.
            {quiz.time_limit_minutes ? ` Hệ thống sẽ tự động nộp bài khi hết ${quiz.time_limit_minutes} phút.` : ''}
          </p>

          {quiz.questions.map((q, idx) => {
            const qType = q.question_type || 'MULTIPLE_CHOICE';
            return (
              <fieldset key={q.id} style={{ margin: '14px 0', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px' }}>
                <legend style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                  Câu {idx + 1}: {q.text}
                  <span className="badge" style={{ marginLeft: '8px', fontSize: '10px' }}>
                    {qType === 'MULTIPLE_CHOICE' && 'Trắc nghiệm'}
                    {qType === 'ESSAY' && 'Tự luận'}
                    {qType === 'FILE_UPLOAD' && 'Nộp tệp tài liệu'}
                  </span>
                </legend>

                {qType === 'MULTIPLE_CHOICE' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    {q.options.map(opt => (
                      <label key={opt.id} className="quiz-option" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id]?.option_id === opt.id}
                          onChange={() => setAnswers(prev => ({ ...prev, [q.id]: { option_id: opt.id } }))}
                        />
                        <span>{opt.text}</span>
                      </label>
                    ))}
                  </div>
                )}

                {qType === 'ESSAY' && (
                  <div style={{ marginTop: '8px' }}>
                    <textarea
                      rows={4}
                      placeholder="Nhập nội dung bài làm tự luận của bạn..."
                      value={answers[q.id]?.text_response || ''}
                      onChange={e => setAnswers(prev => ({
                        ...prev,
                        [q.id]: { text_response: e.target.value }
                      }))}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        fontSize: '14px',
                      }}
                    />
                  </div>
                )}

                {qType === 'FILE_UPLOAD' && (
                  <div style={{ marginTop: '8px', padding: '14px', border: '1px dashed var(--border-color)', borderRadius: '8px', background: 'var(--bg-elevated)' }}>
                    <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="file"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setAnswers(prev => ({
                              ...prev,
                              [q.id]: {
                                file_name: file.name,
                                file_url: URL.createObjectURL(file),
                              }
                            }));
                          }
                        }}
                      />
                      <span className="small">Chọn tệp tài liệu nộp bài (PDF, DOCX, ZIP, MP4...)</span>
                    </label>
                    {answers[q.id]?.file_name && (
                      <p className="small" style={{ margin: '8px 0 0', color: 'var(--green)' }}>
                        Đã chọn tệp: <strong>{answers[q.id]?.file_name}</strong>
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}

          <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
            <button disabled={busy} className="primary">
              {busy ? 'Đang nộp bài…' : 'Nộp bài kiểm tra'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setAttempt(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {/* Modal xem lại chi tiết bài làm (Dành cho Học viên) */}
      {showReviewModal && reviewAttempt && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 11000,
            padding: '20px',
          }}
        >
          <div
            className="modal-content panel"
            style={{
              maxWidth: '750px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: 'var(--bg-surface)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px' }}>Chi tiết bài làm: {quiz.title}</h3>
                <span className="small" style={{ color: 'var(--text-muted)' }}>
                  Lượt nộp {reviewAttempt.attempt_number} · Điểm số: {reviewAttempt.score !== null && reviewAttempt.score !== undefined ? Number(reviewAttempt.score).toFixed(1) : (((reviewAttempt.correct_count ?? 0) / (reviewAttempt.question_count || 1)) * 100).toFixed(1)} / 100 điểm · [{reviewAttempt.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}]
                </span>
              </div>
              <button
                type="button"
                className="secondary"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setShowReviewModal(false)}
              >
                Đóng
              </button>
            </div>

            {!reviewAttempt.graded_at && (
              <div style={{ marginBottom: '16px', padding: '12px 14px', background: 'rgba(217, 119, 6, 0.08)', borderRadius: '8px', borderLeft: '4px solid #d97706' }}>
                <strong style={{ fontSize: '13px', display: 'block', color: '#d97706', marginBottom: '2px' }}>
                  Trạng thái: Đang chờ giảng viên chấm điểm
                </strong>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Bài làm của bạn đã được nộp thành công và đang chờ giảng viên chấm điểm. Điểm số chính thức và nhận xét góp ý sẽ hiển thị tại đây ngay khi giảng viên hoàn tất chấm bài.
                </p>
              </div>
            )}

            {reviewAttempt.instructor_feedback && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(33, 99, 79, 0.08)', borderRadius: '8px', borderLeft: '4px solid var(--green)' }}>
                <strong style={{ fontSize: '13px', display: 'block', color: 'var(--green)', marginBottom: '4px' }}>
                  Nhận xét & đánh giá của giảng viên:
                </strong>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                  {reviewAttempt.instructor_feedback}
                </p>
                {reviewAttempt.graded_at && (
                  <span className="small" style={{ color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                    Chấm ngày: {new Date(reviewAttempt.graded_at).toLocaleString('vi-VN')}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gap: '14px' }}>
              {quiz.questions.map((q, idx) => {
                const ans = (reviewAttempt.answers || []).find(a => a.question_id === q.id);
                const qType = q.question_type || 'MULTIPLE_CHOICE';

                return (
                  <div
                    key={q.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-elevated)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>
                        Câu {idx + 1}: {q.text}
                      </span>
                      <span className="badge" style={{ fontSize: '10px' }}>
                        {qType === 'MULTIPLE_CHOICE' ? 'Trắc nghiệm' : qType === 'ESSAY' ? 'Tự luận' : 'Nộp tệp'}
                      </span>
                    </div>

                    {qType === 'MULTIPLE_CHOICE' && (
                      <div style={{ display: 'grid', gap: '4px', marginTop: '6px' }}>
                        {q.options.map(opt => {
                          const isSelected = ans?.option_id === opt.id;
                          return (
                            <div
                              key={opt.id}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '4px',
                                fontSize: '13px',
                                border: isSelected ? '1px solid var(--green)' : '1px solid transparent',
                                background: isSelected ? 'rgba(33, 99, 79, 0.12)' : 'transparent',
                                display: 'flex',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span>{opt.text}</span>
                              {isSelected && <span className="badge ready" style={{ fontSize: '10px' }}>Đã chọn</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {qType === 'ESSAY' && (
                      <div style={{ marginTop: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Bài làm tự luận của bạn:</span>
                        <div
                          style={{
                            marginTop: '4px',
                            padding: '10px',
                            background: 'var(--bg-surface)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            fontSize: '13px',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {ans?.text_response || '(Chưa điền câu trả lời)'}
                        </div>
                      </div>
                    )}

                    {qType === 'FILE_UPLOAD' && (
                      <div style={{ marginTop: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tệp đính kèm bài làm:</span>
                        {ans?.file_name || ans?.file_url ? (
                          <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>{ans.file_name || 'Tệp nộp bài'}</span>
                            {ans.file_url && (
                              <a
                                href={ans.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="secondary"
                                style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none' }}
                              >
                                Xem / Tải về
                              </a>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>(Chưa nộp tệp)</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowReviewModal(false)}
              >
                Đóng xem lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal danh sách bài nộp & chấm bài (Dành cho Giảng viên) */}
      {showSubmissionsModal && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 11000,
            padding: '20px',
          }}
        >
          <div
            className="modal-content panel"
            style={{
              maxWidth: '800px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: 'var(--bg-surface)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            }}
          >
            {gradingSubmission ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '18px' }}>
                      Chấm bài: {gradingSubmission.user_name || 'Học viên'}
                    </h3>
                    <span className="small" style={{ color: 'var(--text-muted)' }}>
                      Email: {gradingSubmission.user_email} · Lượt {gradingSubmission.attempt_number} · Nộp lúc: {gradingSubmission.submitted_at ? new Date(gradingSubmission.submitted_at).toLocaleString('vi-VN') : 'Vừa xong'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => setGradingSubmission(null)}
                  >
                    Quay lại danh sách
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '14px', marginBottom: '20px' }}>
                  {quiz.questions.map((q, idx) => {
                    const ans = (gradingSubmission.answers || []).find(a => a.question_id === q.id);
                    const qType = q.question_type || 'MULTIPLE_CHOICE';

                    return (
                      <div
                        key={q.id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-elevated)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>
                            Câu {idx + 1}: {q.text}
                          </span>
                          <span className="badge" style={{ fontSize: '10px' }}>
                            {qType === 'MULTIPLE_CHOICE' ? 'Trắc nghiệm' : qType === 'ESSAY' ? 'Tự luận' : 'Nộp tệp'}
                          </span>
                        </div>

                        {qType === 'MULTIPLE_CHOICE' && (
                          <div style={{ display: 'grid', gap: '4px', marginTop: '6px' }}>
                            {q.options.map(opt => {
                              const isSelected = ans?.option_id === opt.id;
                              return (
                                <div
                                  key={opt.id}
                                  style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    fontSize: '13px',
                                    border: isSelected ? '1px solid var(--green)' : '1px solid transparent',
                                    background: isSelected ? 'rgba(33, 99, 79, 0.12)' : 'transparent',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                  }}
                                >
                                  <span>{opt.text}</span>
                                  {isSelected && <span className="badge ready" style={{ fontSize: '10px' }}>Học viên chọn</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {qType === 'ESSAY' && (
                          <div style={{ marginTop: '6px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Câu trả lời của học viên:</span>
                            <div
                              style={{
                                marginTop: '4px',
                                padding: '10px',
                                background: 'var(--bg-surface)',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                fontSize: '13px',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {ans?.text_response || '(Không có câu trả lời)'}
                            </div>
                          </div>
                        )}

                        {qType === 'FILE_UPLOAD' && (
                          <div style={{ marginTop: '6px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tệp đính kèm của học viên:</span>
                            {ans?.file_name || ans?.file_url ? (
                              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600 }}>{ans.file_name || 'Tệp tài liệu'}</span>
                                {ans.file_url && (
                                  <a
                                    href={ans.file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="secondary"
                                    style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none' }}
                                  >
                                    Tải về / Xem tệp
                                  </a>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>(Chưa nộp tệp)</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Form nhập điểm & nhận xét của GV */}
                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '15px' }}>Đánh giá và cho điểm</h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                    <label style={{ fontSize: '13px', display: 'block' }}>
                      Điểm số (thang điểm 100):
                      <input
                        type="number"
                        name="grade_score"
                        min={0}
                        max={100}
                        step={0.5}
                        value={gradingScore}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setGradingScore(val);
                          setGradingPassed(val >= quiz.pass_threshold);
                        }}
                        style={{ width: '100%', marginTop: '4px', padding: '8px' }}
                      />
                    </label>

                    <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={gradingPassed}
                        onChange={e => setGradingPassed(e.target.checked)}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontWeight: 600, color: gradingPassed ? 'var(--green)' : 'inherit' }}>
                        Đánh giá ĐẠT bài kiểm tra
                      </span>
                    </label>
                  </div>

                  <label style={{ fontSize: '13px', display: 'block', marginBottom: '14px' }}>
                    Nhận xét / Lời góp ý của giảng viên:
                    <textarea
                      rows={3}
                      name="grade_feedback"
                      value={gradingFeedback}
                      onChange={e => setGradingFeedback(e.target.value)}
                      placeholder="Nhập nhận xét chi tiết, góp ý sửa lỗi hoặc khen ngợi học viên..."
                      style={{ width: '100%', marginTop: '4px', padding: '8px', borderRadius: '6px' }}
                    />
                  </label>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                      type="button"
                      className="secondary"
                      disabled={gradingBusy}
                      onClick={() => setGradingSubmission(null)}
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={gradingBusy}
                      onClick={() => void saveGrade()}
                    >
                      {gradingBusy ? 'Đang lưu…' : 'Lưu kết quả chấm bài'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px' }}>Danh sách bài nộp của học viên</h3>
                    <span className="small" style={{ color: 'var(--text-muted)' }}>
                      {quiz.title} · Tổng số bài nộp: {submissions.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => setShowSubmissionsModal(false)}
                  >
                    Đóng
                  </button>
                </div>

                {submissions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)' }}>
                    Chưa có học viên nào nộp bài cho bài kiểm tra này.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                          <th style={{ padding: '8px' }}>Học viên</th>
                          <th style={{ padding: '8px' }}>Lần nộp</th>
                          <th style={{ padding: '8px' }}>Thời gian</th>
                          <th style={{ padding: '8px' }}>Điểm số</th>
                          <th style={{ padding: '8px' }}>Trạng thái</th>
                          <th style={{ padding: '8px', textAlign: 'right' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map(sub => (
                          <tr key={sub.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '8px' }}>
                              <strong style={{ display: 'block' }}>{sub.user_name || 'Học viên'}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sub.user_email}</span>
                            </td>
                            <td style={{ padding: '8px' }}>Lượt {sub.attempt_number}</td>
                            <td style={{ padding: '8px' }}>{sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('vi-VN') : ''}</td>
                            <td style={{ padding: '8px' }}>
                              <strong>{sub.score !== null && sub.score !== undefined ? `${Number(sub.score).toFixed(1)}/100` : 'Chưa chấm'}</strong>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                <span className={`badge ${sub.graded_at ? 'ready' : ''}`} style={{ fontSize: '10px' }}>
                                  {sub.graded_at ? 'Đã chấm' : 'Chờ chấm'}
                                </span>
                                <span className={`badge ${sub.passed ? 'ready' : ''}`} style={{ fontSize: '10px' }}>
                                  {sub.passed ? 'Đạt' : 'Chưa'}
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="primary"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                onClick={() => void openGrading(sub)}
                              >
                                Chấm bài
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function QuizCreatorForm({
  courseId,
  moduleId,
  lessonId,
  onDone,
  onCancel,
}: {
  courseId: string;
  moduleId?: string | null;
  lessonId?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [passThreshold, setPassThreshold] = useState(70);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [timeLimitMode, setTimeLimitMode] = useState<'UNLIMITED' | 'LIMITED'>('UNLIMITED');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(15);
  const [questions, setQuestions] = useState<QuizQuestionDraft[]>([newQuestion('MULTIPLE_CHOICE')]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function addQuestion(type: QuestionType) {
    setQuestions(prev => [...prev, newQuestion(type)]);
  }

  function removeQuestion(index: number) {
    setQuestions(prev => prev.filter((_, i) => i !== index));
  }

  function addOption(qIndex: number) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIndex) return q;
      return {
        ...q,
        options: [...q.options, { text: '', is_correct: false }],
      };
    }));
  }

  function removeOption(qIndex: number, optIndex: number) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIndex) return q;
      return {
        ...q,
        options: q.options.filter((_, oIdx) => oIdx !== optIndex),
      };
    }));
  }

  async function saveQuiz(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const payloadQuestions = questions.map(q => {
        if (q.question_type === 'MULTIPLE_CHOICE') {
          return {
            text: q.text.trim(),
            question_type: q.question_type,
            options: q.options.map(o => ({ text: o.text.trim(), is_correct: o.is_correct })),
          };
        }
        return {
          text: q.text.trim(),
          question_type: q.question_type,
          options: [],
        };
      });

      const { error } = await session.api.POST('/api/v1/courses/{id}/quizzes', {
        params: { path: { id: courseId } },
        body: {
          title: title.trim(),
          module_id: moduleId || undefined,
          lesson_id: lessonId || undefined,
          required: true,
          pass_threshold: passThreshold,
          max_attempts: maxAttempts,
          time_limit_minutes: timeLimitMode === 'LIMITED' ? Number(timeLimitMinutes) : null,
          questions: payloadQuestions,
        },
      });

      if (error) throw new Error(error.message);
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Chưa lưu được bài kiểm tra.');
      setBusy(false);
    }
  }

  return (
    <form className="panel quiz-builder" onSubmit={saveQuiz} style={{ marginTop: '12px', border: '1px solid var(--green)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, color: 'var(--green)' }}>
          {lessonId ? 'Tạo bài kiểm tra cho bài giảng' : moduleId ? 'Tạo bài kiểm tra cho chương' : 'Tạo bài kiểm tra'}
        </h4>
        <button type="button" className="text-button" onClick={onCancel}>Đóng</button>
      </div>

      {message && <p className="notice" role="alert">{message}</p>}

      <label>
        Tên bài kiểm tra
        <input
          required
          maxLength={200}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Ví dụ: Kiểm tra trắc nghiệm & tự luận Chương 1"
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '10px 0' }}>
        <label>
          Ngưỡng đạt (%)
          <input
            type="number"
            min={1}
            max={100}
            value={passThreshold}
            onChange={e => setPassThreshold(Number(e.target.value))}
          />
        </label>
        <label>
          Số lượt làm tối đa
          <input
            type="number"
            min={1}
            max={3}
            value={maxAttempts}
            onChange={e => setMaxAttempts(Number(e.target.value))}
          />
        </label>
      </div>

      <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-elevated)' }}>
        <strong style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>Hình thức thời gian làm bài:</strong>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0, fontWeight: 500, fontSize: '13px' }}>
            <input
              type="radio"
              name="quizTimeLimitMode"
              checked={timeLimitMode === 'UNLIMITED'}
              onChange={() => setTimeLimitMode('UNLIMITED')}
              style={{ width: '16px', height: '16px', margin: 0 }}
            />
            Không giới hạn thời gian
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0, fontWeight: 500, fontSize: '13px' }}>
            <input
              type="radio"
              name="quizTimeLimitMode"
              checked={timeLimitMode === 'LIMITED'}
              onChange={() => setTimeLimitMode('LIMITED')}
              style={{ width: '16px', height: '16px', margin: 0 }}
            />
            Có giới hạn thời gian
          </label>
        </div>
        {timeLimitMode === 'LIMITED' && (
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '13px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Thời gian làm bài:
              <input
                type="number"
                min={1}
                max={300}
                value={timeLimitMinutes}
                onChange={e => setTimeLimitMinutes(Math.max(1, Math.min(300, Number(e.target.value))))}
                style={{ width: '90px', padding: '6px 10px' }}
              />
              phút
            </label>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              (Hệ thống sẽ tự động thu bài khi hết giờ)
            </span>
          </div>
        )}
      </div>

      <div style={{ margin: '16px 0 10px' }}>
        <strong style={{ fontSize: '14px' }}>Danh sách câu hỏi ({questions.length})</strong>
      </div>

      {questions.map((q, i) => (
        <fieldset key={i} style={{ marginBottom: '16px', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <legend style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Câu {i + 1}
            </legend>
            {questions.length > 1 && (
              <button
                type="button"
                className="text-button danger"
                style={{ fontSize: '12px' }}
                onClick={() => removeQuestion(i)}
              >
                Xóa câu
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', marginBottom: '10px' }}>
            <label>
              Loại câu hỏi
              <select
                value={q.question_type}
                onChange={e => {
                  const type = e.target.value as QuestionType;
                  setQuestions(items => items.map((v, j) => {
                    if (j !== i) return v;
                    return {
                      ...v,
                      question_type: type,
                      options: type === 'MULTIPLE_CHOICE' && v.options.length < 2 ? [
                        { text: '', is_correct: true },
                        { text: '', is_correct: false },
                      ] : v.options,
                    };
                  }));
                }}
              >
                <option value="MULTIPLE_CHOICE">Trắc nghiệm</option>
                <option value="ESSAY">Tự luận</option>
                <option value="FILE_UPLOAD">Nộp tệp tài liệu</option>
              </select>
            </label>
            <label>
              Nội dung câu hỏi / Yêu cầu
              <input
                required
                maxLength={2000}
                value={q.text}
                onChange={e => setQuestions(items => items.map((v, j) => i === j ? { ...v, text: e.target.value } : v))}
                placeholder={q.question_type === 'MULTIPLE_CHOICE' ? 'Nhập câu hỏi trắc nghiệm...' : q.question_type === 'ESSAY' ? 'Nhập câu hỏi tự luận...' : 'Nhập yêu cầu nộp tệp bài tập / tài liệu...'}
              />
            </label>
          </div>

          {q.question_type === 'MULTIPLE_CHOICE' && (
            <div style={{ paddingLeft: '8px' }}>
              <p className="small" style={{ margin: '4px 0 8px', color: 'var(--text-muted)' }}>
                Tích chọn hình tròn trước đáp án đúng:
              </p>
              {q.options.map((o, k) => (
                <div className="option-editor" key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <input
                    type="radio"
                    name={`correct-${i}`}
                    checked={o.is_correct}
                    onChange={() => setQuestions(items => items.map((v, j) => i === j ? { ...v, options: v.options.map((a, n) => ({ ...a, is_correct: n === k })) } : v))}
                    title="Đánh dấu đây là đáp án đúng"
                  />
                  <input
                    required
                    maxLength={1000}
                    value={o.text}
                    onChange={e => setQuestions(items => items.map((v, j) => i === j ? { ...v, options: v.options.map((a, n) => n === k ? { ...a, text: e.target.value } : a) } : v))}
                    placeholder={`Lựa chọn ${k + 1}`}
                    style={{ flex: 1 }}
                  />
                  {q.options.length > 2 && (
                    <button
                      type="button"
                      className="text-button danger"
                      style={{ fontSize: '12px' }}
                      onClick={() => removeOption(i, k)}
                      title="Xóa lựa chọn này"
                    >
                      Xóa
                    </button>
                  )}
                </div>
              ))}
              {q.options.length < 6 && (
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: '12px', marginTop: '4px' }}
                  onClick={() => addOption(i)}
                >
                  + Thêm lựa chọn
                </button>
              )}
            </div>
          )}

          {q.question_type === 'ESSAY' && (
            <div style={{ padding: '10px', background: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Học viên sẽ làm bài bằng cách viết nội dung tự luận vào khung văn bản.
            </div>
          )}

          {q.question_type === 'FILE_UPLOAD' && (
            <div style={{ padding: '10px', background: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Học viên sẽ nộp bài bằng cách tải lên tệp tài liệu (PDF, Word, Zip, ảnh báo cáo, ...).
            </div>
          )}
        </fieldset>
      ))}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '14px 0' }}>
        <button type="button" className="secondary" onClick={() => addQuestion('MULTIPLE_CHOICE')}>
          + Thêm câu trắc nghiệm
        </button>
        <button type="button" className="secondary" onClick={() => addQuestion('ESSAY')}>
          + Thêm câu tự luận
        </button>
        <button type="button" className="secondary" onClick={() => addQuestion('FILE_UPLOAD')}>
          + Thêm câu nộp tệp tài liệu
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button className="primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu bài kiểm tra'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Hủy bỏ
        </button>
      </div>
    </form>
  );
}

export function ChapterQuizSection({
  courseId,
  moduleId,
  editable,
  owner,
}: {
  courseId: string;
  moduleId: string;
  editable: boolean;
  owner: boolean;
}) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const loadQuizzes = useCallback(async () => {
    try {
      const { data } = await session.api.GET('/api/v1/courses/{id}/quizzes', {
        params: { path: { id: courseId } },
      });
      if (data) {
        setQuizzes(data.filter(q => q.module_id === moduleId && !q.lesson_id));
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [courseId, moduleId]);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  return (
    <div className="chapter-quizzes-wrapper" style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Bài kiểm tra chương ({quizzes.length})
        </span>
        {editable && !isBuilding && (
          <button
            type="button"
            className="secondary"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setIsBuilding(true)}
          >
            + Thêm bài kiểm tra chương
          </button>
        )}
      </div>

      {isBuilding && (
        <QuizCreatorForm
          courseId={courseId}
          moduleId={moduleId}
          onDone={() => {
            setIsBuilding(false);
            void loadQuizzes();
          }}
          onCancel={() => setIsBuilding(false)}
        />
      )}

      {quizzes.map(q => (
        <QuizCard
          key={q.id}
          quiz={q}
          editable={editable}
          owner={owner}
          onDeleted={() => void loadQuizzes()}
        />
      ))}
    </div>
  );
}

export function LessonQuizSection({
  courseId,
  lessonId,
  editable,
  owner,
}: {
  courseId: string;
  lessonId: string;
  editable: boolean;
  owner: boolean;
}) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const loadQuizzes = useCallback(async () => {
    try {
      const { data } = await session.api.GET('/api/v1/courses/{id}/quizzes', {
        params: { path: { id: courseId } },
      });
      if (data) {
        setQuizzes(data.filter(q => q.lesson_id === lessonId));
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [courseId, lessonId]);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  return (
    <div className="lesson-quizzes-wrapper" style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Bài kiểm tra bài học ({quizzes.length})
        </span>
        {editable && !isBuilding && (
          <button
            type="button"
            className="text-button"
            style={{ fontSize: '12px' }}
            onClick={() => setIsBuilding(true)}
          >
            + Thêm bài kiểm tra bài học
          </button>
        )}
      </div>

      {isBuilding && (
        <QuizCreatorForm
          courseId={courseId}
          lessonId={lessonId}
          onDone={() => {
            setIsBuilding(false);
            void loadQuizzes();
          }}
          onCancel={() => setIsBuilding(false)}
        />
      )}

      {quizzes.map(q => (
        <QuizCard
          key={q.id}
          quiz={q}
          editable={editable}
          owner={owner}
          onDeleted={() => void loadQuizzes()}
        />
      ))}
    </div>
  );
}

export function CourseLearning({
  courseId,
  owner,
}: {
  courseId: string;
  owner: boolean;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const load = useCallback(async () => {
    if (owner) {
      const r = await session.api.GET('/api/v1/courses/{id}/analytics', { params: { path: { id: courseId } } });
      if (r.data) setAnalytics(r.data);
    } else {
      const r = await session.api.GET('/api/v1/me/courses/{id}/progress', { params: { path: { id: courseId } } });
      if (r.data) setProgress(r.data);
    }
  }, [courseId, owner]);

  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    const refresh = () => void load().catch(() => {});
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  return (
    <section className="course-learning">
      {progress && (
        <div className="panel progress-panel">
          <div>
            <p className="eyebrow">LỘ TRÌNH CỦA BẠN</p>
            <h3>
              {progress.complete
                ? 'Bạn đã hoàn thành khóa học'
                : `${progress.completed_count} / ${progress.required_count} nội dung bắt buộc`}
            </h3>
            <progress value={progress.completed_count} max={Math.max(1, progress.required_count)} />
          </div>
          {progress.lessons.map(l => (
            <p key={l.lesson_id}>
              <span
                className={`badge ${l.complete ? 'ready' : ''}`}
                style={{ marginRight: '8px', fontSize: '11px', padding: '2px 8px' }}
              >
                {l.complete ? 'Đã học' : 'Chưa xong'}
              </span>
              {l.title}
              <strong>{Math.round(l.watched_ratio * 100)}%</strong>
            </p>
          ))}
        </div>
      )}

      {analytics && (
        <div className="panel">
          <p className="eyebrow">TÌNH HÌNH HỌC TẬP</p>
          <div className="metric-grid">
            <div>
              <strong>{analytics.enrolled}</strong>
              <span>học viên</span>
            </div>
            <div>
              <strong>{analytics.completed}</strong>
              <span>hoàn thành</span>
            </div>
            <div>
              <strong>{analytics.average_best_score === null ? '—' : analytics.average_best_score.toFixed(1)}</strong>
              <span>điểm trung bình</span>
            </div>
          </div>
          <p className="small">
            {analytics.submitted} người đã nộp · {analytics.not_submitted} người chưa nộp. {analytics.cohort}
          </p>
        </div>
      )}
    </section>
  );
}
