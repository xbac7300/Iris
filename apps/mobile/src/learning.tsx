import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { randomUUID } from 'expo-crypto';
import { components, ProgressTracker } from '@lms/api-client';
import { session } from './session';
import { useTheme } from './theme';

type Playback = components['schemas']['PlaybackDto'];
type Transcript = components['schemas']['TranscriptDto'];
type Summary = components['schemas']['SummaryDto'];
type Chat = components['schemas']['ChatDto'];
type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Attempt = components['schemas']['AttemptDto'];

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

// ==========================================
// 1. NATIVE LESSON PLAYER & TABS
// ==========================================
export function NativeLesson({
  playback,
  onSeek,
}: {
  playback: Playback;
  onSeek?: () => void;
}) {
  const player = useVideoPlayer(playback.url);
  const [tab, setTab] = useState<'summary' | 'transcript' | 'chat'>('summary');
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Chat[]>([]);
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const tracker = useRef<ProgressTracker | null>(null);
  const recovered = useRef(false);

  useEffect(() => {
    if (!session) return;
    const tracking = new ProgressTracker(session, playback.lesson_id, randomUUID, setMessage);
    tracker.current = tracking;

    let resume: number | null = null;
    let active = true;

    const ready = () => {
      if (resume !== null && player.status === 'readyToPlay') {
        player.currentTime = resume;
        resume = null;
      }
    };

    void tracking.start().then(position => {
      if (active) {
        resume = position;
        ready();
      }
    }).catch(() => setMessage('Chưa mở được phiên lưu tiến độ.'));

    const listener = player.addListener('statusChange', event => {
      ready();
      if (event.status === 'error' && !recovered.current) {
        recovered.current = true;
        const position = player.currentTime;
        void session!.api.GET('/api/v1/lessons/{id}/playback', {
          params: { path: { id: playback.lesson_id } },
        }).then(async r => {
          if (r.data && active) {
            await player.replaceAsync(r.data.url);
            if (active) player.currentTime = position;
          } else if (active) {
            setMessage('Chưa phát được video; mở lại bài để thử.');
          }
        }).catch(() => setMessage('Mất kết nối video.'));
      }
    });

    const tick = setInterval(() => {
      if (active) {
        tracking.sample(
          player.currentTime,
          AppState.currentState === 'active' && player.playing && player.status === 'readyToPlay',
          player.playbackRate,
          performance.now()
        );
      }
    }, 1000);

    const flush = setInterval(() => void tracking.flush(), 10000);
    const lifecycle = AppState.addEventListener('change', () => {
      tracking.reset();
      void tracking.flush();
    });

    const loadData = async () => {
      const [t, s, h] = await Promise.all([
        session!.api.GET('/api/v1/lessons/{id}/transcript', {
          params: { path: { id: playback.lesson_id } },
        }),
        session!.api.GET('/api/v1/lessons/{id}/summary', {
          params: { path: { id: playback.lesson_id } },
        }),
        session!.api.GET('/api/v1/me/conversations', {
          params: { query: { lesson_id: playback.lesson_id, limit: 20 } },
        }),
      ]);
      if (active) {
        if (t.data) setTranscript(t.data);
        if (s.data) setSummary(s.data);
        if (h.data) setHistory(h.data);
      }
    };

    void loadData().catch(() => {});
    const poll = setInterval(() => void loadData().catch(() => {}), 6000);

    return () => {
      active = false;
      listener.remove();
      lifecycle.remove();
      clearInterval(tick);
      clearInterval(flush);
      clearInterval(poll);
      void tracking.flush().finally(() => tracking.close());
      tracker.current = null;
    };
  }, [playback.lesson_id, player]);

  const seek = (seconds: number) => {
    tracker.current?.reset();
    player.currentTime = seconds;
    player.play();
    onSeek?.();
  };

  const renderCitations = (list: components['schemas']['CitationDto'][]) => {
    if (!list || list.length === 0) return null;
    return (
      <View style={styles.citationsContainer}>
        {list.map(c => (
          <TouchableOpacity
            key={c.chunk_id}
            style={styles.citationPill}
            onPress={() => {
              if (c.media_version === playback.media_version) {
                seek(c.start_sec);
              } else {
                setMessage('Nguồn thuộc bản video cũ.');
              }
            }}
          >
            <Text style={styles.citationTime}>▷ {formatTime(c.start_sec)}</Text>
            <Text numberOfLines={2} style={styles.citationExcerpt}>
              {c.excerpt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const handleSendQuestion = async () => {
    if (!session || !question.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await session.api.POST('/api/v1/lessons/{id}/chat', {
        params: { path: { id: playback.lesson_id } },
        body: {
          question: question.trim(),
          request_key: randomUUID(),
          conversation_id: history.at(-1)?.conversation_id,
        },
      });
      if (res.data) {
        setHistory(h => [...h, res.data!]);
        setQuestion('');
      } else {
        setMessage(res.error?.message ?? 'Chưa trả lời được.');
      }
    } catch {
      setMessage('Chưa kết nối được đến mô hình AI.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.lessonCard}>
      {/* Video Player */}
      <View style={styles.videoWrapper}>
        <VideoView player={player} nativeControls style={styles.videoPlayer} />
      </View>

      {message ? (
        <View style={styles.lessonAlert}>
          <Text style={styles.lessonAlertText}>{message}</Text>
        </View>
      ) : (
        <Text style={styles.statusHint}>Tiến độ xem video được ghi nhận tự động.</Text>
      )}

      {/* Tabs navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, tab === 'summary' && styles.tabItemActive]}
          onPress={() => setTab('summary')}
        >
          <Text style={[styles.tabText, tab === 'summary' && styles.tabTextActive]}>
            Tóm tắt bài
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, tab === 'transcript' && styles.tabItemActive]}
          onPress={() => setTab('transcript')}
        >
          <Text style={[styles.tabText, tab === 'transcript' && styles.tabTextActive]}>
            Transcript
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, tab === 'chat' && styles.tabItemActive]}
          onPress={() => setTab('chat')}
        >
          <Text style={[styles.tabText, tab === 'chat' && styles.tabTextActive]}>
            Hỏi đáp AI
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB CONTENT: Summary */}
      {tab === 'summary' && (
        <View style={styles.tabPanel}>
          {summary?.status === 'READY' ? (
            summary.sections.map((sec, idx) => (
              <View key={idx} style={styles.summarySection}>
                <Text style={styles.summaryAnswer}>{sec.answer}</Text>
                {renderCitations(sec.citations)}
              </View>
            ))
          ) : (
            <View style={styles.emptyTabBox}>
              <Text style={styles.emptyTabText}>
                Tóm tắt toàn bài đang được chuẩn bị. Bạn có thể xem video trong lúc chờ.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* TAB CONTENT: Transcript */}
      {tab === 'transcript' && (
        <View style={styles.tabPanel}>
          {transcript && transcript.segments && transcript.segments.length > 0 ? (
            transcript.segments.map((seg, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.transcriptRow}
                onPress={() => seek(seg.start_sec)}
              >
                <View style={styles.timestampBadge}>
                  <Text style={styles.timestampBadgeText}>▷ {formatTime(seg.start_sec)}</Text>
                </View>
                <Text style={styles.transcriptText}>{seg.text}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyTabBox}>
              <Text style={styles.emptyTabText}>
                Transcript đang được AI trích xuất và đồng bộ timestamp...
              </Text>
            </View>
          )}
        </View>
      )}

      {/* TAB CONTENT: AI Chat */}
      {tab === 'chat' && (
        <View style={styles.tabPanel}>
          <Text style={styles.chatHint}>
            Hỏi bất kỳ điều gì về bài học này. Nhấn nguồn trích dẫn để tua video xem lại.
          </Text>

          {/* Chat history */}
          <View style={styles.chatHistory}>
            {history.map(msg => (
              <View key={msg.id} style={styles.chatMessagePair}>
                {/* User Question */}
                <View style={styles.chatQuestionBubble}>
                  <Text style={styles.chatQuestionText}>{msg.question}</Text>
                </View>

                {/* AI Answer */}
                <View style={styles.chatAnswerBubble}>
                  <Text style={styles.chatAnswerText}>{msg.answer}</Text>
                  {renderCitations(msg.citations)}
                </View>
              </View>
            ))}
          </View>

          {/* Chat Input */}
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Bạn muốn hiểu rõ phần nào?"
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={1500}
              value={question}
              onChangeText={setQuestion}
            />
            <TouchableOpacity
              style={[styles.chatSendBtn, (!question.trim() || busy) && styles.buttonDisabled]}
              onPress={handleSendQuestion}
              disabled={!question.trim() || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.chatSendBtnText}>Gửi</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ==========================================
// 2. NATIVE QUIZ & GRADING
// ==========================================
type MobileAnswer = { option_id?: string; text_response?: string; file_name?: string };

export function NativeQuiz({
  quiz,
  isOwner,
  onResult,
}: {
  quiz: Quiz;
  isOwner: boolean;
  onResult: () => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, MobileAnswer>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Student attempts history
  const [myAttempts, setMyAttempts] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Instructor grading mode
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [gradingModal, setGradingModal] = useState<any | null>(null);
  const [gradingScore, setGradingScore] = useState<string>('70');
  const [gradingPassed, setGradingPassed] = useState<boolean>(true);
  const [gradingFeedback, setGradingFeedback] = useState<string>('');
  const [gradingBusy, setGradingBusy] = useState(false);

  const loadMyAttempts = useCallback(async () => {
    if (isOwner || !session) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/my-attempts' as any, {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        setMyAttempts(data);
        if (data.length > 0) {
          setAttempt(prev => (prev?.status === 'IN_PROGRESS' ? prev : data[0]));
        }
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [quiz.id, isOwner]);

  const loadSubmissions = useCallback(async () => {
    if (!isOwner || !session) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/submissions' as any, {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        setSubmissions(data);
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [quiz.id, isOwner]);

  useEffect(() => {
    void loadMyAttempts();
    void loadSubmissions();
  }, [loadMyAttempts, loadSubmissions]);

  // Timer countdown for timed quizzes
  useEffect(() => {
    if (attempt?.status === 'IN_PROGRESS' && quiz.time_limit_minutes && quiz.time_limit_minutes > 0) {
      const totalSeconds = quiz.time_limit_minutes * 60;
      setTimeLeft(totalSeconds);

      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            // Auto submit when time runs out
            void submitQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    } else {
      setTimeLeft(null);
    }
  }, [attempt?.status, quiz.time_limit_minutes]);

  const beginAttempt = async () => {
    if (!session) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await session.api.POST('/api/v1/quizzes/{id}/attempts', {
        params: { path: { id: quiz.id } },
      });
      if (!r.data) throw new Error(r.error?.message);
      setAttempt(r.data);
      setAnswers({});
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa mở được lượt thi.');
    } finally {
      setBusy(false);
    }
  };

  const submitQuiz = async () => {
    if (!session || !attempt) return;
    setBusy(true);
    setMessage('');
    try {
      let result: Attempt | undefined;
      try {
        const r = await session.api.POST('/api/v1/attempts/{id}/submit', {
          params: { path: { id: attempt.id } },
          body: {
            idempotency_key: randomUUID(),
            answers: Object.entries(answers).map(([question_id, ans]) => ({
              question_id,
              option_id: ans.option_id,
              text_response: ans.text_response,
              file_name: ans.file_name,
            })),
          },
        });
        if (!r.data) throw new Error(r.error?.message);
        result = r.data;
      } catch (e) {
        const check = await session.api.GET('/api/v1/attempts/{id}', {
          params: { path: { id: attempt.id } },
        });
        if (check.data?.status !== 'SUBMITTED') throw e;
        result = check.data;
      }
      setAttempt(result);
      void loadMyAttempts();
      onResult();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa nộp được bài kiểm tra.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveGrade = async () => {
    if (!session || !gradingModal) return;
    setGradingBusy(true);
    try {
      const scoreNum = parseFloat(gradingScore) || 0;
      const { data, error } = await session.api.POST('/api/v1/attempts/{id}/grade' as any, {
        params: { path: { id: gradingModal.id } },
        body: {
          score: scoreNum,
          passed: gradingPassed,
          feedback: gradingFeedback.trim(),
        },
      });
      if (error) throw new Error(error.message);
      setGradingModal(null);
      void loadSubmissions();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi lưu điểm.');
    } finally {
      setGradingBusy(false);
    }
  };

  return (
    <View style={styles.quizCard}>
      {/* Quiz Header */}
      <View style={styles.quizHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.quizTitle}>{quiz.title}</Text>
          <Text style={styles.quizMeta}>
            {quiz.questions.length} câu hỏi · Ngưỡng đạt {quiz.pass_threshold}% · Tối đa{' '}
            {quiz.max_attempts} lượt
            {quiz.time_limit_minutes ? ` · Thời gian: ${quiz.time_limit_minutes} phút` : ''}
          </Text>
        </View>

        {/* Timed countdown timer badge */}
        {timeLeft !== null && (
          <View style={styles.timerBadge}>
            <Text style={styles.timerText}>
              ⏱ {formatTime(timeLeft)}
            </Text>
          </View>
        )}
      </View>

      {message ? (
        <View style={styles.lessonAlert}>
          <Text style={styles.lessonAlertText}>{message}</Text>
        </View>
      ) : null}

      {/* INSTRUCTOR MODE: Submissions & Grading */}
      {isOwner ? (
        <View style={styles.instructorGradingSection}>
          <Text style={styles.sectionSubtitle}>
            Quản trị & Chấm bài học viên ({submissions.length} bài nộp)
          </Text>

          {submissions.length === 0 ? (
            <Text style={styles.emptyNotice}>Chưa có học viên nào nộp bài kiểm tra này.</Text>
          ) : (
            submissions.map(sub => (
              <View key={sub.id} style={styles.submissionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.submissionName}>
                    {sub.user_name || 'Học viên'}
                  </Text>
                  <Text style={styles.submissionMeta}>
                    Email: {sub.user_email} · Lượt {sub.attempt_number} ·{' '}
                    {sub.submitted_at
                      ? new Date(sub.submitted_at).toLocaleString('vi-VN')
                      : 'Đang làm'}
                  </Text>
                  <Text
                    style={[
                      styles.submissionGrade,
                      sub.passed ? styles.textSuccess : styles.textDanger,
                    ]}
                  >
                    Điểm: {sub.score?.toFixed(1) ?? '--'} ({sub.passed ? 'Đạt' : 'Chưa đạt'})
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.gradeButton}
                  onPress={() => {
                    setGradingModal(sub);
                    setGradingScore(String(sub.score ?? 70));
                    setGradingPassed(Boolean(sub.passed));
                    setGradingFeedback(sub.instructor_feedback || '');
                  }}
                >
                  <Text style={styles.gradeButtonText}>Chấm bài</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      ) : (
        /* STUDENT MODE: Quiz Taking & History */
        <View style={styles.studentQuizSection}>
          {/* Active quiz in progress */}
          {attempt?.status === 'IN_PROGRESS' ? (
            <View style={styles.questionsContainer}>
              <Text style={styles.attemptInfo}>
                Lượt làm thứ {attempt.attempt_number}. Vui lòng trả lời các câu hỏi bên dưới:
              </Text>

              {quiz.questions.map((q, idx) => {
                const qType = (q as any).question_type || 'MULTIPLE_CHOICE';
                return (
                  <View key={q.id} style={styles.questionCard}>
                    <View style={styles.questionCardHeader}>
                      <Text style={styles.questionNumberText}>
                        Câu {idx + 1}: {q.text}
                      </Text>
                      <View style={styles.qTypeBadge}>
                        <Text style={styles.qTypeBadgeText}>
                          {qType === 'ESSAY'
                            ? 'Tự luận'
                            : qType === 'FILE_UPLOAD'
                            ? 'Nộp tệp'
                            : 'Trắc nghiệm'}
                        </Text>
                      </View>
                    </View>

                    {/* Multiple choice options */}
                    {qType === 'MULTIPLE_CHOICE' && (
                      <View style={styles.optionsList}>
                        {q.options.map(opt => {
                          const isChecked = answers[q.id]?.option_id === opt.id;
                          return (
                            <TouchableOpacity
                              key={opt.id}
                              style={[
                                styles.optionRow,
                                isChecked && styles.optionRowChecked,
                              ]}
                              onPress={() =>
                                setAnswers(a => ({
                                  ...a,
                                  [q.id]: { ...a[q.id], option_id: opt.id },
                                }))
                              }
                            >
                              <Text style={styles.radioSymbol}>
                                {isChecked ? '●' : '○'}
                              </Text>
                              <Text style={styles.optionText}>{opt.text}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {/* Essay textarea */}
                    {qType === 'ESSAY' && (
                      <TextInput
                        style={styles.essayInput}
                        placeholder="Nhập nội dung bài làm tự luận của bạn..."
                        placeholderTextColor="#9ca3af"
                        multiline
                        value={answers[q.id]?.text_response || ''}
                        onChangeText={txt =>
                          setAnswers(a => ({
                            ...a,
                            [q.id]: { ...a[q.id], text_response: txt },
                          }))
                        }
                      />
                    )}

                    {/* File upload input */}
                    {qType === 'FILE_UPLOAD' && (
                      <TextInput
                        style={styles.fileInput}
                        placeholder="Nhập tên tài liệu hoặc liên kết nộp bài..."
                        placeholderTextColor="#9ca3af"
                        value={answers[q.id]?.file_name || ''}
                        onChangeText={fn =>
                          setAnswers(a => ({
                            ...a,
                            [q.id]: { ...a[q.id], file_name: fn },
                          }))
                        }
                      />
                    )}
                  </View>
                );
              })}

              <TouchableOpacity
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                onPress={submitQuiz}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Nộp bài kiểm tra</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            /* Quiz Start or Result View */
            <View style={styles.quizStartSection}>
              {attempt?.status === 'SUBMITTED' && (
                <View
                  style={[
                    styles.resultCard,
                    attempt.passed ? styles.resultCardPass : styles.resultCardFail,
                  ]}
                >
                  <Text
                    style={[
                      styles.resultStatus,
                      attempt.passed ? styles.textSuccess : styles.textDanger,
                    ]}
                  >
                    {attempt.passed ? '✓ Bạn đã vượt qua bài kiểm tra!' : '✕ Chưa đạt yêu cầu'}
                  </Text>
                  <Text style={styles.resultDetails}>
                    Điểm số: {attempt.score?.toFixed(1)} / 100 điểm ({attempt.correct_count}/
                    {attempt.question_count} câu đúng)
                  </Text>
                  {(attempt as any).instructor_feedback ? (
                    <View style={styles.feedbackNote}>
                      <Text style={styles.feedbackNoteTitle}>Nhận xét của giảng viên:</Text>
                      <Text style={styles.feedbackNoteContent}>
                        {(attempt as any).instructor_feedback}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* Start Quiz Button */}
              {(!attempt || attempt.status === 'SUBMITTED') &&
                (!attempt || attempt.attempt_number < quiz.max_attempts) && (
                  <TouchableOpacity
                    style={[styles.primaryButton, busy && styles.buttonDisabled]}
                    onPress={beginAttempt}
                    disabled={busy}
                  >
                    <Text style={styles.primaryButtonText}>
                      {attempt ? 'Làm lại bài kiểm tra' : 'Bắt đầu làm bài'}
                    </Text>
                  </TouchableOpacity>
                )}

              {/* Toggle Previous Attempts History */}
              {myAttempts.length > 0 && (
                <TouchableOpacity
                  style={styles.historyToggleBtn}
                  onPress={() => setShowHistory(h => !h)}
                >
                  <Text style={styles.historyToggleBtnText}>
                    {showHistory ? 'Ẩn lịch sử làm bài ▲' : 'Xem lịch sử các lần làm bài ▼'}
                  </Text>
                </TouchableOpacity>
              )}

              {showHistory && (
                <View style={styles.historyList}>
                  {myAttempts.map(att => (
                    <View key={att.id} style={styles.historyItem}>
                      <Text style={styles.historyItemHeader}>
                        Lượt {att.attempt_number} ·{' '}
                        {att.submitted_at
                          ? new Date(att.submitted_at).toLocaleString('vi-VN')
                          : 'Đang làm'}
                      </Text>
                      <Text
                        style={[
                          styles.historyItemScore,
                          att.passed ? styles.textSuccess : styles.textDanger,
                        ]}
                      >
                        {att.score?.toFixed(1)} điểm ({att.passed ? 'Đạt' : 'Chưa đạt'})
                      </Text>
                      {att.instructor_feedback ? (
                        <Text style={styles.historyItemFeedback}>
                          Nhận xét: {att.instructor_feedback}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* MODAL: Instructor Grading Attempt */}
      <Modal
        visible={Boolean(gradingModal)}
        transparent
        animationType="slide"
        onRequestClose={() => setGradingModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  Chấm bài: {gradingModal?.user_name || 'Học viên'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {gradingModal?.user_email} · Lượt {gradingModal?.attempt_number}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setGradingModal(null)}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.gradingForm}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Điểm số (0 - 100):</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={gradingScore}
                  onChangeText={setGradingScore}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.label}>Kết quả đạt bài kiểm tra:</Text>
                <Switch
                  value={gradingPassed}
                  onValueChange={setGradingPassed}
                  trackColor={{ true: '#21634f', false: '#cbd5e1' }}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Nhận xét và góp ý cho học viên:</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  placeholder="Ghi nhận xét bài làm..."
                  placeholderTextColor="#9ca3af"
                  value={gradingFeedback}
                  onChangeText={setGradingFeedback}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, gradingBusy && styles.buttonDisabled]}
                onPress={handleSaveGrade}
                disabled={gradingBusy}
              >
                {gradingBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Lưu kết quả chấm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ==========================================
// 3. NATIVE REVIEWS & COMPLAINTS
// ==========================================
export function NativeReviewsAndComplaints({
  courseId,
  isEnrolled,
}: {
  courseId: string;
  isEnrolled: boolean;
}) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');
  const [busyReview, setBusyReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');

  // Complaints
  const [complaintReason, setComplaintReason] = useState('Nội dung vi phạm / sai lệch');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [busyComplaint, setBusyComplaint] = useState(false);
  const [complaintMessage, setComplaintMessage] = useState('');

  const loadFeedback = useCallback(async () => {
    if (!session) return;
    try {
      const { data } = await session.api.GET('/api/v1/courses/{id}/feedback' as any, {
        params: { path: { id: courseId } },
      });
      if (data && (data as any).reviews) {
        setReviews((data as any).reviews);
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [courseId]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const handleSubmitReview = async () => {
    if (!session) return;
    setBusyReview(true);
    setReviewMessage('');
    try {
      const { error } = await session.api.POST('/api/v1/courses/{id}/feedback' as any, {
        params: { path: { id: courseId } },
        body: { rating, comment: comment.trim() },
      });
      if (error) throw new Error(error.message);
      setComment('');
      setReviewMessage('Đã gửi đánh giá khóa học thành công!');
      void loadFeedback();
    } catch (e) {
      setReviewMessage(e instanceof Error ? e.message : 'Chưa gửi được đánh giá.');
    } finally {
      setBusyReview(false);
    }
  };

  const handleSubmitComplaint = async () => {
    if (!session || !complaintDescription.trim()) {
      setComplaintMessage('Vui lòng mô tả chi tiết lý do khiếu nại.');
      return;
    }
    setBusyComplaint(true);
    setComplaintMessage('');
    try {
      const { error } = await session.api.POST('/api/v1/courses/{id}/complaints' as any, {
        params: { path: { id: courseId } },
        body: {
          reason: complaintReason,
          description: complaintDescription.trim(),
        },
      });
      if (error) throw new Error(error.message);
      setComplaintDescription('');
      setComplaintMessage('Khiếu nại của bạn đã được gửi tới Ban quản trị để xử lý.');
    } catch (e) {
      setComplaintMessage(e instanceof Error ? e.message : 'Lỗi khi gửi khiếu nại.');
    } finally {
      setBusyComplaint(false);
    }
  };

  return (
    <View style={styles.reviewsContainer}>
      {/* REVIEWS SECTION */}
      <View style={styles.reviewSectionCard}>
        <Text style={styles.sectionHeader}>Đánh giá khóa học</Text>

        {isEnrolled && (
          <View style={styles.writeReviewBox}>
            <Text style={styles.label}>Đánh giá của bạn:</Text>
            {/* 5 Stars picker */}
            <View style={styles.starPickerRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  style={styles.starPickerBtn}
                >
                  <Text style={[styles.starPickerText, star <= rating && styles.starFilled]}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.commentInput}
              placeholder="Chia sẻ cảm nhận của bạn về khóa học này..."
              placeholderTextColor="#9ca3af"
              multiline
              value={comment}
              onChangeText={setComment}
            />

            {reviewMessage ? (
              <Text style={styles.feedbackSuccessText}>{reviewMessage}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, busyReview && styles.buttonDisabled]}
              onPress={handleSubmitReview}
              disabled={busyReview}
            >
              <Text style={styles.primaryButtonText}>Gửi đánh giá</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Existing reviews list */}
        <View style={styles.reviewsList}>
          {reviews.length === 0 ? (
            <Text style={styles.emptyNotice}>Chưa có đánh giá nào cho khóa học này.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewItem}>
                <View style={styles.reviewItemTop}>
                  <Text style={styles.reviewAuthor}>{r.user_name || 'Học viên'}</Text>
                  <Text style={styles.reviewStars}>
                    {'★'.repeat(r.rating || 5)}{'☆'.repeat(5 - (r.rating || 5))}
                  </Text>
                </View>
                {r.comment ? <Text style={styles.reviewBody}>{r.comment}</Text> : null}
                <Text style={styles.reviewDate}>
                  {new Date(r.created_at || r.updated_at).toLocaleDateString('vi-VN')}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* COMPLAINT SECTION (ENROLLED STUDENTS ONLY) */}
      {isEnrolled && (
        <View style={styles.complaintSectionCard}>
          <Text style={styles.sectionHeaderDanger}>Khiếu nại khóa học</Text>
          <Text style={styles.complaintNotice}>
            Nếu phát hiện nội dung vi phạm chính sách hoặc chất lượng không đúng cam kết,
            bạn có thể gửi khiếu nại trực tiếp đến Quản trị viên hệ thống.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Lý do khiếu nại:</Text>
            <View style={styles.reasonsList}>
              {[
                'Nội dung vi phạm / sai lệch',
                'Lỗi video / âm thanh hỏng',
                'Giảng viên không phản hồi',
                'Khác',
              ].map(reason => (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.reasonPill,
                    complaintReason === reason && styles.reasonPillActive,
                  ]}
                  onPress={() => setComplaintReason(reason)}
                >
                  <Text
                    style={[
                      styles.reasonPillText,
                      complaintReason === reason && styles.reasonPillTextActive,
                    ]}
                  >
                    {reason}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Chi tiết khiếu nại:</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              placeholder="Mô tả cụ thể sự việc cần phản ánh..."
              placeholderTextColor="#9ca3af"
              value={complaintDescription}
              onChangeText={setComplaintDescription}
            />
          </View>

          {complaintMessage ? (
            <Text style={styles.complaintAlertText}>{complaintMessage}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.dangerButton, busyComplaint && styles.buttonDisabled]}
            onPress={handleSubmitComplaint}
            disabled={busyComplaint}
          >
            {busyComplaint ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.dangerButtonText}>Gửi khiếu nại lên Admin</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ==========================================
// STYLES
// ==========================================
export const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    backgroundColor: '#f8fafc',
  },
  lessonCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    padding: 16,
    gap: 14,
  },
  videoWrapper: {
    width: '100%',
    height: 220,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  lessonAlert: {
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 8,
  },
  lessonAlertText: {
    color: '#991b1b',
    fontSize: 12,
  },
  statusHint: {
    fontSize: 12,
    color: '#64748b',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#21634f',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#21634f',
    fontWeight: '700',
  },
  tabPanel: {
    gap: 12,
    paddingTop: 8,
  },
  summarySection: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  summaryAnswer: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 22,
  },
  citationsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  citationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  citationTime: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '700',
  },
  citationExcerpt: {
    color: '#047857',
    fontSize: 11,
    maxWidth: 160,
  },
  transcriptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  timestampBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  timestampBadgeText: {
    color: '#21634f',
    fontSize: 11,
    fontWeight: '700',
  },
  transcriptText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  chatHint: {
    fontSize: 12,
    color: '#64748b',
  },
  chatHistory: {
    gap: 12,
  },
  chatMessagePair: {
    gap: 6,
  },
  chatQuestionBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#21634f',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderBottomRightRadius: 2,
    maxWidth: '85%',
  },
  chatQuestionText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 18,
  },
  chatAnswerBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderBottomLeftRadius: 2,
    maxWidth: '85%',
    gap: 6,
  },
  chatAnswerText: {
    color: '#1e293b',
    fontSize: 13,
    lineHeight: 19,
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    maxHeight: 80,
  },
  chatSendBtn: {
    backgroundColor: '#21634f',
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyTabBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyTabText: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
  quizCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 14,
  },
  quizHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  quizTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  quizMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  timerBadge: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timerText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '800',
  },
  instructorGradingSection: {
    gap: 10,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  submissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 10,
  },
  submissionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  submissionMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  submissionGrade: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  gradeButton: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  gradeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#21634f',
  },
  studentQuizSection: {
    gap: 12,
  },
  attemptInfo: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  questionsContainer: {
    gap: 14,
  },
  questionCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  questionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  questionNumberText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  qTypeBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  qTypeBadgeText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '700',
  },
  optionsList: {
    gap: 6,
    marginTop: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  optionRowChecked: {
    borderColor: '#21634f',
    backgroundColor: '#ecfdf5',
  },
  radioSymbol: {
    fontSize: 16,
    color: '#21634f',
  },
  optionText: {
    fontSize: 13,
    color: '#1e293b',
  },
  essayInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    padding: 10,
    fontSize: 13,
    color: '#0f172a',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fileInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    padding: 10,
    fontSize: 13,
    color: '#0f172a',
  },
  quizStartSection: {
    gap: 12,
  },
  resultCard: {
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  resultCardPass: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
  },
  resultCardFail: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
  },
  resultStatus: {
    fontSize: 15,
    fontWeight: '800',
  },
  resultDetails: {
    fontSize: 13,
    color: '#334155',
  },
  feedbackNote: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  feedbackNoteTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  feedbackNoteContent: {
    fontSize: 12,
    color: '#475569',
  },
  historyToggleBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  historyToggleBtnText: {
    fontSize: 12,
    color: '#21634f',
    fontWeight: '600',
  },
  historyList: {
    gap: 8,
    marginTop: 4,
  },
  historyItem: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    gap: 2,
  },
  historyItemHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  historyItemScore: {
    fontSize: 12,
    fontWeight: '600',
  },
  historyItemFeedback: {
    fontSize: 11,
    color: '#64748b',
  },
  reviewsContainer: {
    gap: 16,
  },
  reviewSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 14,
  },
  sectionHeader: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionHeaderDanger: {
    fontSize: 17,
    fontWeight: '700',
    color: '#b91c1c',
  },
  writeReviewBox: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderRadius: 10,
    gap: 10,
  },
  starPickerRow: {
    flexDirection: 'row',
    gap: 6,
  },
  starPickerBtn: {
    padding: 4,
  },
  starPickerText: {
    fontSize: 26,
    color: '#cbd5e1',
  },
  starFilled: {
    color: '#eab308',
  },
  commentInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#0f172a',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  feedbackSuccessText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewsList: {
    gap: 10,
  },
  reviewItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 4,
  },
  reviewItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewAuthor: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  reviewStars: {
    color: '#eab308',
    fontSize: 13,
  },
  reviewBody: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  reviewDate: {
    fontSize: 11,
    color: '#94a3b8',
  },
  complaintSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 14,
  },
  complaintNotice: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  reasonsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  reasonPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reasonPillActive: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  reasonPillText: {
    fontSize: 12,
    color: '#475569',
  },
  reasonPillTextActive: {
    color: '#b91c1c',
    fontWeight: '700',
  },
  complaintAlertText: {
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseBtnText: {
    fontSize: 18,
    color: '#64748b',
    fontWeight: '700',
  },
  gradingForm: {
    gap: 12,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  primaryButton: {
    backgroundColor: '#21634f',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  dangerButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  emptyNotice: {
    fontSize: 13,
    color: '#94a3b8',
    paddingVertical: 10,
  },
  textSuccess: {
    color: '#059669',
  },
  textDanger: {
    color: '#dc2626',
  },
});
