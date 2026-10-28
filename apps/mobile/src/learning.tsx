import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutAnimation,
  Modal,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as DocumentPicker from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import { components, ProgressTracker } from '@lms/api-client';
import { session } from './session';
import { useTheme } from './theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const animateTransition = () => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
};

type Playback = components['schemas']['PlaybackDto'];
type Transcript = components['schemas']['TranscriptDto'];
type Summary = components['schemas']['SummaryDto'];
type Chat = components['schemas']['ChatDto'];
type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Attempt = components['schemas']['AttemptDto'] & {
  user_name?: string;
  user_email?: string;
  submitted_at?: string | null;
  instructor_feedback?: string | null;
};
type FeedbackItem = components['schemas']['FeedbackItemDto'];

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
  const { colors } = useTheme();
  const player = useVideoPlayer(playback.url);
  const [tab, setTab] = useState<'summary' | 'transcript' | 'chat'>('summary');
  const [collapsedTabs, setCollapsedTabs] = useState(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Chat[]>([]);
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [progressStatus, setProgressStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const tracker = useRef<ProgressTracker | null>(null);
  const recovered = useRef(false);

  useEffect(() => {
    if (!session) return;
    const tracking = new ProgressTracker(session, playback.lesson_id, randomUUID, setProgressStatus);
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
            style={[styles.citationPill, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
            onPress={() => {
              if (c.media_version === playback.media_version) {
                seek(c.start_sec);
              } else {
                setMessage('Nguồn thuộc bản video cũ.');
              }
            }}
          >
            <Text style={[styles.citationTime, { color: colors.primary }]}>▷ {formatTime(c.start_sec)}</Text>
            <Text numberOfLines={2} style={[styles.citationExcerpt, { color: colors.text }]}>
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
    <View style={[styles.lessonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Video Player */}
      <View style={styles.videoWrapper}>
        <VideoView player={player} nativeControls style={styles.videoPlayer} />
      </View>

      {message ? (
        <View style={[styles.lessonAlert, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)', borderWidth: 1 }]}>
          <Text style={[styles.lessonAlertText, { color: colors.danger }]}>{message}</Text>
        </View>
      ) : null}

      <View style={[styles.progressStatusBadge, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
        <View style={[styles.progressStatusDot, { backgroundColor: colors.primary }]} />
        <Text style={[styles.statusHint, { color: colors.textSecondary }]}>
          {progressStatus || 'Tiến độ xem video được ghi nhận tự động.'}
        </Text>
      </View>

      {/* Tabs navigation */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', flex: 1 }}>
          <TouchableOpacity
            style={[styles.tabItem, tab === 'summary' && { borderBottomColor: colors.primary }]}
            onPress={() => {
              animateTransition();
              setTab('summary');
              setCollapsedTabs(false);
            }}
          >
            <Text style={[styles.tabText, { color: tab === 'summary' ? colors.primary : colors.textMuted }, tab === 'summary' && { fontWeight: '700' }]}>
              Tóm tắt bài
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, tab === 'transcript' && { borderBottomColor: colors.primary }]}
            onPress={() => {
              animateTransition();
              setTab('transcript');
              setCollapsedTabs(false);
            }}
          >
            <Text style={[styles.tabText, { color: tab === 'transcript' ? colors.primary : colors.textMuted }, tab === 'transcript' && { fontWeight: '700' }]}>
              Transcript
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, tab === 'chat' && { borderBottomColor: colors.primary }]}
            onPress={() => {
              animateTransition();
              setTab('chat');
              setCollapsedTabs(false);
            }}
          >
            <Text style={[styles.tabText, { color: tab === 'chat' ? colors.primary : colors.textMuted }, tab === 'chat' && { fontWeight: '700' }]}>
              Hỏi đáp AI
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{
            paddingVertical: 4,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: colors.cardElevated,
            marginRight: 8,
          }}
          onPress={() => {
            animateTransition();
            setCollapsedTabs(prev => !prev);
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>
            {collapsedTabs ? 'Mở rộng ▼' : 'Thu gọn ▲'}
          </Text>
        </TouchableOpacity>
      </View>

      {!collapsedTabs && (
        <>

      {/* TAB CONTENT: Summary */}
      {tab === 'summary' && (
        <View style={styles.tabPanel}>
          {summary?.status === 'READY' ? (
            summary.sections.map((sec, idx) => (
              <View key={idx} style={[styles.summarySection, { backgroundColor: colors.cardElevated }]}>
                <Text style={[styles.summaryAnswer, { color: colors.text }]}>{sec.answer}</Text>
                {renderCitations(sec.citations)}
              </View>
            ))
          ) : (
            <View style={styles.emptyTabBox}>
              <Text style={[styles.emptyTabText, { color: colors.textMuted }]}>
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
                style={[styles.transcriptRow, { borderBottomColor: colors.border }]}
                onPress={() => seek(seg.start_sec)}
              >
                <View style={[styles.timestampBadge, { backgroundColor: colors.cardElevated }]}>
                  <Text style={[styles.timestampBadgeText, { color: colors.primary }]}>▷ {formatTime(seg.start_sec)}</Text>
                </View>
                <Text style={[styles.transcriptText, { color: colors.text }]}>{seg.text}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyTabBox}>
              <Text style={[styles.emptyTabText, { color: colors.textMuted }]}>
                Transcript đang được AI trích xuất và đồng bộ timestamp...
              </Text>
            </View>
          )}
        </View>
      )}

      {/* TAB CONTENT: AI Chat */}
      {tab === 'chat' && (
        <View style={styles.tabPanel}>
          <Text style={[styles.chatHint, { color: colors.textMuted }]}>
            Hỏi bất kỳ điều gì về bài học này. Nhấn nguồn trích dẫn để tua video xem lại.
          </Text>

          {/* Chat history */}
          <View style={styles.chatHistory}>
            {history.map(msg => (
              <View key={msg.id} style={styles.chatMessagePair}>
                {/* User Question */}
                <View style={[styles.chatQuestionBubble, { backgroundColor: colors.primary }]}>
                  <Text style={styles.chatQuestionText}>{msg.question}</Text>
                </View>

                {/* AI Answer */}
                <View style={[styles.chatAnswerBubble, { backgroundColor: colors.cardElevated }]}>
                  <Text style={[styles.chatAnswerText, { color: colors.text }]}>{msg.answer}</Text>
                  {renderCitations(msg.citations)}
                </View>
              </View>
            ))}
          </View>

          {/* Chat Input */}
          <View style={styles.chatInputRow}>
            <TextInput
              style={[styles.chatInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Bạn muốn hiểu rõ phần nào?"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={1500}
              value={question}
              onChangeText={setQuestion}
            />
            <TouchableOpacity
              style={[styles.chatSendBtn, { backgroundColor: colors.primary }, (!question.trim() || busy) && styles.buttonDisabled]}
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
        </>
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
  const { colors, isDark } = useTheme();
  const glassBackdrop = isDark ? 'rgba(2, 6, 23, 0.72)' : 'rgba(15, 23, 42, 0.45)';
  const glassCardBg = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.96)';
  const glassCardBorder = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(226, 232, 240, 0.9)';
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, MobileAnswer>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Student attempts history
  const [myAttempts, setMyAttempts] = useState<Attempt[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Instructor grading mode
  const [submissions, setSubmissions] = useState<Attempt[]>([]);
  const [gradingModal, setGradingModal] = useState<Attempt | null>(null);
  const [gradingScore, setGradingScore] = useState<string>('70');
  const [gradingPassed, setGradingPassed] = useState<boolean>(true);
  const [gradingFeedback, setGradingFeedback] = useState<string>('');
  const [gradingBusy, setGradingBusy] = useState(false);

  const pickDocument = async (questionId: string) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setAnswers(a => ({
          ...a,
          [questionId]: {
            ...a[questionId],
            file_name: asset.name,
          },
        }));
      }
    } catch {
      // Bỏ qua lỗi chọn tệp
    }
  };

  const loadMyAttempts = useCallback(async () => {
    if (isOwner || !session) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/my-attempts', {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        const list = data as unknown as Attempt[];
        setMyAttempts(list);
        if (list.length > 0) {
          setAttempt(prev => (prev?.status === 'IN_PROGRESS' ? prev : list[0]));
        }
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, [quiz.id, isOwner]);

  const loadSubmissions = useCallback(async () => {
    if (!isOwner || !session) return;
    try {
      const { data } = await session.api.GET('/api/v1/quizzes/{id}/submissions', {
        params: { path: { id: quiz.id } },
      });
      if (data && Array.isArray(data)) {
        setSubmissions(data as unknown as Attempt[]);
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
      const { error } = await session.api.POST('/api/v1/attempts/{id}/grade', {
        params: { path: { id: gradingModal.id } },
        body: {
          score: scoreNum,
          passed: gradingPassed,
          instructor_feedback: gradingFeedback.trim(),
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
    <View style={[styles.quizCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Quiz Header */}
      <View style={styles.quizHeader}>
        <View style={{ flex: 1 }}>
          {quiz.module_id ? (
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
              Bài kiểm tra chương
            </Text>
          ) : null}
          <Text style={[styles.quizTitle, { color: colors.text }]}>{quiz.title}</Text>
          <Text style={[styles.quizMeta, { color: colors.textMuted }]}>
            {quiz.questions.length} câu hỏi · Ngưỡng đạt {quiz.pass_threshold}% · Tối đa{' '}
            {quiz.max_attempts} lượt
            {quiz.time_limit_minutes ? ` · Thời gian: ${quiz.time_limit_minutes} phút` : ''}
          </Text>
        </View>

        {/* Timed countdown timer badge */}
        {timeLeft !== null && (
          <View
            style={[
              styles.timerBadge,
              {
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fef2f2',
                borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5',
              },
            ]}
          >
            <Text style={[styles.timerText, { color: isDark ? '#f87171' : '#b91c1c' }]}>
              Còn: {formatTime(timeLeft)}
            </Text>
          </View>
        )}
      </View>

      {message ? (
        <View
          style={[
            styles.lessonAlert,
            {
              backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : '#fef2f2',
              borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : '#fca5a5',
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.lessonAlertText, { color: isDark ? '#fca5a5' : '#991b1b' }]}>{message}</Text>
        </View>
      ) : null}

      {/* INSTRUCTOR MODE: Submissions & Grading */}
      {isOwner ? (
        <View style={styles.instructorGradingSection}>
          <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
            Quản trị & Chấm bài học viên ({submissions.length} bài nộp)
          </Text>

          {submissions.length === 0 ? (
            <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa có học viên nào nộp bài kiểm tra này.</Text>
          ) : (
            submissions.map(sub => (
              <View key={sub.id} style={[styles.submissionRow, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.submissionName, { color: colors.text }]}>
                    {sub.user_name || 'Học viên'}
                  </Text>
                  <Text style={[styles.submissionMeta, { color: colors.textMuted }]}>
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
                    Điểm: {sub.score != null ? Number(sub.score).toFixed(1) : '--'} ({sub.passed ? 'Đạt' : 'Chưa đạt'})
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.gradeButton, { backgroundColor: colors.cardElevated }]}
                  onPress={() => {
                    setGradingModal(sub);
                    setGradingScore(String(sub.score ?? 70));
                    setGradingPassed(Boolean(sub.passed));
                    setGradingFeedback(sub.instructor_feedback || '');
                  }}
                >
                  <Text style={[styles.gradeButtonText, { color: colors.primary }]}>Chấm bài</Text>
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
              <Text style={[styles.attemptInfo, { color: colors.textSecondary }]}>
                Lượt làm thứ {attempt.attempt_number}. Vui lòng trả lời các câu hỏi bên dưới:
              </Text>

              {quiz.questions.map((q, idx) => {
                const qType = q.question_type || 'MULTIPLE_CHOICE';
                return (
                  <View key={q.id} style={[styles.questionCard, { backgroundColor: colors.cardElevated }]}>
                    <View style={styles.questionCardHeader}>
                      <Text style={[styles.questionNumberText, { color: colors.text }]}>
                        Câu {idx + 1}: {q.text}
                      </Text>
                      <View style={[styles.qTypeBadge, { backgroundColor: colors.border }]}>
                        <Text style={[styles.qTypeBadgeText, { color: colors.textSecondary }]}>
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
                                { backgroundColor: colors.card, borderColor: colors.border },
                                isChecked && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                              ]}
                              onPress={() =>
                                setAnswers(a => ({
                                  ...a,
                                  [q.id]: { ...a[q.id], option_id: opt.id },
                                }))
                              }
                            >
                              <Text style={[styles.radioSymbol, { color: colors.primary }]}>
                                {isChecked ? '●' : '○'}
                              </Text>
                              <Text style={[styles.optionText, { color: colors.text, flex: 1 }]}>{opt.text}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {/* Essay textarea */}
                    {qType === 'ESSAY' && (
                      <TextInput
                        style={[styles.essayInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                        placeholder="Nhập nội dung bài làm tự luận của bạn..."
                        placeholderTextColor={colors.textMuted}
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
                      <View style={{ marginTop: 8 }}>
                        {answers[q.id]?.file_name ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: colors.cardElevated,
                              borderColor: colors.border,
                              borderWidth: 1,
                              borderRadius: 8,
                              padding: 12,
                            }}
                          >
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                                {answers[q.id]?.file_name}
                              </Text>
                              <Text style={{ fontSize: 11, color: colors.primary, marginTop: 2 }}>
                                Đã sẵn sàng nộp kèm bài thi
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TouchableOpacity
                                style={{
                                  backgroundColor: colors.primaryLight,
                                  paddingVertical: 6,
                                  paddingHorizontal: 10,
                                  borderRadius: 6,
                                }}
                                onPress={() => void pickDocument(q.id)}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>Đổi tệp</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={{
                                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                  paddingVertical: 6,
                                  paddingHorizontal: 10,
                                  borderRadius: 6,
                                }}
                                onPress={() =>
                                  setAnswers(a => ({
                                    ...a,
                                    [q.id]: { ...a[q.id], file_name: undefined },
                                  }))
                                }
                              >
                                <Text style={{ fontSize: 12, fontWeight: '600', color: '#ef4444' }}>Xóa</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={{
                              borderWidth: 1.5,
                              borderStyle: 'dashed',
                              borderColor: colors.primary,
                              backgroundColor: colors.primaryLight,
                              borderRadius: 10,
                              padding: 16,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            onPress={() => void pickDocument(q.id)}
                          >
                            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>
                              Tải lên tệp tài liệu nộp bài
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                              Chọn tệp từ điện thoại (PDF, Word, Ảnh, Zip...)
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }, busy && styles.buttonDisabled]}
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
                    attempt.passed
                      ? { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 }
                      : {
                          backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2',
                          borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5',
                          borderWidth: 1,
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.resultStatus,
                      attempt.passed ? { color: colors.primary } : { color: isDark ? '#f87171' : '#dc2626' },
                    ]}
                  >
                    {attempt.passed ? '✓ Bạn đã vượt qua bài kiểm tra!' : '✕ Chưa đạt yêu cầu'}
                  </Text>
                  <Text style={[styles.resultDetails, { color: colors.text }]}>
                    Điểm số: {attempt.score != null ? Number(attempt.score).toFixed(1) : '--'} / 100 điểm ({attempt.correct_count}/
                    {attempt.question_count} câu đúng)
                  </Text>
                  {attempt.instructor_feedback ? (
                    <View style={[styles.feedbackNote, { borderTopColor: colors.border }]}>
                      <Text style={[styles.feedbackNoteTitle, { color: colors.text }]}>Nhận xét của giảng viên:</Text>
                      <Text style={[styles.feedbackNoteContent, { color: colors.textSecondary }]}>
                        {attempt.instructor_feedback}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* Start Quiz Button */}
              {(!attempt || attempt.status === 'SUBMITTED') &&
                (!attempt || attempt.attempt_number < quiz.max_attempts) && (
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: colors.primary }, busy && styles.buttonDisabled]}
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
                  onPress={() => {
                    animateTransition();
                    setShowHistory(h => !h);
                  }}
                >
                  <Text style={[styles.historyToggleBtnText, { color: colors.primary }]}>
                    {showHistory ? 'Ẩn lịch sử làm bài ▲' : 'Xem lịch sử các lần làm bài ▼'}
                  </Text>
                </TouchableOpacity>
              )}

              {showHistory && (
                <View style={styles.historyList}>
                  {myAttempts.map(att => (
                    <View key={att.id} style={[styles.historyItem, { backgroundColor: colors.cardElevated }]}>
                      <Text style={[styles.historyItemHeader, { color: colors.text }]}>
                        Lượt {att.attempt_number} ·{' '}
                        {att.submitted_at
                          ? new Date(att.submitted_at).toLocaleString('vi-VN')
                          : 'Đang làm'}
                      </Text>
                      <Text
                        style={[
                          styles.historyItemScore,
                          att.passed ? { color: colors.primary } : styles.textDanger,
                        ]}
                      >
                        {att.score != null ? Number(att.score).toFixed(1) : '--'} điểm ({att.passed ? 'Đạt' : 'Chưa đạt'})
                      </Text>
                      {att.instructor_feedback ? (
                        <Text style={[styles.historyItemFeedback, { color: colors.textMuted }]}>
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
        animationType="fade"
        onRequestClose={() => setGradingModal(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalContent, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Chấm bài: {gradingModal?.user_name || 'Học viên'}
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                  {gradingModal?.user_email} · Lượt {gradingModal?.attempt_number}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setGradingModal(null)}
              >
                <Text style={[styles.modalCloseBtnText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.gradingForm}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Điểm số (0 - 100):</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  keyboardType="numeric"
                  value={gradingScore}
                  onChangeText={setGradingScore}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.label, { color: colors.text }]}>Kết quả đạt bài kiểm tra:</Text>
                <Switch
                  value={gradingPassed}
                  onValueChange={setGradingPassed}
                  trackColor={{ true: '#10b981', false: '#cbd5e1' }}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Nhận xét và góp ý cho học viên:</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  multiline
                  placeholder="Ghi nhận xét bài làm..."
                  placeholderTextColor={colors.textMuted}
                  value={gradingFeedback}
                  onChangeText={setGradingFeedback}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }, gradingBusy && styles.buttonDisabled]}
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
  isOwner,
}: {
  courseId: string;
  isEnrolled: boolean;
  isOwner?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const [reviews, setReviews] = useState<FeedbackItem[]>([]);
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
      const { data } = await session.api.GET('/api/v1/courses/{id}/feedback', {
        params: { path: { id: courseId } },
      });
      if (data && data.reviews) {
        setReviews(data.reviews);
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
      const { error } = await session.api.POST('/api/v1/courses/{id}/feedback', {
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
      const { error } = await session.api.POST('/api/v1/courses/{id}/complaints', {
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
      <View style={[styles.reviewSectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionHeader, { color: colors.text }]}>Đánh giá khóa học</Text>

        {isOwner ? (
          <View style={{ backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>
              Giảng viên không thể tự đánh giá khóa học của chính mình.
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 }}>
              Bạn có thể đọc các nhận xét và đánh giá từ học viên bên dưới để cải thiện chất lượng khóa học.
            </Text>
          </View>
        ) : isEnrolled ? (
          <View style={[styles.writeReviewBox, { backgroundColor: colors.cardElevated }]}>
            <Text style={[styles.label, { color: colors.text }]}>Đánh giá của bạn:</Text>
            {/* 5 Stars picker with gold stars */}
            <View style={styles.starPickerRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  style={styles.starPickerBtn}
                  accessibilityLabel={`${star} sao`}
                >
                  <Text
                    style={[
                      styles.starPickerText,
                      { color: star <= rating ? '#f59e0b' : (isDark ? '#334155' : '#cbd5e1'), fontSize: 32 },
                    ]}
                  >
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.commentInput, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Chia sẻ cảm nhận của bạn về khóa học này..."
              placeholderTextColor={colors.textMuted}
              multiline
              value={comment}
              onChangeText={setComment}
            />

            {reviewMessage ? (
              <Text style={styles.feedbackSuccessText}>{reviewMessage}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }, busyReview && styles.buttonDisabled]}
              onPress={handleSubmitReview}
              disabled={busyReview}
            >
              <Text style={styles.primaryButtonText}>Gửi đánh giá</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Existing reviews list */}
        <View style={styles.reviewsList}>
          {reviews.length === 0 ? (
            <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa có đánh giá nào cho khóa học này.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={[styles.reviewItem, { borderBottomColor: colors.border }]}>
                <View style={styles.reviewItemTop}>
                  <Text style={[styles.reviewAuthor, { color: colors.text }]}>{r.user_name || 'Học viên'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: '#f59e0b', fontSize: 13, letterSpacing: 1 }}>
                      {'★'.repeat(Math.max(1, Math.min(5, r.rating || 5)))}
                      <Text style={{ color: isDark ? '#334155' : '#cbd5e1' }}>
                        {'★'.repeat(5 - Math.min(5, Math.max(1, r.rating || 5)))}
                      </Text>
                    </Text>
                  </View>
                </View>
                {r.comment ? <Text style={[styles.reviewBody, { color: colors.textSecondary }]}>{r.comment}</Text> : null}
                <Text style={[styles.reviewDate, { color: colors.textMuted }]}>
                  {new Date(r.created_at).toLocaleDateString('vi-VN')}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* COMPLAINT SECTION (ENROLLED STUDENTS ONLY, NOT INSTRUCTOR) */}
      {isEnrolled && !isOwner && (
        <View style={[styles.complaintSectionCard, { backgroundColor: colors.card, borderColor: 'rgba(220, 38, 38, 0.35)' }]}>
          <Text style={[styles.sectionHeaderDanger, { color: isDark ? '#f87171' : '#b91c1c' }]}>Khiếu nại khóa học</Text>
          <Text style={[styles.complaintNotice, { color: colors.textMuted }]}>
            Nếu phát hiện nội dung vi phạm chính sách hoặc chất lượng không đúng cam kết,
            bạn có thể gửi khiếu nại trực tiếp đến Quản trị viên hệ thống.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Lý do khiếu nại:</Text>
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
                    { backgroundColor: colors.cardElevated, borderColor: colors.border },
                    complaintReason === reason && {
                      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#fee2e2',
                      borderColor: isDark ? 'rgba(239, 68, 68, 0.45)' : '#fca5a5',
                    },
                  ]}
                  onPress={() => setComplaintReason(reason)}
                >
                  <Text
                    style={[
                      styles.reasonPillText,
                      { color: colors.textSecondary },
                      complaintReason === reason && {
                        color: isDark ? '#fca5a5' : '#b91c1c',
                        fontWeight: '700',
                      },
                    ]}
                  >
                    {reason}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Chi tiết khiếu nại:</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              multiline
              placeholder="Mô tả cụ thể sự việc cần phản ánh..."
              placeholderTextColor={colors.textMuted}
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
    fontWeight: '600',
  },
  progressStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  progressStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusHint: {
    fontSize: 12,
    fontWeight: '600',
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
