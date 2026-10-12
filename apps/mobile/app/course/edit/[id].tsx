import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COURSE_TAGS, type components } from '@lms/api-client';
import { session } from '../../../src/session';
import { useTheme } from '../../../src/theme';

type Course = components['schemas']['CourseDto'] & {
  is_locked?: boolean;
  locked_reason?: string | null;
  access_mode?: string;
  allowed_emails?: string[];
  thumbnail_url?: string | null;
  tag?: string;
};

type Module = components['schemas']['ModuleDto'];
type Lesson = components['schemas']['LessonDetailsDto'];
type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Analytics = components['schemas']['AnalyticsDto'];
type Playback = components['schemas']['PlaybackDto'];

const stateNames: Record<string, string> = {
  UPLOADING: 'Chờ tải video',
  VALIDATING: 'Đang kiểm tra video',
  READY: 'Sẵn sàng',
  FAILED: 'Xử lý thất bại',
};

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
  const player = useVideoPlayer(playback?.url ?? null);

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
      const fileSize = file.size || 0;

      if (fileSize <= 0 || fileSize > 524288000) {
        setMessage('Vui lòng chọn video MP4 dung lượng tối đa 500 MiB.');
        return;
      }

      setBusy(true);
      setMessage('Đang xin URL tải lên máy chủ...');
      setUploadProgress(0);

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

      // 2. Fetch local file blob and PUT to S3
      const fileRes = await fetch(file.uri);
      const blob = await fileRes.blob();

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

        xhr.onerror = () => reject(new Error('Kết nối tải video bị gián đoạn.'));
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
            <Text style={{ fontWeight: '700', color: lesson.media_status === 'READY' ? '#059669' : '#d97706' }}>
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
          style={[styles.uploadBtn, busy && styles.buttonDisabled]}
          onPress={handlePickAndUploadVideo}
          disabled={busy}
        >
          <Text style={styles.uploadBtnText}>
            {busy ? 'Đang xử lý...' : lesson.active_media_id ? '📁 Chọn video MP4 thay thế' : '📁 Tải video bài giảng (MP4)'}
          </Text>
        </TouchableOpacity>

        {uploadProgress !== null && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
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
          <TouchableOpacity style={styles.previewBtn} onPress={handlePreview} disabled={busy}>
            <Text style={styles.previewBtnText}>
              {playback ? 'Ẩn video xem trước' : '▶ Xem trước video bài giảng'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Video Player Preview if active */}
      {playback && (
        <View style={styles.previewWrapper}>
          <VideoView player={player} nativeControls style={styles.previewPlayer} />
        </View>
      )}

      {message ? (
        <View style={styles.inlineAlert}>
          <Text style={styles.inlineAlertText}>{message}</Text>
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
  const { colors } = useTheme();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const [activeTab, setActiveTab] = useState<'info' | 'curriculum' | 'quizzes' | 'analytics'>('curriculum');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Course info form
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('CNTT & Phần mềm');
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
  const [quizTitle, setQuizTitle] = useState('');
  const [quizPassThreshold, setQuizPassThreshold] = useState('70');
  const [quizMaxAttempts, setQuizMaxAttempts] = useState('3');
  const [quizTimeLimit, setQuizTimeLimit] = useState('0');
  const [quizQuestions, setQuizQuestions] = useState<any[]>([
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
  const [gradingSubmission, setGradingSubmission] = useState<any | null>(null);
  const [gradingScore, setGradingScore] = useState('70');
  const [gradingPassed, setGradingPassed] = useState(true);
  const [gradingFeedback, setGradingFeedback] = useState('');
  const [submissions, setSubmissions] = useState<any[]>([]);

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
        setTag(cData.tag || 'CNTT & Phần mềm');
        setDescription(cData.description || '');
        setThumbnailUrl(cData.thumbnail_url || '');
        setAccessMode((cData.access_mode as any) || 'PUBLIC');
        setAllowedEmailsText((cData.allowed_emails || []).join('\n'));
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
          const subRes = await session.api.GET('/api/v1/quizzes/{id}/submissions' as any, {
            params: { path: { id: q.data[0].id } },
          });
          if (subRes.data && Array.isArray(subRes.data)) {
            setSubmissions(subRes.data);
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
        } as any,
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

  // Publish / Unpublish / Delete
  const handlePublish = async () => {
    if (!session || !id) return;
    setBusy(true);
    try {
      const { error } = await session.api.POST('/api/v1/courses/{id}/publish', {
        params: { path: { id } },
      });
      if (error) throw new Error(error.message);
      setMessage('Khóa học đã được xuất bản!');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa thể xuất bản.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!session || !id) return;
    setBusy(true);
    try {
      const { error } = await session.api.POST('/api/v1/courses/{id}/unpublish' as any, {
        params: { path: { id } },
      });
      if (error) throw new Error(error.message);
      setMessage('Đã chuyển khóa học về bản nháp.');
      void loadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi ngừng xuất bản.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!session || !id) return;
    Alert.alert('Xóa khóa học', 'Bạn có chắc chắn muốn xóa toàn bộ khóa học này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa vĩnh viễn',
        style: 'destructive',
        onPress: async () => {
          try {
            await session.api.POST('/api/v1/courses/{id}/delete' as any, {
              params: { path: { id } },
            });
            Alert.alert('Thành công', 'Đã xóa khóa học.');
            router.replace('/');
          } catch {
            setMessage('Lỗi khi xóa khóa học.');
          }
        },
      },
    ]);
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

  const handleDeleteModule = async (moduleId: string) => {
    if (!session) return;
    Alert.alert('Xóa chương', 'Xác nhận xóa chương này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await session.api.POST('/api/v1/modules/{id}/delete' as any, {
              params: { path: { id: moduleId } },
            });
            void loadAll();
          } catch {
            setMessage('Lỗi khi xóa chương.');
          }
        },
      },
    ]);
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

  const handleDeleteLesson = async (lessonId: string) => {
    if (!session) return;
    Alert.alert('Xóa bài học', 'Xác nhận xóa bài học này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await session.api.POST('/api/v1/lessons/{id}/delete' as any, {
              params: { path: { id: lessonId } },
            });
            void loadAll();
          } catch {
            setMessage('Lỗi khi xóa bài.');
          }
        },
      },
    ]);
  };

  // Quiz Builder
  const handleSaveQuiz = async () => {
    if (!session || !id || !quizTitle.trim()) return;
    setBusy(true);
    try {
      await session.api.POST('/api/v1/courses/{id}/quizzes', {
        params: { path: { id } },
        body: {
          title: quizTitle.trim(),
          pass_threshold: parseInt(quizPassThreshold, 10) || 70,
          max_attempts: parseInt(quizMaxAttempts, 10) || 3,
          time_limit_minutes: parseInt(quizTimeLimit, 10) || null,
          questions: quizQuestions,
        } as any,
      });
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

  const handleDeleteQuiz = async (quizId: string) => {
    if (!session) return;
    Alert.alert('Xóa đề thi', 'Xác nhận xóa bài kiểm tra này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await session.api.POST('/api/v1/quizzes/{id}/delete' as any, {
              params: { path: { id: quizId } },
            });
            void loadAll();
          } catch {
            setMessage('Lỗi khi xóa đề.');
          }
        },
      },
    ]);
  };

  // Grade Submissions
  const handleSaveGrade = async () => {
    if (!session || !gradingSubmission) return;
    setBusy(true);
    try {
      await session.api.POST('/api/v1/attempts/{id}/grade' as any, {
        params: { path: { id: gradingSubmission.id } },
        body: {
          score: parseFloat(gradingScore) || 0,
          passed: gradingPassed,
          feedback: gradingFeedback.trim(),
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

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: colors.bg }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.back()}>
          <Text style={[styles.backBtnText, { color: colors.text }]}>‹ Trở về</Text>
        </TouchableOpacity>

        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>
            {course?.status === 'PUBLISHED' ? 'Đã xuất bản' : 'Bản nháp'}
          </Text>
        </View>
      </View>

      <View style={styles.headerInfo}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{course?.title || 'Soạn bài giảng'}</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
          Quản lý toàn diện chương trình, tải video bài giảng, đề thi và chấm bài.
        </Text>
      </View>

      {/* Action Row */}
      <View style={styles.actionRow}>
        {course?.status === 'DRAFT' ? (
          <TouchableOpacity style={styles.publishBtn} onPress={handlePublish} disabled={busy}>
            <Text style={styles.publishBtnText}>✓ Xuất bản khóa học</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.unpublishBtn} onPress={handleUnpublish} disabled={busy}>
            <Text style={styles.unpublishBtnText}>Ngừng xuất bản</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteCourse} disabled={busy}>
          <Text style={styles.deleteBtnText}>Xóa khóa học</Text>
        </TouchableOpacity>
      </View>

      {message ? (
        <View style={styles.alertBanner}>
          <Text style={styles.alertText}>{message}</Text>
        </View>
      ) : null}

      {/* Tabs */}
      <View style={[styles.navTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          ['curriculum', 'Chương & Bài giảng'],
          ['quizzes', 'Soạn đề thi'],
          ['analytics', 'Thống kê & Chấm'],
          ['info', 'Thông tin'],
        ].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.navTab, activeTab === key && styles.navTabActive]}
            onPress={() => setActiveTab(key as any)}
          >
            <Text style={[styles.navTabText, activeTab === key && styles.navTabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* TAB 1: CURRICULUM WITH VIDEO UPLOAD */}
      {activeTab === 'curriculum' && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={[styles.cardHeading, { color: colors.text }]}>Chương trình bài giảng</Text>
              <Text style={[styles.cardSubheading, { color: colors.textMuted }]}>
                Thêm chương và bài học, sau đó tải video MP4 cho từng bài.
              </Text>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModuleModal(true)}>
              <Text style={styles.addBtnText}>+ Thêm chương</Text>
            </TouchableOpacity>
          </View>

          {modules.length === 0 ? (
            <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>
              Chưa có chương nào. Hãy nhấn "+ Thêm chương" để bắt đầu.
            </Text>
          ) : (
            modules.map((mod, idx) => {
              const modLessons = lessons.filter(l => l.module_id === mod.id);
              return (
                <View key={mod.id} style={[styles.moduleBox, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                  <View style={styles.moduleHeaderRow}>
                    <Text style={[styles.moduleTitle, { color: colors.text }]}>
                      Chương {idx + 1}: {mod.title}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.addLessonBtn}
                        onPress={() => {
                          setSelectedModuleId(mod.id);
                          setShowAddLessonModal(true);
                        }}
                      >
                        <Text style={styles.addLessonBtnText}>+ Thêm bài</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteModuleBtn}
                        onPress={() => handleDeleteModule(mod.id)}
                      >
                        <Text style={styles.deleteModuleBtnText}>Xóa chương</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Lessons list with Video Uploading */}
                  <View style={styles.lessonsContainer}>
                    {modLessons.length === 0 ? (
                      <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>
                        Chưa có bài học trong chương này.
                      </Text>
                    ) : (
                      modLessons.map(les => (
                        <LessonEditorCard
                          key={les.id}
                          lesson={les}
                          onRefresh={loadAll}
                          onDelete={() => handleDeleteLesson(les.id)}
                        />
                      ))
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* TAB 2: QUIZZES */}
      {activeTab === 'quizzes' && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardHeading, { color: colors.text }]}>Bài kiểm tra đánh giá</Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowQuizBuilderModal(true)}>
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
                <TouchableOpacity style={styles.deleteModuleBtn} onPress={() => handleDeleteQuiz(q.id)}>
                  <Text style={styles.deleteModuleBtnText}>Xóa đề</Text>
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
                <Text style={styles.analyticsNumber}>{analytics.enrolled ?? 0}</Text>
                <Text style={[styles.analyticsLabel, { color: colors.textMuted }]}>Học viên ghi danh</Text>
              </View>
              <View style={[styles.analyticsCard, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                <Text style={styles.analyticsNumber}>
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
                    Email: {sub.user_email} · Lượt {sub.attempt_number} · Điểm: {sub.score?.toFixed(1) ?? '--'} ({sub.passed ? 'Đạt' : 'Chưa đạt'})
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.gradeActionBtn}
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
                  style={[styles.tagPill, { backgroundColor: colors.cardElevated, borderColor: colors.border }, tag === t && styles.tagPillActive]}
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
                  style={[styles.segmentPill, accessMode === m && styles.segmentPillActive]}
                  onPress={() => setAccessMode(m as any)}
                >
                  <Text style={[styles.segmentPillText, accessMode === m && styles.textWhite]}>{lbl}</Text>
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
            <Text style={[styles.label, { color: colors.text }]}>URL ảnh bìa:</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={thumbnailUrl}
              onChangeText={setThumbnailUrl}
            />
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

          <TouchableOpacity style={styles.primaryButton} onPress={handleSaveInfo} disabled={busy}>
            <Text style={styles.primaryButtonText}>Lưu cập nhật</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* MODAL: Thêm chương */}
      <Modal visible={showAddModuleModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Thêm chương bài giảng mới</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Nhập tên chương..."
              placeholderTextColor="#9ca3af"
              value={moduleTitle}
              onChangeText={setModuleTitle}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModuleModal(false)}>
                <Text style={styles.cancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButtonSmall} onPress={handleCreateModule}>
                <Text style={styles.primaryButtonSmallText}>Thêm chương</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Thêm bài học */}
      <Modal visible={showAddLessonModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Thêm bài học mới</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Nhập tên bài học..."
              placeholderTextColor="#9ca3af"
              value={lessonTitle}
              onChangeText={setLessonTitle}
            />
            <View style={styles.switchRow}>
              <Text style={[styles.label, { color: colors.text }]}>Bài học bắt buộc:</Text>
              <Switch value={lessonRequired} onValueChange={setLessonRequired} trackColor={{ true: '#21634f', false: '#cbd5e1' }} />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddLessonModal(false)}>
                <Text style={styles.cancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButtonSmall} onPress={handleCreateLesson}>
                <Text style={styles.primaryButtonSmallText}>Thêm bài học</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Soạn bài kiểm tra (Quiz Builder) */}
      <Modal visible={showQuizBuilderModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={[styles.quizModalScroll, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalHeading, { color: colors.text }]}>Soạn đề thi mới</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Tiêu đề bài kiểm tra:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                value={quizTitle}
                onChangeText={setQuizTitle}
                placeholder="Ví dụ: Ôn tập cuối chương"
                placeholderTextColor="#9ca3af"
              />
            </View>

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
                  <Text style={[styles.qTitle, { color: colors.text }]}>Câu {idx + 1} ({q.question_type})</Text>
                  <TouchableOpacity onPress={() => setQuizQuestions(prev => prev.filter((_, i) => i !== idx))}>
                    <Text style={{ color: '#dc2626', fontSize: 11, fontWeight: '700' }}>Xóa câu</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  value={q.text}
                  onChangeText={txt => setQuizQuestions(prev => prev.map((item, i) => i === idx ? { ...item, text: txt } : item))}
                />
              </View>
            ))}

            <View style={styles.addQuestionBtnsRow}>
              <TouchableOpacity
                style={styles.addTypeBtn}
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
                <Text style={styles.addTypeBtnText}>+ Trắc nghiệm</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addTypeBtn}
                onPress={() =>
                  setQuizQuestions(prev => [
                    ...prev,
                    { text: `Câu hỏi ${prev.length + 1}`, question_type: 'ESSAY', options: [] },
                  ])
                }
              >
                <Text style={styles.addTypeBtnText}>+ Tự luận</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addTypeBtn}
                onPress={() =>
                  setQuizQuestions(prev => [
                    ...prev,
                    { text: `Câu hỏi ${prev.length + 1}`, question_type: 'FILE_UPLOAD', options: [] },
                  ])
                }
              >
                <Text style={styles.addTypeBtnText}>+ Nộp tệp</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowQuizBuilderModal(false)}>
                <Text style={styles.cancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButtonSmall} onPress={handleSaveQuiz}>
                <Text style={styles.primaryButtonSmallText}>Lưu đề thi</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: Chấm bài */}
      <Modal visible={Boolean(gradingSubmission)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
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
              <Switch value={gradingPassed} onValueChange={setGradingPassed} trackColor={{ true: '#21634f', false: '#cbd5e1' }} />
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
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setGradingSubmission(null)}>
                <Text style={styles.cancelBtnText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButtonSmall} onPress={handleSaveGrade}>
                <Text style={styles.primaryButtonSmallText}>Lưu điểm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
    paddingTop: 12,
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
    alignItems: 'center',
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: '800',
  },
  cardSubheading: {
    fontSize: 12,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addBtnText: {
    color: '#065f46',
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
    padding: 12,
    borderWidth: 1,
    gap: 10,
  },
  moduleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
