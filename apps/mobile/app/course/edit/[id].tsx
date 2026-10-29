import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COURSE_TAGS, type CourseTag, type components } from '@lms/api-client';
import { pickCourseThumbnailImage } from '../../../src/image-picker';
import { getActiveRoleMode, getCurrentApiUrl, session } from '../../../src/session';
import { useTheme } from '../../../src/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const animateTransition = () => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
};

type Course = components['schemas']['CourseDto'] & {
  is_locked?: boolean;
  locked_reason?: string | null;
  access_mode?: string;
  allowed_emails?: string[];
  thumbnail_url?: string | null;
  tag?: string;
  scheduled_action?: string | null;
  scheduled_at?: string | null;
  scheduled_until?: string | null;
  scheduled_reason?: string | null;
};

type Module = components['schemas']['ModuleDto'];
type Lesson = components['schemas']['LessonDetailsDto'];
type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Analytics = components['schemas']['AnalyticsDto'];
type Playback = components['schemas']['PlaybackDto'];

interface QuizQuestionDraft {
  text: string;
  question_type: 'MULTIPLE_CHOICE' | 'ESSAY' | 'FILE_UPLOAD';
  options: { text: string; is_correct: boolean }[];
}

interface SubmissionItem {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  attempt_number: number;
  status: string;
  score?: number | null;
  passed?: boolean | null;
  submitted_at?: string | null;
  instructor_feedback?: string | null;
}

const stateNames: Record<string, string> = {
  UPLOADING: 'Chờ tải video',
  VALIDATING: 'Đang kiểm tra video',
  READY: 'Sẵn sàng',
  FAILED: 'Xử lý thất bại',
};

function VideoPreviewPlayer({ url }: { url: string }) {
  const player = useVideoPlayer(url);
  return (
    <View style={styles.previewWrapper}>
      <VideoView player={player} nativeControls style={styles.previewPlayer} />
    </View>
  );
}

// ==========================================
// LESSON ITEM IN EDITOR WITH VIDEO UPLOAD
// ==========================================
function LessonEditorCard({
  lesson,
  onRefresh,
  onDelete,
}: {
  lesson: Lesson;
  onRefresh: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [playback, setPlayback] = useState<Playback | null>(null);

  const handlePickAndUploadVideo = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/mp4',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      setBusy(true);
      setMessage('Đang đọc tệp video trên thiết bị...');
      setUploadProgress(0);

      // Đọc Blob trước để lấy chính xác kích thước byte thực tế của tệp trên Android/iOS
      const fileRes = await fetch(file.uri);
      const blob = await fileRes.blob();
      const fileSize = blob.size || file.size || 0;

      if (fileSize <= 0 || fileSize > 524288000) {
        setBusy(false);
        setUploadProgress(null);
        setMessage('Vui lòng chọn video MP4 dung lượng tối đa 500 MiB.');
        return;
      }

      setMessage('Đang xin URL tải lên máy chủ...');

      // 1. Get presigned upload URL
      const { data, error } = await session.api.POST('/api/v1/lessons/{id}/upload-url', {
        params: { path: { id: lesson.id } },
        body: { size_bytes: fileSize },
      });

      if (error || !data) {
        throw new Error(error?.message ?? 'Không lấy được URL tải lên.');
      }

      const uploadUrl = data.upload_url;
      const mediaId = data.media_id;

      setMessage('Đang tải video lên kho lưu trữ...');

      // 2. PUT blob to S3
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.timeout = 15 * 60 * 1000;
        xhr.setRequestHeader('Content-Type', 'video/mp4');

        xhr.upload.onprogress = event => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded * 100) / event.total));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Tải video lên kho thất bại (Mã: ${xhr.status}).`));
          }
        };

        xhr.onerror = () => reject(new Error('Kết nối tải video tới kho lưu trữ bị gián đoạn.'));
        xhr.ontimeout = () => reject(new Error('Hết thời gian chờ tải video.'));
        xhr.send(blob);
      });

      // 3. Complete upload
      setMessage('Đang hoàn tất và gửi cho bộ kiểm tra...');
      setUploadProgress(100);

      const completeRes = await session.api.POST('/api/v1/lessons/{id}/upload-complete', {
        params: { path: { id: lesson.id } },
        body: { media_id: mediaId },
      });

      if (completeRes.error) {
        throw new Error(completeRes.error.message);
      }

      setMessage('Đã nhận video thành công! Hệ thống đang kiểm tra để sẵn sàng phát.');
      await onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi tải video.');
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const handlePreview = async () => {
    if (playback) {
      setPlayback(null);
      return;
    }
    setBusy(true);
    try {
      const res = await session.api.GET('/api/v1/lessons/{id}/playback', {
        params: { path: { id: lesson.id } },
      });
      if (res.data) {
        setPlayback(res.data);
      } else {
        setMessage(res.error?.message ?? 'Chưa thể phát video.');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi phát video.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.lessonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.lessonCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lessonCardTitle, { color: colors.text }]}>{lesson.title}</Text>
          <Text style={[styles.lessonCardMeta, { color: colors.textMuted }]}>
            {lesson.required ? 'Bài học bắt buộc' : 'Bài học bổ trợ'} · Trạng thái:{' '}
            <Text style={{ fontWeight: '700', color: lesson.media_status === 'READY' ? '#10b981' : '#f59e0b' }}>
              {stateNames[lesson.media_status ?? ''] ?? 'Chưa có video'}
            </Text>
          </Text>
        </View>

        <TouchableOpacity style={styles.deleteLessonBtn} onPress={() => void onDelete()} disabled={busy}>
          <Text style={styles.deleteLessonBtnText}>Xóa bài</Text>
        </TouchableOpacity>
      </View>

      {/* Upload Zone */}
      <View style={[styles.uploadBox, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.uploadBtn, { backgroundColor: colors.primary }, busy && styles.buttonDisabled]}
          onPress={handlePickAndUploadVideo}
          disabled={busy}
        >
          <Text style={styles.uploadBtnText}>
            {busy ? 'Đang xử lý...' : lesson.active_media_id ? 'Chọn video MP4 thay thế' : 'Tải video bài giảng (MP4)'}
          </Text>
        </TouchableOpacity>

        {uploadProgress !== null && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBarTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.progressBarFill, { width: `${uploadProgress}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              {uploadProgress}% · {uploadProgress === 100 ? 'Đang hoàn tất...' : 'Đang tải lên'}
            </Text>
          </View>
        )}

        <Text style={[styles.uploadNotice, { color: colors.textMuted }]}>
          Định dạng: MP4 · H.264/AAC · Tối đa 500 MiB, 60 phút
        </Text>
      </View>

      {/* Actions: Preview Video */}
      {lesson.media_status === 'READY' && (
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={[styles.previewBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
            onPress={handlePreview}
            disabled={busy}
          >
            <Text style={[styles.previewBtnText, { color: colors.primary }]}>
              {playback ? 'Ẩn video xem trước' : '▶ Xem trước video bài giảng'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Video Player Preview if active */}
      {playback?.url ? <VideoPreviewPlayer url={playback.url} /> : null}

      {message ? (
        <View style={[styles.inlineAlert, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.inlineAlertText, { color: colors.primary }]}>{message}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ==========================================
// MAIN COURSE EDITOR SCREEN
// ==========================================
export default function CourseEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();

  const glassBackdrop = isDark ? 'rgba(2, 6, 23, 0.92)' : 'rgba(15, 23, 42, 0.86)';
  const glassCardBg = isDark ? '#0f172a' : '#ffffff';
  const glassCardBorder = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(203, 213, 225, 0.8)';

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const [activeTab, setActiveTab] = useState<'info' | 'curriculum' | 'quizzes' | 'analytics'>('curriculum');
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Course info form
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<CourseTag>('CNTT & Phần mềm');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'LINK' | 'RESTRICTED'>('PUBLIC');
  const [allowedEmailsText, setAllowedEmailsText] = useState('');

  // Module modal
  const [showAddModuleModal, setShowAddModuleModal] = useState(false);
  const [moduleTitle, setModuleTitle] = useState('');

  // Lesson modal
  const [showAddLessonModal, setShowAddLessonModal] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonRequired, setLessonRequired] = useState(true);

  // Quiz Builder Modal
  const [showQuizBuilderModal, setShowQuizBuilderModal] = useState(false);
  const [selectedQuizModuleId, setSelectedQuizModuleId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizPassThreshold, setQuizPassThreshold] = useState('70');
  const [quizMaxAttempts, setQuizMaxAttempts] = useState('3');
  const [quizTimeLimit, setQuizTimeLimit] = useState('0');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>([
    {
      text: 'Câu hỏi trắc nghiệm số 1',
      question_type: 'MULTIPLE_CHOICE',
      options: [
        { text: 'Đáp án A (Đúng)', is_correct: true },
        { text: 'Đáp án B (Sai)', is_correct: false },
      ],
    },
  ]);

  // Grading modal
  const [gradingSubmission, setGradingSubmission] = useState<SubmissionItem | null>(null);
  const [gradingScore, setGradingScore] = useState('70');
  const [gradingPassed, setGradingPassed] = useState(true);
  const [gradingFeedback, setGradingFeedback] = useState('');
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);

  // 3-Mode Schedule / Action Modal (Publish / Archive / Delete)
  const [schedulingAction, setSchedulingAction] = useState<'PUBLISH' | 'ARCHIVE' | 'DELETE' | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'date' | 'range'>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleUntil, setScheduleUntil] = useState('');
  const [scheduleReason, setScheduleReason] = useState('');

  // Themed Confirm Delete Modal (replacing native Alert.alert)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
    type: 'module' | 'lesson' | 'quiz';
    id: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    const unsub = session.onClear(() => {
      router.replace('/');
    });
    return unsub;
  }, [router]);

  const loadAll = useCallback(async () => {
    if (!session || !id) return;
    try {
      const c = await session.api.GET('/api/v1/courses/{id}', {
        params: { path: { id } },
      });
      if (c.data) {
        const cData = c.data as Course;
        setCourse(cData);
        setTitle(cData.title);
        setTag((cData.tag as CourseTag) || 'CNTT & Phần mềm');
        setDescription(cData.description || '');
        setThumbnailUrl(cData.thumbnail_url || '');
        setAccessMode((cData.access_mode as 'PUBLIC' | 'LINK' | 'RESTRICTED') || 'PUBLIC');
        setAllowedEmailsText((cData.allowed_emails || []).join('\n'));

        const isAdmin = session.user?.roles.includes('ADMIN');
        if (getActiveRoleMode() !== 'INSTRUCTOR' && !isAdmin) {
          setMessage('Vui lòng chuyển sang chế độ Giảng viên để quản lý và chỉnh sửa khóa học.');
          router.replace(`/course/${id}`);
          return;
        }
        if (cData.is_locked && !isAdmin) {
          setModules([]);
          setLessons([]);
          setQuizzes([]);
          return;
        }
      }

      const m = await session.api.GET('/api/v1/courses/{id}/modules', {
        params: { path: { id }, query: { limit: 100 } },
      });
      if (m.data) setModules(m.data);

      const l = await session.api.GET('/api/v1/courses/{id}/lessons', {
        params: { path: { id }, query: { limit: 100 } },
      });
      if (l.data) setLessons(l.data);

      const q = await session.api.GET('/api/v1/courses/{id}/quizzes', {
        params: { path: { id } },
      });
      if (q.data) {
        setQuizzes(q.data as Quiz[]);
        if (q.data.length > 0) {
          const subRes = await session.api.GET('/api/v1/quizzes/{id}/submissions', {
            params: { path: { id: q.data[0].id } },
          });
          if (subRes.data && Array.isArray(subRes.data)) {
            setSubmissions(subRes.data as unknown as SubmissionItem[]);
          }
        }
      }

      const a = await session.api.GET('/api/v1/courses/{id}/analytics', {
        params: { path: { id } },
      });
      if (a.data) setAnalytics(a.data);
    } catch {
      setMessage('Không thể tải dữ liệu khóa học.');
    }
  }, [id]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Tự động cập nhật trạng thái khi đang có video ở trạng thái VALIDATING hoặc UPLOADING
  useEffect(() => {
    const hasPendingMedia = lessons.some(
      l => l.media_status === 'VALIDATING' || l.media_status === 'UPLOADING'
    );
    if (!hasPendingMedia) return;
    const timer = setInterval(() => {
      void loadAll();
    }, 3000);
    return () => clearInterval(timer);
  }, [lessons, loadAll]);

  // Save Info
  const handleSaveInfo = async () => {
    if (!session || !id || !title.trim()) {
      setMessage('Vui lòng nhập tên khóa học.');
      return;
    }
    const parsedEmails = allowedEmailsText
      .split(/[\n,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);

    setBusy(true);
    setMessage('');
    try {
      const { error } = await session.api.PATCH('/api/v1/courses/{id}', {
        params: { path: { id } },
        body: {
          title: title.trim(),
          tag,
          description: description.trim(),
          thumbnail_url: thumbnailUrl.trim() || undefined,
          access_mode: accessMode,
          allowed_emails: accessMode === 'RESTRICTED' ? parsedEmails : [],
        },
      });
      if (error) throw new Error(error.message);
      setMessage('Đã lưu thông tin khóa học thành công!');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi cập nhật.');
    } finally {
      setBusy(false);
    }
  };

  // Publish / Unpublish / Delete with 3-mode Schedule Modal
  const openScheduleModal = (action: 'PUBLISH' | 'ARCHIVE' | 'DELETE') => {
    animateTransition();
    setSchedulingAction(action);
    setScheduleMode('now');
    setScheduleAt(new Date().toISOString().slice(0, 10));
    setScheduleUntil('');
    setScheduleReason('');
  };

  const executeCourseAction = async () => {
    if (!session || !id || !schedulingAction) return;
    setBusy(true);
    setMessage('');
    try {
      const bodyPayload: Record<string, unknown> = {
        reason: scheduleReason.trim() || undefined,
      };
      if (scheduleMode === 'date' && scheduleAt.trim()) {
        bodyPayload.scheduled_at = new Date(scheduleAt.trim()).toISOString();
      } else if (scheduleMode === 'range') {
        if (scheduleAt.trim()) bodyPayload.scheduled_at = new Date(scheduleAt.trim()).toISOString();
        if (scheduleUntil.trim()) bodyPayload.scheduled_until = new Date(scheduleUntil.trim()).toISOString();
      }

      if (schedulingAction === 'PUBLISH') {
        const { error } = await session.api.POST('/api/v1/courses/{id}/publish', {
          params: { path: { id } },
          body: bodyPayload as never,
        });
        if (error) throw new Error(error.message);
        setMessage(scheduleMode === 'now' ? 'Đã xuất bản khóa học thành công!' : 'Đã lên lịch xuất bản khóa học!');
      } else if (schedulingAction === 'ARCHIVE') {
        const { error } = await session.api.POST('/api/v1/courses/{id}/archive', {
          params: { path: { id } },
          body: bodyPayload as never,
        });
        if (error) throw new Error(error.message);
        setMessage(scheduleMode === 'now' ? 'Đã chuyển khóa học về Lưu trữ!' : 'Đã lên lịch lưu trữ khóa học!');
      } else if (schedulingAction === 'DELETE') {
        const { error } = await session.api.POST('/api/v1/courses/{id}/delete', {
          params: { path: { id } },
          body: bodyPayload as never,
        });
        if (error) throw new Error(error.message);
        if (scheduleMode === 'now') {
          setSchedulingAction(null);
          router.replace('/');
          return;
        }
        setMessage('Đã lên lịch xóa khóa học!');
      }

      setSchedulingAction(null);
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSchedule = async () => {
    if (!session || !id) return;
    setBusy(true);
    try {
      const { error } = await (session.api.POST as unknown as (p: string, opts: unknown) => Promise<{ error?: { message?: string } }>)(
        '/api/v1/courses/{id}/cancel-schedule',
        { params: { path: { id } } },
      );
      if (error) throw new Error(error.message);
      setMessage('Đã hủy lịch hẹn thao tác.');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa hủy được lịch hẹn.');
    } finally {
      setBusy(false);
    }
  };

  // Add Chapter (Module)
  const handleCreateModule = async () => {
    if (!session || !id || !moduleTitle.trim()) return;
    setBusy(true);
    try {
      await session.api.POST('/api/v1/courses/{id}/modules', {
        params: { path: { id } },
        body: { title: moduleTitle.trim(), position: modules.length },
      });
      setModuleTitle('');
      setShowAddModuleModal(false);
      void loadAll();
    } catch {
      setMessage('Lỗi khi thêm chương.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteModule = async (moduleId: string, modTitle?: string) => {
    if (!session) return;
    setConfirmDeleteTarget({ type: 'module', id: moduleId, title: modTitle || 'chương này' });
  };

  // Add Lesson
  const handleCreateLesson = async () => {
    if (!session || !selectedModuleId || !lessonTitle.trim()) return;
    setBusy(true);
    try {
      const modLessons = lessons.filter(l => l.module_id === selectedModuleId);
      await session.api.POST('/api/v1/modules/{id}/lessons', {
        params: { path: { id: selectedModuleId } },
        body: {
          title: lessonTitle.trim(),
          position: modLessons.length,
          required: lessonRequired,
        },
      });
      setLessonTitle('');
      setShowAddLessonModal(false);
      void loadAll();
    } catch {
      setMessage('Lỗi khi thêm bài học.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLesson = async (lessonId: string, lesTitle?: string) => {
    if (!session) return;
    setConfirmDeleteTarget({ type: 'lesson', id: lessonId, title: lesTitle || 'bài học này' });
  };

  // Quiz Builder
  const handleSaveQuiz = async () => {
    if (!session || !id) return;
    if (!quizTitle.trim()) {
      setMessage('Vui lòng nhập tiêu đề bài kiểm tra.');
      return;
    }
    if (!selectedQuizModuleId) {
      setMessage('Vui lòng chọn chương học cho bài kiểm tra này.');
      return;
    }
    if (!quizQuestions || quizQuestions.length === 0) {
      setMessage('Bài kiểm tra cần có ít nhất 1 câu hỏi.');
      return;
    }
    for (let i = 0; i < quizQuestions.length; i++) {
      const q = quizQuestions[i];
      if (!q.text.trim()) {
        setMessage(`Câu hỏi ${i + 1} chưa có nội dung.`);
        return;
      }
      if (q.question_type === 'MULTIPLE_CHOICE') {
        if (!q.options || q.options.length < 2) {
          setMessage(`Câu hỏi ${i + 1} cần có ít nhất 2 phương án trả lời.`);
          return;
        }
        if (q.options.some(o => !o.text.trim())) {
          setMessage(`Câu hỏi ${i + 1} có phương án trả lời đang để trống.`);
          return;
        }
        const correctCount = q.options.filter(o => o.is_correct).length;
        if (correctCount !== 1) {
          setMessage(`Câu hỏi ${i + 1} cần chọn đúng 1 đáp án đúng (hiện chọn ${correctCount}).`);
          return;
        }
      }
    }

    setBusy(true);
    try {
      const timeLimitNum = parseInt(quizTimeLimit, 10);
      const res = await session.api.POST('/api/v1/courses/{id}/quizzes', {
        params: { path: { id } },
        body: {
          title: quizTitle.trim(),
          module_id: selectedQuizModuleId || undefined,
          required: true,
          pass_threshold: parseInt(quizPassThreshold, 10) || 70,
          max_attempts: parseInt(quizMaxAttempts, 10) || 3,
          time_limit_minutes: timeLimitNum > 0 ? timeLimitNum : null,
          questions: quizQuestions,
        },
      });
      if (res.error) {
        throw new Error((res.error as { message?: string })?.message || 'Lỗi khi tạo đề thi.');
      }
      setQuizTitle('');
      setShowQuizBuilderModal(false);
      setMessage('Đã thêm bài kiểm tra mới thành công!');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi tạo đề.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteQuiz = async (quizId: string, qTitle?: string) => {
    if (!session) return;
    setConfirmDeleteTarget({ type: 'quiz', id: quizId, title: qTitle || 'đề thi này' });
  };

  const confirmDeleteExecution = async () => {
    if (!session || !confirmDeleteTarget) return;
    setBusy(true);
    try {
      if (confirmDeleteTarget.type === 'module') {
        await session.api.POST('/api/v1/modules/{id}/delete', {
          params: { path: { id: confirmDeleteTarget.id } },
        });
      } else if (confirmDeleteTarget.type === 'lesson') {
        await session.api.POST('/api/v1/lessons/{id}/delete', {
          params: { path: { id: confirmDeleteTarget.id } },
        });
      } else if (confirmDeleteTarget.type === 'quiz') {
        await session.api.POST('/api/v1/quizzes/{id}/delete', {
          params: { path: { id: confirmDeleteTarget.id } },
        });
      }
      setConfirmDeleteTarget(null);
      void loadAll();
    } catch {
      setMessage('Lỗi khi xóa mục đã chọn.');
    } finally {
      setBusy(false);
    }
  };

  // Grade Submissions
  const handleSaveGrade = async () => {
    if (!session || !gradingSubmission) return;
    setBusy(true);
    try {
      await session.api.POST('/api/v1/attempts/{id}/grade', {
        params: { path: { id: gradingSubmission.id } },
        body: {
          score: parseFloat(gradingScore) || 0,
          passed: gradingPassed,
          instructor_feedback: gradingFeedback.trim(),
        },
      });
      setGradingSubmission(null);
      setMessage('Đã lưu kết quả chấm bài!');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi chấm bài.');
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = Boolean(session.user?.roles.includes('ADMIN'));
  const isLockedForEditor = Boolean(course?.is_locked && !isAdmin);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top Header Bar (Fixed Safe Top Header) */}
      <View style={[styles.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.back()}>
          <Text style={[styles.backBtnText, { color: colors.text }]}>‹ Trở về</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {modules.length > 0 && !isLockedForEditor && (
            <TouchableOpacity
              style={[styles.outlineBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
              onPress={() => setShowOutlineModal(true)}
            >
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Mục lục ({modules.length})</Text>
            </TouchableOpacity>
          )}
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: course?.is_locked
                  ? isDark
                    ? 'rgba(239, 68, 68, 0.18)'
                    : 'rgba(254, 226, 226, 0.92)'
                  : colors.primaryLight,
                borderColor: course?.is_locked ? 'rgba(239, 68, 68, 0.45)' : colors.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                { color: course?.is_locked ? '#ef4444' : colors.primary },
              ]}
            >
              {course?.is_locked
                ? 'Đang bị khóa'
                : course?.status === 'PUBLISHED'
                ? 'Đã xuất bản'
                : course?.status === 'ARCHIVED'
                ? 'Lưu trữ'
                : 'Bản nháp'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={[styles.container, { backgroundColor: colors.bg, flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
      >

      <View style={styles.headerInfo}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{course?.title || 'Soạn bài giảng'}</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
          Quản lý toàn diện chương trình, tải video bài giảng, đề thi và chấm bài.
        </Text>
      </View>

      {/* Locked Course Banner */}
      {course?.is_locked && (
        <View
          style={{
            backgroundColor: isDark ? 'rgba(127, 29, 29, 0.35)' : 'rgba(254, 242, 242, 0.95)',
            borderColor: isDark ? 'rgba(248, 113, 113, 0.4)' : 'rgba(252, 165, 165, 0.9)',
            borderWidth: 1,
            padding: 14,
            borderRadius: 12,
            gap: 4,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '800', color: isDark ? '#fca5a5' : '#991b1b' }}>
            Khóa học đang bị tạm khóa bởi Quản trị viên
          </Text>
          <Text style={{ fontSize: 12, color: isDark ? '#fecaca' : '#b91c1c', lineHeight: 18 }}>
            Lý do: {course.locked_reason || 'Đang trong quá trình rà soát nội dung.'}
          </Text>
          {course.scheduled_until && (
            <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#fca5a5' : '#991b1b', marginTop: 2 }}>
              Thời hạn mở khóa tự động: {new Date(course.scheduled_until).toLocaleString('vi-VN')}
            </Text>
          )}
        </View>
      )}

      {/* Scheduled Action Banner */}
      {course?.scheduled_action && !course?.is_locked && (
        <View
          style={{
            backgroundColor: isDark ? 'rgba(120, 53, 15, 0.32)' : 'rgba(255, 251, 235, 0.95)',
            borderColor: isDark ? 'rgba(251, 191, 36, 0.4)' : 'rgba(253, 230, 138, 0.9)',
            borderWidth: 1,
            padding: 12,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#fcd34d' : '#92400e' }}>
              Đã lên lịch:{' '}
              {course.scheduled_action === 'PUBLISH'
                ? 'Xuất bản khóa học'
                : course.scheduled_action === 'ARCHIVE'
                ? 'Ngừng xuất bản (Lưu trữ)'
                : 'Xóa khóa học'}
            </Text>
            {course.scheduled_at && (
              <Text style={{ fontSize: 11, color: isDark ? '#fde68a' : '#b45309', marginTop: 2 }}>
                Thời gian áp dụng: {new Date(course.scheduled_at).toLocaleString('vi-VN')}
                {course.scheduled_until ? ` → ${new Date(course.scheduled_until).toLocaleString('vi-VN')}` : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={{
              backgroundColor: isDark ? 'rgba(251, 191, 36, 0.2)' : '#fef3c7',
              borderColor: '#f59e0b',
              borderWidth: 1,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
            }}
            onPress={handleCancelSchedule}
            disabled={busy}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#fcd34d' : '#b45309' }}>Hủy lịch</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Action Row */}
      {!isLockedForEditor && (
        <View style={styles.actionRow}>
          {course?.status === 'DRAFT' || course?.status === 'ARCHIVED' ? (
            <TouchableOpacity
              style={[styles.publishBtn, { backgroundColor: colors.primary }]}
              onPress={() => openScheduleModal('PUBLISH')}
              disabled={busy}
            >
              <Text style={styles.publishBtnText}>Xuất bản khóa học</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.unpublishBtn}
              onPress={() => openScheduleModal('ARCHIVE')}
              disabled={busy}
            >
              <Text style={styles.unpublishBtnText}>Ngừng xuất bản</Text>
            </TouchableOpacity>
          )}

          {course && (
            <TouchableOpacity
              style={{
                backgroundColor: colors.cardElevated,
                borderColor: colors.border,
                borderWidth: 1,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 8,
              }}
              onPress={async () => {
                const shareUrl = `${getCurrentApiUrl().replace(':4000', ':3000')}/course/${course.id}`;
                try {
                  await Share.share({
                    title: course.title,
                    message: `Mời bạn tham gia khóa học "${course.title}" trên LMS T16: ${shareUrl}`,
                    url: shareUrl,
                  });
                } catch {
                  // Fallback
                }
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Chia sẻ link</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.deleteBtn,
              {
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2',
                borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5',
              },
            ]}
            onPress={() => openScheduleModal('DELETE')}
            disabled={busy}
          >
            <Text style={[styles.deleteBtnText, { color: isDark ? '#f87171' : '#dc2626' }]}>Xóa khóa học</Text>
          </TouchableOpacity>
        </View>
      )}

      {message ? (
        <View
          style={[
            styles.alertBanner,
            {
              backgroundColor: glassCardBg,
              borderColor: colors.primary,
            },
          ]}
        >
          <Text style={[styles.alertText, { color: colors.text }]}>{message}</Text>
        </View>
      ) : null}

      {isLockedForEditor ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', paddingVertical: 28 }]}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, textAlign: 'center' }}>
            Nội dung khóa học đang tạm đóng băng
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 19 }}>
            Bạn không thể chỉnh sửa chương, bài giảng hoặc đề thi trong thời gian khóa học bị Quản trị viên tạm khóa.
          </Text>
        </View>
      ) : (
        <>
          {/* Tabs */}
          <View style={[styles.navTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              ['curriculum', 'Chương & Bài'],
              ['quizzes', 'Soạn đề thi'],
              ['analytics', 'Thống kê'],
              ['info', 'Thông tin'],
            ].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.navTab, activeTab === key && { backgroundColor: colors.primary }]}
                onPress={() => {
                  animateTransition();
                  setActiveTab(key as 'info' | 'curriculum' | 'quizzes' | 'analytics');
                }}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.navTabText,
                    { color: colors.textMuted },
                    activeTab === key && styles.navTabTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* TAB 1: CURRICULUM WITH VIDEO UPLOAD */}
          {activeTab === 'curriculum' && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <View style={{ width: '100%', marginBottom: 4 }}>
                  <Text style={[styles.cardHeading, { color: colors.text }]}>Chương trình bài giảng</Text>
                  <Text style={[styles.cardSubheading, { color: colors.textMuted }]}>
                    Thêm chương và bài học, sau đó tải video MP4 cho từng bài.
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {modules.length > 0 && (
                    <TouchableOpacity
                      style={[styles.outlineBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => setShowOutlineModal(true)}
                    >
                      <Text style={[styles.outlineBtnText, { color: colors.text }]}>Danh sách chương</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.addBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setShowAddModuleModal(true)}
                  >
                    <Text style={[styles.addBtnText, { color: '#ffffff' }]}>+ Thêm chương</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {modules.length === 0 ? (
                <View style={[styles.emptyChapterBox, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                  <Text style={[styles.emptyChapterTitle, { color: colors.text }]}>Bắt đầu từ chương đầu tiên</Text>
                  <Text style={[styles.emptyNotice, { color: colors.textMuted, textAlign: 'center' }]}>
                    Chưa có chương nào. Hãy nhấn &quot;+ Thêm chương&quot; để bắt đầu tạo lộ trình bài giảng.
                  </Text>
                </View>
              ) : (
                (() => {
                  const safeIndex = Math.min(activeChapterIndex, Math.max(0, modules.length - 1));
                  const mod = modules[safeIndex];
                  const modLessons = lessons.filter(l => l.module_id === mod.id);

                  return (
                    <>
                      {/* Chapter Stepper Dots */}
                      <View style={[styles.stepperCard, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                        <View style={styles.stepperHeaderRow}>
                          <Text style={[styles.stepperLabel, { color: colors.textSecondary }]}>
                            Đang chọn: <Text style={{ color: colors.primary, fontWeight: '700' }}>Chương {safeIndex + 1} / {modules.length}</Text>
                          </Text>
                          <TouchableOpacity onPress={() => setShowOutlineModal(true)}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Xem tất cả ›</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepperDotsRow}>
                          {modules.map((m, idx) => {
                            const isActive = idx === safeIndex;
                            return (
                              <TouchableOpacity
                                key={m.id}
                                style={[
                                  styles.stepperPill,
                                  { backgroundColor: colors.card, borderColor: colors.border },
                                  isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
                                ]}
                                onPress={() => {
                                  animateTransition();
                                  setActiveChapterIndex(idx);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.stepperPillText,
                                    { color: isActive ? '#ffffff' : colors.textSecondary },
                                  ]}
                                  numberOfLines={1}
                                >
                                  Chương {idx + 1}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>

                      {/* Active Chapter Card */}
                      <View key={mod.id} style={[styles.moduleBox, { backgroundColor: colors.cardElevated, borderColor: colors.border, padding: 16 }]}>
                        <View style={{ marginBottom: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                            CHƯƠNG {String(safeIndex + 1).padStart(2, '0')} · {modLessons.length} BÀI HỌC
                          </Text>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4, marginBottom: 12 }}>
                            {mod.title}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <TouchableOpacity
                              style={[styles.addLessonBtn, { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 }]}
                              onPress={() => {
                                setSelectedModuleId(mod.id);
                                setShowAddLessonModal(true);
                              }}
                            >
                              <Text style={[styles.addLessonBtnText, { fontSize: 12 }]}>+ Thêm bài học</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.addLessonBtn, { backgroundColor: '#0284c7', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 }]}
                              onPress={() => {
                                setSelectedQuizModuleId(mod.id);
                                setQuizTitle(`Bài kiểm tra Chương ${safeIndex + 1}`);
                                setShowQuizBuilderModal(true);
                              }}
                            >
                              <Text style={[styles.addLessonBtnText, { fontSize: 12 }]}>+ Thêm bài kiểm tra</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.deleteModuleBtn,
                                { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
                              ]}
                              onPress={() => void handleDeleteModule(mod.id, mod.title)}
                            >
                              <Text style={[styles.deleteModuleBtnText, { color: isDark ? '#f87171' : '#dc2626', fontSize: 12 }]}>
                                Xóa chương
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Lessons list with Video Uploading */}
                        <View style={[styles.lessonsContainer, { borderTopColor: colors.border, marginTop: 12, paddingTop: 12 }]}>
                          {modLessons.length === 0 ? (
                            <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>
                              Chưa có bài học trong chương này. Nhấn &quot;+ Thêm bài học&quot; ở trên để tạo bài mới.
                            </Text>
                          ) : (
                            modLessons.map(les => (
                              <LessonEditorCard
                                key={les.id}
                                lesson={les}
                                onRefresh={loadAll}
                                onDelete={() => handleDeleteLesson(les.id, les.title)}
                              />
                            ))
                          )}
                        </View>

                        {/* Chapter Quizzes */}
                        {(() => {
                          const chapterQuizzes = quizzes.filter(q => q.module_id === mod.id);
                          if (chapterQuizzes.length === 0) return null;
                          return (
                            <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                BÀI KIỂM TRA CHƯƠNG ({chapterQuizzes.length})
                              </Text>
                              {chapterQuizzes.map(q => (
                                <View
                                  key={q.id}
                                  style={{
                                    flexDirection: 'row',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: 12,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: colors.border,
                                    backgroundColor: colors.card,
                                  }}
                                >
                                  <View style={{ flex: 1, marginRight: 8 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{q.title}</Text>
                                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                                      {q.questions.length} câu hỏi · Ngưỡng đạt {q.pass_threshold}% · Tối đa {q.max_attempts} lượt
                                      {q.time_limit_minutes ? ` · ${q.time_limit_minutes} phút` : ''}
                                    </Text>
                                  </View>
                                  <TouchableOpacity
                                    onPress={() => void handleDeleteQuiz(q.id, q.title)}
                                    style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2' }}
                                  >
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#f87171' : '#dc2626' }}>Xóa</Text>
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          );
                        })()}
                      </View>

                      {/* Prev / Next Chapter Navigation Bar */}
                      <View style={[styles.chapterNavBar, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                        <TouchableOpacity
                          style={[
                            styles.chapterNavBtn,
                            { backgroundColor: colors.card, borderColor: colors.border },
                            safeIndex <= 0 && styles.buttonDisabled,
                          ]}
                          disabled={safeIndex <= 0}
                          onPress={() => {
                            animateTransition();
                            setActiveChapterIndex(i => Math.max(0, i - 1));
                          }}
                        >
                          <Text style={[styles.chapterNavBtnText, { color: colors.text }]}>‹ Chương trước</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => setShowOutlineModal(true)}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
                            Chương {safeIndex + 1} / {modules.length}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.chapterNavBtn,
                            { backgroundColor: colors.card, borderColor: colors.border },
                            safeIndex >= modules.length - 1 && styles.buttonDisabled,
                          ]}
                          disabled={safeIndex >= modules.length - 1}
                          onPress={() => {
                            animateTransition();
                            setActiveChapterIndex(i => Math.min(modules.length - 1, i + 1));
                          }}
                        >
                          <Text style={[styles.chapterNavBtnText, { color: colors.text }]}>Chương sau ›</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                })()
              )}
            </View>
          )}

          {/* TAB 2: QUIZZES */}
          {activeTab === 'quizzes' && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardHeading, { color: colors.text }]}>Bài kiểm tra đánh giá</Text>
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => {
                    if (modules.length === 0) {
                      setMessage('Vui lòng tạo ít nhất một chương học trước khi soạn đề thi.');
                      return;
                    }
                    if (!selectedQuizModuleId && modules[0]) {
                      setSelectedQuizModuleId(modules[0].id);
                    }
                    setShowQuizBuilderModal(true);
                  }}
                >
                  <Text style={styles.addBtnText}>+ Soạn đề thi mới</Text>
                </TouchableOpacity>
              </View>

              {quizzes.length === 0 ? (
                <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa có bài kiểm tra nào.</Text>
              ) : (
                quizzes.map(q => (
                  <View key={q.id} style={[styles.quizRow, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.quizRowTitle, { color: colors.text }]}>{q.title}</Text>
                      <Text style={[styles.quizRowMeta, { color: colors.textMuted }]}>
                        {q.questions.length} câu hỏi · Điểm đạt {q.pass_threshold}% · Tối đa {q.max_attempts} lượt
                        {q.time_limit_minutes ? ` · Thời gian: ${q.time_limit_minutes} phút` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.deleteModuleBtn, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2' }]}
                      onPress={() => void handleDeleteQuiz(q.id, q.title)}
                    >
                      <Text style={[styles.deleteModuleBtnText, { color: isDark ? '#f87171' : '#dc2626' }]}>Xóa đề</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}

          {/* TAB 3: ANALYTICS & GRADING */}
          {activeTab === 'analytics' && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardHeading, { color: colors.text }]}>Thống kê khóa học</Text>
              {analytics ? (
                <View style={styles.analyticsRow}>
                  <View style={[styles.analyticsCard, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                    <Text style={[styles.analyticsNumber, { color: colors.primary }]}>{analytics.enrolled ?? 0}</Text>
                    <Text style={[styles.analyticsLabel, { color: colors.textMuted }]}>Học viên ghi danh</Text>
                  </View>
                  <View style={[styles.analyticsCard, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                    <Text style={[styles.analyticsNumber, { color: colors.primary }]}>
                      {analytics.enrolled > 0
                        ? `${Math.round((analytics.completed / analytics.enrolled) * 100)}%`
                        : '0%'}
                    </Text>
                    <Text style={[styles.analyticsLabel, { color: colors.textMuted }]}>Tỷ lệ hoàn thành</Text>
                  </View>
                </View>
              ) : null}

              <Text style={[styles.cardHeading, { color: colors.text, marginTop: 16 }]}>
                Danh sách bài nộp của học viên ({submissions.length})
              </Text>

              {submissions.length === 0 ? (
                <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa có học viên nào nộp bài.</Text>
              ) : (
                submissions.map(sub => (
                  <View key={sub.id} style={[styles.subCardRow, { borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.subName, { color: colors.text }]}>{sub.user_name || 'Học viên'}</Text>
                      <Text style={[styles.subMeta, { color: colors.textMuted }]}>
                        Email: {sub.user_email} · Lượt {sub.attempt_number} · Điểm: {sub.score != null ? Number(sub.score).toFixed(1) : '--'} ({sub.passed ? 'Đạt' : 'Chưa đạt'})
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.gradeActionBtn, { backgroundColor: colors.primary }]}
                      onPress={() => {
                        setGradingSubmission(sub);
                        setGradingScore(String(sub.score ?? 70));
                        setGradingPassed(Boolean(sub.passed));
                        setGradingFeedback(sub.instructor_feedback || '');
                      }}
                    >
                      <Text style={styles.gradeActionBtnText}>Chấm bài</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}

          {/* TAB 4: GENERAL INFO */}
          {activeTab === 'info' && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardHeading, { color: colors.text }]}>Thiết lập thông tin</Text>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Tên khóa học:</Text>
                <TextInput style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]} value={title} onChangeText={setTitle} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Chủ đề đào tạo:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ gap: 6 }}>
                  {COURSE_TAGS.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.tagPill,
                        { backgroundColor: colors.cardElevated, borderColor: colors.border },
                        tag === t && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setTag(t)}
                    >
                      <Text style={[styles.tagPillText, { color: colors.text }, tag === t && styles.tagPillTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Quyền truy cập:</Text>
                <View style={styles.segmentedRow}>
                  {[
                    ['PUBLIC', 'Công khai'],
                    ['LINK', 'Chia sẻ link'],
                    ['RESTRICTED', 'Chỉ định'],
                  ].map(([m, lbl]) => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.segmentPill,
                        { backgroundColor: colors.cardElevated, borderColor: colors.border },
                        accessMode === m && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setAccessMode(m as 'PUBLIC' | 'LINK' | 'RESTRICTED')}
                    >
                      <Text style={[styles.segmentPillText, { color: colors.textSecondary }, accessMode === m && styles.textWhite]}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {accessMode === 'RESTRICTED' && (
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Danh sách email học viên:</Text>
                  <TextInput
                    style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    multiline
                    value={allowedEmailsText}
                    onChangeText={setAllowedEmailsText}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Ảnh bìa khóa học (tải từ thiết bị):</Text>
                {thumbnailUrl ? (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    <Image
                      source={{ uri: thumbnailUrl }}
                      style={{ width: '100%', height: 150, borderRadius: 10, backgroundColor: colors.cardElevated }}
                      resizeMode="cover"
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 9,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: colors.primary,
                          backgroundColor: colors.primaryLight,
                          alignItems: 'center',
                        }}
                        onPress={async () => {
                          try {
                            const dataUrl = await pickCourseThumbnailImage();
                            if (dataUrl) setThumbnailUrl(dataUrl);
                          } catch (e) {
                            setMessage(e instanceof Error ? e.message : 'Không thể đọc ảnh đã chọn.');
                          }
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Đổi ảnh khác</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 9,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: 'rgba(239, 68, 68, 0.4)',
                          backgroundColor: 'rgba(239, 68, 68, 0.12)',
                          alignItems: 'center',
                        }}
                        onPress={() => setThumbnailUrl('')}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#ef4444' }}>Xóa ảnh</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={{
                      marginTop: 4,
                      paddingVertical: 18,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: colors.primary,
                      backgroundColor: colors.cardElevated,
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onPress={async () => {
                      try {
                        const dataUrl = await pickCourseThumbnailImage();
                        if (dataUrl) setThumbnailUrl(dataUrl);
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : 'Không thể đọc ảnh đã chọn.');
                      }
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                      Chọn ảnh bìa từ điện thoại
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>
                      Hỗ trợ JPG, PNG, WebP (tối đa 5 MB)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Mô tả khóa học:</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  multiline
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={handleSaveInfo} disabled={busy}>
                <Text style={styles.primaryButtonText}>Lưu cập nhật</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* MODAL: Thêm chương */}
      <Modal visible={showAddModuleModal} transparent animationType="fade" onRequestClose={() => setShowAddModuleModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Thêm chương bài giảng mới</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Nhập tên chương..."
              placeholderTextColor={colors.textMuted}
              value={moduleTitle}
              onChangeText={setModuleTitle}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setShowAddModuleModal(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]} onPress={handleCreateModule}>
                <Text style={styles.primaryButtonSmallText}>Thêm chương</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Thêm bài học */}
      <Modal visible={showAddLessonModal} transparent animationType="fade" onRequestClose={() => setShowAddLessonModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Thêm bài học mới</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Nhập tên bài học..."
              placeholderTextColor={colors.textMuted}
              value={lessonTitle}
              onChangeText={setLessonTitle}
            />
            <View style={styles.switchRow}>
              <Text style={[styles.label, { color: colors.text }]}>Bài học bắt buộc:</Text>
              <Switch value={lessonRequired} onValueChange={setLessonRequired} trackColor={{ true: colors.primary, false: '#64748b' }} />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setShowAddLessonModal(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]} onPress={handleCreateLesson}>
                <Text style={styles.primaryButtonSmallText}>Thêm bài học</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Soạn bài kiểm tra (Quiz Builder) */}
      <Modal visible={showQuizBuilderModal} transparent animationType="fade" onRequestClose={() => setShowQuizBuilderModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <ScrollView style={[styles.quizModalScroll, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Soạn đề thi mới</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Tiêu đề bài kiểm tra:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                value={quizTitle}
                onChangeText={setQuizTitle}
                placeholder="Ví dụ: Ôn tập cuối chương"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            {/* Chapter Selector */}
            {modules.length > 0 ? (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Áp dụng cho chương:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {modules.map((m, mIdx) => {
                    const isSelected = selectedQuizModuleId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primaryLight : colors.cardElevated,
                        }}
                        onPress={() => setSelectedQuizModuleId(m.id)}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: isSelected ? colors.primary : colors.text }}>
                          Chương {mIdx + 1}: {m.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 8 }}>
                Chưa có chương học nào. Vui lòng tạo chương học trước khi tạo đề kiểm tra.
              </Text>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Điểm đạt (%):</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                keyboardType="numeric"
                value={quizPassThreshold}
                onChangeText={setQuizPassThreshold}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Số lượt làm tối đa:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                keyboardType="numeric"
                value={quizMaxAttempts}
                onChangeText={setQuizMaxAttempts}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Thời gian làm bài (phút, 0 = không giới hạn):</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                keyboardType="numeric"
                value={quizTimeLimit}
                onChangeText={setQuizTimeLimit}
              />
            </View>

            <Text style={[styles.label, { color: colors.text, marginTop: 10 }]}>Danh sách câu hỏi:</Text>
            {quizQuestions.map((q, idx) => (
              <View key={idx} style={[styles.questionBox, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                <View style={styles.qHeader}>
                  <Text style={[styles.qTitle, { color: colors.text }]}>
                    Câu {idx + 1} ({q.question_type === 'MULTIPLE_CHOICE' ? 'Trắc nghiệm' : q.question_type === 'ESSAY' ? 'Tự luận' : 'Nộp tệp'})
                  </Text>
                  <TouchableOpacity onPress={() => setQuizQuestions(prev => prev.filter((_, i) => i !== idx))}>
                    <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700' }}>Xóa câu</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  value={q.text}
                  onChangeText={txt => setQuizQuestions(prev => prev.map((item, i) => i === idx ? { ...item, text: txt } : item))}
                />

                {q.question_type === 'MULTIPLE_CHOICE' && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    {q.options.map((opt, optIdx) => (
                      <View key={optIdx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TouchableOpacity
                          onPress={() =>
                            setQuizQuestions(prev =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      options: item.options.map((o, oi) => ({
                                        ...o,
                                        is_correct: oi === optIdx,
                                      })),
                                    }
                                  : item
                              )
                            )
                          }
                          style={{ padding: 4 }}
                        >
                          <Text style={{ fontSize: 16, color: opt.is_correct ? colors.primary : colors.textMuted }}>
                            {opt.is_correct ? '●' : '○'}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              flex: 1,
                              paddingVertical: 6,
                              backgroundColor: colors.inputBg,
                              borderColor: opt.is_correct ? colors.primary : colors.inputBorder,
                              color: colors.text,
                            },
                          ]}
                          value={opt.text}
                          onChangeText={txt =>
                            setQuizQuestions(prev =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      options: item.options.map((o, oi) => (oi === optIdx ? { ...o, text: txt } : o)),
                                    }
                                  : item
                              )
                            )
                          }
                        />
                        {q.options.length > 2 && (
                          <TouchableOpacity
                            onPress={() =>
                              setQuizQuestions(prev =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, options: item.options.filter((_, oi) => oi !== optIdx) }
                                    : item
                                )
                              )
                            }
                            style={{ padding: 4 }}
                          >
                            <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '700' }}>✕</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={() =>
                        setQuizQuestions(prev =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  options: [...item.options, { text: `Đáp án ${item.options.length + 1}`, is_correct: false }],
                                }
                              : item
                          )
                        )
                      }
                      style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>+ Thêm phương án</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}

            <View style={styles.addQuestionBtnsRow}>
              <TouchableOpacity
                style={[styles.addTypeBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                onPress={() =>
                  setQuizQuestions(prev => [
                    ...prev,
                    {
                      text: `Câu hỏi ${prev.length + 1}`,
                      question_type: 'MULTIPLE_CHOICE',
                      options: [
                        { text: 'Đáp án A (Đúng)', is_correct: true },
                        { text: 'Đáp án B', is_correct: false },
                      ],
                    },
                  ])
                }
              >
                <Text style={[styles.addTypeBtnText, { color: colors.text }]}>+ Trắc nghiệm</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.addTypeBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                onPress={() =>
                  setQuizQuestions(prev => [
                    ...prev,
                    { text: `Câu hỏi ${prev.length + 1}`, question_type: 'ESSAY', options: [] },
                  ])
                }
              >
                <Text style={[styles.addTypeBtnText, { color: colors.text }]}>+ Tự luận</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.addTypeBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                onPress={() =>
                  setQuizQuestions(prev => [
                    ...prev,
                    { text: `Câu hỏi ${prev.length + 1}`, question_type: 'FILE_UPLOAD', options: [] },
                  ])
                }
              >
                <Text style={[styles.addTypeBtnText, { color: colors.text }]}>+ Nộp tệp</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setShowQuizBuilderModal(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]} onPress={handleSaveQuiz}>
                <Text style={styles.primaryButtonSmallText}>Lưu đề thi</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: Chấm bài */}
      <Modal visible={Boolean(gradingSubmission)} transparent animationType="fade" onRequestClose={() => setGradingSubmission(null)}>
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>
              Chấm bài: {gradingSubmission?.user_name || 'Học viên'}
            </Text>
            <Text style={[styles.subMeta, { color: colors.textMuted }]}>
              Email: {gradingSubmission?.user_email} · Lượt {gradingSubmission?.attempt_number}
            </Text>

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
              <Text style={[styles.label, { color: colors.text }]}>Đạt bài kiểm tra:</Text>
              <Switch value={gradingPassed} onValueChange={setGradingPassed} trackColor={{ true: colors.primary, false: '#64748b' }} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Nhận xét cho học viên:</Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                multiline
                value={gradingFeedback}
                onChangeText={setGradingFeedback}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setGradingSubmission(null)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButtonSmall, { backgroundColor: colors.primary }]} onPress={handleSaveGrade}>
                <Text style={styles.primaryButtonSmallText}>Lưu điểm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Mục lục chương & bài học (Jump directly) */}
      <Modal visible={showOutlineModal} transparent animationType="fade" onRequestClose={() => setShowOutlineModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1, maxHeight: '82%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={[styles.modalHeading, { color: colors.text }]}>Mục lục chương & bài học</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  Nhấn vào chương hoặc bài học để chuyển đến trực tiếp
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowOutlineModal(false)} style={{ padding: 6 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.textMuted }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ marginTop: 8 }} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
              {modules.map((m, idx) => {
                const mLessons = lessons.filter(l => l.module_id === m.id);
                const isSelectedMod = idx === activeChapterIndex;
                return (
                  <View
                    key={m.id}
                    style={{
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: isSelectedMod ? colors.primary : colors.border,
                      backgroundColor: colors.cardElevated,
                      overflow: 'hidden',
                    }}
                  >
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 12,
                        backgroundColor: isSelectedMod ? colors.primaryLight : colors.cardElevated,
                      }}
                      onPress={() => {
                        animateTransition();
                        setActiveTab('curriculum');
                        setActiveChapterIndex(idx);
                        setShowOutlineModal(false);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>
                          CHƯƠNG {idx + 1} · {mLessons.length} BÀI HỌC
                        </Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 2 }}>
                          {m.title}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Mở chương ›</Text>
                    </TouchableOpacity>

                    {mLessons.length > 0 && (
                      <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                        {mLessons.map((les, lIdx) => (
                          <TouchableOpacity
                            key={les.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingVertical: 10,
                              paddingHorizontal: 14,
                              borderBottomWidth: lIdx < mLessons.length - 1 ? 1 : 0,
                              borderBottomColor: colors.border,
                            }}
                            onPress={() => {
                              animateTransition();
                              setActiveTab('curriculum');
                              setActiveChapterIndex(idx);
                              setShowOutlineModal(false);
                            }}
                          >
                            <Text style={{ fontSize: 13, color: colors.text, flex: 1 }} numberOfLines={1}>
                              {idx + 1}.{lIdx + 1} {les.title}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '700',
                                color: les.media_status === 'READY' ? '#10b981' : colors.textMuted,
                              }}
                            >
                              {les.media_status === 'READY' ? 'Sẵn sàng' : 'Chưa có video'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL: 3-Mode Schedule / Course Action Modal (Publish / Archive / Delete) */}
      <Modal
        visible={Boolean(schedulingAction)}
        transparent
        animationType="fade"
        onRequestClose={() => setSchedulingAction(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>
              {schedulingAction === 'PUBLISH'
                ? 'Xuất bản khóa học'
                : schedulingAction === 'ARCHIVE'
                ? 'Ngừng xuất bản (Lưu trữ)'
                : 'Xóa khóa học'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12, lineHeight: 18 }}>
              {schedulingAction === 'DELETE'
                ? `Bạn có chắc muốn xóa khóa học "${course?.title}"? Thao tác có thể áp dụng ngay hoặc lên lịch kèm lý do.`
                : `Khóa học: ${course?.title}`}
            </Text>

            <View style={{ gap: 8, marginTop: 4 }}>
              {(
                schedulingAction === 'DELETE'
                  ? ([
                      ['now', 'Áp dụng ngay lập tức'],
                      ['date', 'Lên lịch theo ngày giờ'],
                    ] as const)
                  : ([
                      ['now', 'Áp dụng ngay lập tức'],
                      ['date', 'Lên lịch theo ngày giờ'],
                      ['range', 'Áp dụng từ ngày đến ngày'],
                    ] as const)
              ).map(([modeKey, modeLabel]) => {
                const selected = scheduleMode === modeKey;
                return (
                  <TouchableOpacity
                    key={modeKey}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected
                        ? colors.primaryLight
                        : colors.cardElevated,
                    }}
                    onPress={() => {
                      animateTransition();
                      setScheduleMode(modeKey);
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{modeLabel}</Text>
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2,
                        borderColor: selected ? colors.primary : colors.textMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {selected && (
                        <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.primary }} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {(scheduleMode === 'date' || scheduleMode === 'range') && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {scheduleMode === 'range' ? 'Từ ngày (YYYY-MM-DD):' : 'Thời gian thực hiện (YYYY-MM-DDTHH:mm):'}
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="Ví dụ: 2026-10-30T10:00"
                  placeholderTextColor={colors.textMuted}
                  value={scheduleAt}
                  onChangeText={setScheduleAt}
                />
              </View>
            )}

            {scheduleMode === 'range' && schedulingAction !== 'DELETE' && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Đến ngày hoàn tác tự động (YYYY-MM-DD):</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="Ví dụ: 2026-11-15"
                  placeholderTextColor={colors.textMuted}
                  value={scheduleUntil}
                  onChangeText={setScheduleUntil}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {schedulingAction === 'DELETE'
                  ? 'Thông báo kèm lý do thực hiện (tùy chọn):'
                  : 'Ghi chú / Lý do thực hiện:'}
              </Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                multiline
                placeholder={
                  schedulingAction === 'DELETE'
                    ? 'Nhập lý do ngưng xuất bản hoặc xóa khóa học để thông báo cho học viên...'
                    : 'Nhập lý do xuất bản, tạm lưu trữ hoặc xóa...'
                }
                placeholderTextColor={colors.textMuted}
                value={scheduleReason}
                onChangeText={setScheduleReason}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setSchedulingAction(null)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Hủy bỏ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryButtonSmall,
                  {
                    backgroundColor:
                      schedulingAction === 'DELETE'
                        ? '#dc2626'
                        : schedulingAction === 'ARCHIVE'
                        ? '#f59e0b'
                        : colors.primary,
                  },
                ]}
                onPress={executeCourseAction}
                disabled={busy}
              >
                <Text style={styles.primaryButtonSmallText}>
                  {busy
                    ? 'Đang xử lý...'
                    : schedulingAction === 'DELETE'
                    ? 'Xác nhận Xóa'
                    : schedulingAction === 'ARCHIVE'
                    ? 'Xác nhận Lưu trữ'
                    : 'Xác nhận Xuất bản'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Themed Confirm Delete (Module / Lesson / Quiz) */}
      <Modal
        visible={Boolean(confirmDeleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDeleteTarget(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: glassBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder, borderWidth: 1 }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Xác nhận xóa</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>
              Bạn có chắc chắn muốn xóa{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>{confirmDeleteTarget?.title}</Text> không? Thao tác này không thể hoàn tác.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setConfirmDeleteTarget(null)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButtonSmall, { backgroundColor: '#dc2626' }]}
                onPress={confirmDeleteExecution}
                disabled={busy}
              >
                <Text style={styles.primaryButtonSmallText}>{busy ? 'Đang xóa...' : 'Xác nhận xóa'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 42),
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadge: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
  headerInfo: {
    gap: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  publishBtn: {
    backgroundColor: '#21634f',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  publishBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  unpublishBtn: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unpublishBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteBtn: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  deleteBtnText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
  alertBanner: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
  },
  alertText: {
    color: '#065f46',
    fontSize: 13,
  },
  navTabs: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
  },
  navTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  navTabActive: {
    backgroundColor: '#21634f',
  },
  navTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
  },
  cardHeading: {
    fontSize: 17,
    fontWeight: '800',
  },
  cardSubheading: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 18,
  },
  addBtn: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  outlineBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  outlineBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyChapterBox: {
    borderRadius: 12,
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 6,
  },
  emptyChapterTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  stepperCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    gap: 10,
  },
  stepperHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepperLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepperDotsRow: {
    gap: 8,
  },
  stepperPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  stepperPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chapterNavBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  chapterNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  chapterNavBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyNotice: {
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  moduleBox: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  moduleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
  },
  moduleTitle: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  addLessonBtn: {
    backgroundColor: '#21634f',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addLessonBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteModuleBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deleteModuleBtnText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '700',
  },
  lessonsContainer: {
    gap: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  lessonCard: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  lessonCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  lessonCardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  lessonCardMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  deleteLessonBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  deleteLessonBtnText: {
    color: '#dc2626',
    fontSize: 10,
    fontWeight: '700',
  },
  uploadBox: {
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    gap: 6,
  },
  uploadBtn: {
    backgroundColor: '#21634f',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  uploadBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  progressContainer: {
    gap: 4,
    marginTop: 4,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#21634f',
  },
  progressText: {
    fontSize: 11,
  },
  uploadNotice: {
    fontSize: 10,
    textAlign: 'center',
  },
  previewActions: {
    marginTop: 2,
  },
  previewBtn: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  previewBtnText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
  previewWrapper: {
    width: '100%',
    height: 180,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 6,
  },
  previewPlayer: {
    width: '100%',
    height: '100%',
  },
  inlineAlert: {
    backgroundColor: '#ecfdf5',
    padding: 6,
    borderRadius: 6,
  },
  inlineAlertText: {
    fontSize: 11,
    color: '#065f46',
  },
  quizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  quizRowTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  quizRowMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  analyticsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  analyticsCard: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  analyticsNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#21634f',
  },
  analyticsLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  subCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  subName: {
    fontSize: 13,
    fontWeight: '700',
  },
  subMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  gradeActionBtn: {
    backgroundColor: '#21634f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  gradeActionBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  tagPillActive: {
    backgroundColor: '#21634f',
    borderColor: '#21634f',
  },
  tagPillText: {
    fontSize: 11,
  },
  tagPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 6,
  },
  segmentPill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  segmentPillActive: {
    backgroundColor: '#21634f',
    borderColor: '#21634f',
  },
  segmentPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  textWhite: {
    color: '#ffffff',
    fontWeight: '700',
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
  buttonDisabled: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  quizModalScroll: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeading: {
    fontSize: 17,
    fontWeight: '800',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
    paddingBottom: 10,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  primaryButtonSmall: {
    backgroundColor: '#21634f',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  primaryButtonSmallText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  questionBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    marginTop: 6,
  },
  qHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  qTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  addQuestionBtnsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  addTypeBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  addTypeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
});
