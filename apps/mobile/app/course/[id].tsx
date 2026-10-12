import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { components } from '@lms/api-client';
import { session } from '../../src/session';
import { useTheme } from '../../src/theme';
import {
  NativeLesson,
  NativeQuiz,
  NativeReviewsAndComplaints,
} from '../../src/learning';

type Course = components['schemas']['CourseDto'] & {
  is_locked?: boolean;
  locked_reason?: string | null;
  access_mode?: string;
  avg_rating?: number;
  review_count?: number;
  like_count?: number;
  user_liked?: boolean;
  user_enrolled?: boolean;
  thumbnail_url?: string | null;
  tag?: string;
  instructor_name?: string | null;
};

type Module = components['schemas']['ModuleDto'];
type Lesson = components['schemas']['LessonDetailsDto'] & {
  duration_sec?: number | null;
};
type Quiz = components['schemas']['QuizDto'] & { time_limit_minutes?: number | null };
type Progress = components['schemas']['CourseProgressDto'];
type Playback = components['schemas']['PlaybackDto'];

export default function CourseScreen() {
  const router = useRouter();
  const { colors, darkMode } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const playerPositionRef = useRef<number>(0);

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);

  // Collapsible chapter states: record module_id -> boolean (true = expanded)
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});

  const [canRead, setCanRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const isOwner = Boolean(session?.user && course && session.user.id === course.owner_id);

  const loadCourseData = useCallback(async () => {
    if (!session || !id) return;
    try {
      // 1. Get Course details
      const c = await session.api.GET('/api/v1/courses/{id}', {
        params: { path: { id } },
      });
      if (c.data) setCourse(c.data as Course);

      // 2. Get Modules
      const m = await session.api.GET('/api/v1/courses/{id}/modules', {
        params: { path: { id }, query: { limit: 100 } },
      });
      if (m.data) setModules(m.data);

      // 3. Get Lessons
      const l = await session.api.GET('/api/v1/courses/{id}/lessons', {
        params: { path: { id }, query: { limit: 100 } },
      });
      if (l.data) {
        setCanRead(true);
        setLessons(l.data);
      } else {
        setCanRead(false);
      }

      // 4. Get Quizzes
      const q = await session.api.GET('/api/v1/courses/{id}/quizzes', {
        params: { path: { id } },
      });
      if (q.data) setQuizzes(q.data as Quiz[]);

      // 5. Get Progress (for student)
      const p = await session.api.GET('/api/v1/me/courses/{id}/progress', {
        params: { path: { id } },
      });
      if (p.data) setProgress(p.data);
    } catch {
      setMessage('Không thể tải thông tin khóa học.');
    }
  }, [id]);

  useEffect(() => {
    void loadCourseData();
    const timer = setInterval(() => void loadCourseData(), 6000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void loadCourseData();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [loadCourseData]);

  // When lessons load, auto-select first lesson if none selected
  useEffect(() => {
    if (lessons.length > 0 && !selectedLesson && !playback) {
      const readyLesson = lessons.find(l => l.media_status === 'READY') || lessons[0];
      handleSelectLesson(readyLesson);
    }
  }, [lessons]);

  async function handleSelectLesson(lesson: Lesson) {
    if (!session || !id) return;
    setSelectedLesson(lesson);
    setBusy(true);
    setMessage('');
    try {
      const r = await session.api.GET('/api/v1/lessons/{id}/playback', {
        params: { path: { id: lesson.id } },
      });
      if (r.data) {
        setPlayback(r.data);
        // Smoothly scroll to video player
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: playerPositionRef.current, animated: true });
        }, 150);
      } else {
        setMessage(r.error?.message || 'Chưa thể phát video này.');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi kết nối video.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnroll() {
    if (!session || !id) return;
    setEnrolling(true);
    setMessage('');
    try {
      const r = await session.api.POST('/api/v1/courses/{id}/enrollments', {
        params: { path: { id } },
      });
      if (r.error) throw new Error(r.error.message);
      await loadCourseData();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa đăng ký được khóa học.');
    } finally {
      setEnrolling(false);
    }
  }

  async function handleToggleLike() {
    if (!session || !id) return;
    try {
      const { data } = await session.api.POST('/api/v1/courses/{id}/like' as any, {
        params: { path: { id } },
      });
      if (data && course) {
        setCourse({
          ...course,
          user_liked: data.liked,
          like_count: data.total_likes,
        });
      }
    } catch {
      // Bỏ qua lỗi
    }
  }

  const toggleChapterCollapse = (moduleId: string) => {
    setCollapsedChapters(prev => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  };

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.container, { backgroundColor: colors.bg }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Top Header / Back Bar */}
      <View style={[styles.topNavBar, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.back()}
          accessibilityLabel="Trở về danh sách"
        >
          <Text style={[styles.backButtonText, { color: colors.text }]}>‹ Trở về</Text>
        </TouchableOpacity>

        {course && (
          <TouchableOpacity
            style={[styles.likeHeaderBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleToggleLike}
          >
            <Text style={[styles.likeHeart, course.user_liked && styles.likeHeartActive]}>
              {course.user_liked ? '♥' : '♡'}
            </Text>
            <Text style={[styles.likeCountText, { color: colors.text }]}>{course.like_count || 0}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Locked Course Banner */}
      {course?.is_locked && (
        <View style={styles.lockedAlertBanner}>
          <Text style={styles.lockedAlertTitle}>Khóa học đang bị tạm khóa</Text>
          <Text style={styles.lockedAlertReason}>
            Lý do: {course.locked_reason || 'Đang chờ rà soát từ ban quản trị'}
          </Text>
        </View>
      )}

      {/* Course Main Hero Card */}
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {course?.thumbnail_url ? (
          <Image
            source={{ uri: course.thumbnail_url }}
            style={styles.heroThumbnail}
            resizeMode="cover"
          />
        ) : null}

        <View style={styles.heroBody}>
          <View style={styles.tagsRow}>
            <View style={styles.badgeCategory}>
              <Text style={styles.badgeCategoryText}>
                {course?.tag || 'CNTT & Phần mềm'}
              </Text>
            </View>

            <View style={styles.badgeAccessMode}>
              <Text style={styles.badgeAccessModeText}>
                {course?.access_mode === 'RESTRICTED'
                  ? 'Chỉ định'
                  : course?.access_mode === 'LINK'
                  ? 'Chia sẻ link'
                  : 'Công khai'}
              </Text>
            </View>

            {course?.status && (
              <View style={styles.badgeStatus}>
                <Text style={styles.badgeStatusText}>
                  {course.status === 'PUBLISHED' ? 'Đã xuất bản' : 'Bản nháp'}
                </Text>
              </View>
            )}
          </View>

          <Text style={[styles.heroTitle, { color: colors.text }]}>{course?.title ?? 'Đang tải khóa học…'}</Text>

          {course?.description ? (
            <Text style={[styles.heroDescription, { color: colors.textMuted }]}>{course.description}</Text>
          ) : null}

          {/* Rating & Instructor Info */}
          <View style={styles.heroMetaRow}>
            <View style={styles.metaInstructor}>
              <Text style={styles.metaInstructorIcon}>👤</Text>
              <Text style={[styles.metaInstructorName, { color: colors.textMuted }]}>
                {course?.instructor_name || 'Giảng viên LMS'}
              </Text>
            </View>

            <View style={styles.metaRating}>
              <Text style={styles.metaRatingStar}>★</Text>
              <Text style={[styles.metaRatingScore, { color: colors.text }]}>
                {course?.avg_rating && course.avg_rating > 0
                  ? course.avg_rating.toFixed(1)
                  : 'Mới'}
              </Text>
              {course?.review_count && course.review_count > 0 ? (
                <Text style={[styles.metaReviewCount, { color: colors.textMuted }]}>({course.review_count})</Text>
              ) : null}
            </View>
          </View>

          {isOwner && (
            <TouchableOpacity
              style={styles.instructorEditBarBtn}
              onPress={() =>
                router.push({
                  pathname: '/course/edit/[id]',
                  params: { id: course!.id },
                })
              }
            >
              <Text style={styles.instructorEditBarBtnText}>
                ✏️ Quản lý & Chỉnh sửa bài giảng khóa học
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {message ? (
        <View style={styles.errorAlert}>
          <Text style={styles.errorAlertText}>{message}</Text>
        </View>
      ) : null}

      {/* NOT ENROLLED BANNER */}
      {!canRead && !isOwner ? (
        <View style={[styles.enrollCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.enrollHeading, { color: colors.text }]}>Bắt đầu lộ trình học tập ngay</Text>
          <Text style={[styles.enrollSubtext, { color: colors.textMuted }]}>
            Đăng ký khóa học để mở toàn bộ bài giảng video, transcript đồng bộ, trợ lý AI
            và các bài kiểm tra đánh giá năng lực.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, enrolling && styles.buttonDisabled]}
            onPress={handleEnroll}
            disabled={enrolling || course?.status !== 'PUBLISHED' || course?.is_locked}
          >
            {enrolling ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {course?.is_locked
                  ? 'Khóa học đang tạm khóa'
                  : course?.status !== 'PUBLISHED'
                  ? 'Khóa học chưa xuất bản'
                  : 'Đăng ký học ngay'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        /* ENROLLED OR OWNER: FULL LEARNING EXPERIENCE */
        <>
          {/* Progress Bar (Student) */}
          {progress && !isOwner && (
            <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.progressHeader}>
                <View>
                  <Text style={styles.progressEyebrow}>TIẾN ĐỘ HỌC TẬP</Text>
                  <Text style={[styles.progressTitle, { color: colors.text }]}>
                    {progress.complete
                      ? 'Bạn đã hoàn thành toàn bộ khóa học!'
                      : `${progress.completed_count} / ${progress.required_count} nội dung bắt buộc`}
                  </Text>
                </View>
                <Text style={[styles.progressPercentText, { color: colors.text }]}>
                  {Math.round(
                    (progress.completed_count / Math.max(1, progress.required_count)) * 100
                  )}
                  %
                </Text>
              </View>

              {/* Progress Bar Track */}
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(
                        100,
                        Math.round(
                          (progress.completed_count / Math.max(1, progress.required_count)) * 100
                        )
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressHint, { color: colors.textMuted }]}>
                Cần xem ít nhất 90% mỗi bài giảng bắt buộc và đạt điểm tối thiểu các bài kiểm tra.
              </Text>
            </View>
          )}

          {/* ACTIVE VIDEO PLAYER & LEARNING TABS */}
          {playback && (
            <View
              onLayout={e => {
                playerPositionRef.current = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.activeLessonHeader}>
                <Text style={styles.activeLessonEyebrow}>ĐANG PHÁT</Text>
                <Text style={[styles.activeLessonTitle, { color: colors.text }]}>
                  {selectedLesson?.title || 'Bài học video'}
                </Text>
              </View>

              <NativeLesson
                key={playback.media_version}
                playback={playback}
                onSeek={() => {
                  scrollRef.current?.scrollTo({
                    y: playerPositionRef.current,
                    animated: true,
                  });
                }}
              />
            </View>
          )}

          {/* CHAPTERS & LESSONS ACCORDION */}
          <View style={styles.curriculumSection}>
            <Text style={[styles.curriculumSectionTitle, { color: colors.text }]}>Danh mục chương và bài học</Text>
            <Text style={[styles.curriculumSectionSubtitle, { color: colors.textMuted }]}>
              Nhấn vào mũi tên để mở rộng hoặc thu gọn danh sách bài học của từng chương.
            </Text>

            {modules.length === 0 ? (
              <View style={[styles.emptyCurriculumBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyCurriculumText, { color: colors.textMuted }]}>
                  Khóa học chưa có bài giảng nào được thêm vào.
                </Text>
              </View>
            ) : (
              modules.map((mod, modIdx) => {
                const modLessons = lessons.filter(l => l.module_id === mod.id);
                const isCollapsed = Boolean(collapsedChapters[mod.id]);

                return (
                  <View key={mod.id} style={[styles.chapterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {/* Chapter Header Accordion Toggle */}
                    <TouchableOpacity
                      style={styles.chapterHeader}
                      activeOpacity={0.7}
                      onPress={() => toggleChapterCollapse(mod.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.chapterIndex}>Chương {modIdx + 1}</Text>
                        <Text style={[styles.chapterTitle, { color: colors.text }]}>{mod.title}</Text>
                        <Text style={[styles.chapterMeta, { color: colors.textMuted }]}>
                          {modLessons.length} bài học
                        </Text>
                      </View>
                      <View style={[styles.accordionIconCircle, { backgroundColor: colors.cardElevated }]}>
                        <Text style={[styles.accordionIconText, { color: colors.text }]}>
                          {isCollapsed ? '▼' : '▲'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Lessons list inside chapter */}
                    {!isCollapsed && (
                      <View style={[styles.chapterLessonsList, { backgroundColor: colors.cardElevated, borderTopColor: colors.border }]}>
                        {modLessons.length === 0 ? (
                          <Text style={[styles.emptyLessonsText, { color: colors.textMuted }]}>
                            Chưa có bài học trong chương này.
                          </Text>
                        ) : (
                          modLessons.map(les => {
                            const isSelected = selectedLesson?.id === les.id;
                            const lesProgress = progress?.lessons.find(
                              p => p.lesson_id === les.id
                            );
                            const watchedPercent = Math.round(
                              (lesProgress?.watched_ratio ?? 0) * 100
                            );
                            const isCompleted = lesProgress?.complete;

                            return (
                              <TouchableOpacity
                                key={les.id}
                                style={[
                                  styles.lessonRow,
                                  { borderBottomColor: colors.border },
                                  isSelected && { backgroundColor: darkMode ? '#1e3a34' : '#ecfdf5', borderLeftColor: colors.primary, borderLeftWidth: 4 },
                                ]}
                                onPress={() => handleSelectLesson(les)}
                              >
                                <View style={[styles.lessonRowIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                  <Text style={styles.lessonRowIconText}>
                                    {isCompleted ? '✓' : '▶'}
                                  </Text>
                                </View>

                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={[
                                      styles.lessonRowTitle,
                                      { color: isSelected ? (darkMode ? '#34d399' : '#065f46') : colors.text },
                                      isSelected && styles.lessonRowTitleSelected,
                                    ]}
                                  >
                                    {les.title}
                                  </Text>
                                  <Text style={[styles.lessonRowMeta, { color: colors.textMuted }]}>
                                    {les.duration_sec
                                      ? `${Math.floor(les.duration_sec / 60)} phút ${
                                          les.duration_sec % 60
                                        } giây`
                                      : 'Đang cập nhật thời lượng'}
                                    {les.media_status === 'READY'
                                      ? ' · Sẵn sàng phát'
                                      : ' · Đang xử lý'}
                                    {` · ${watchedPercent}% đã xem`}
                                  </Text>
                                </View>

                                {isCompleted && (
                                  <View style={styles.completedPill}>
                                    <Text style={styles.completedPillText}>Đạt</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>

          {/* QUIZZES SECTION */}
          <View style={styles.quizzesSection}>
            <Text style={[styles.curriculumSectionTitle, { color: colors.text }]}>Bài kiểm tra đánh giá năng lực</Text>
            {quizzes.length === 0 ? (
              <View style={[styles.emptyCurriculumBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyCurriculumText, { color: colors.textMuted }]}>
                  Khóa học hiện chưa có bài kiểm tra trắc nghiệm hoặc tự luận nào.
                </Text>
              </View>
            ) : (
              quizzes.map(quiz => (
                <NativeQuiz
                  key={quiz.id}
                  quiz={quiz}
                  isOwner={isOwner}
                  onResult={() => void loadCourseData()}
                />
              ))
            )}
          </View>

          {/* REVIEWS & COMPLAINTS SECTION */}
          {course && (
            <NativeReviewsAndComplaints
              courseId={course.id}
              isEnrolled={canRead || isOwner}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
    backgroundColor: '#f8fafc',
  },
  topNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 6,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  likeHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  likeHeart: {
    fontSize: 16,
    color: '#94a3b8',
  },
  likeHeartActive: {
    color: '#ef4444',
  },
  likeCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  lockedAlertBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  lockedAlertTitle: {
    color: '#b91c1c',
    fontSize: 15,
    fontWeight: '700',
  },
  lockedAlertReason: {
    color: '#991b1b',
    fontSize: 13,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  heroThumbnail: {
    width: '100%',
    height: 180,
  },
  heroBody: {
    padding: 18,
    gap: 10,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgeCategory: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeCategoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  badgeAccessMode: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeAccessModeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065f46',
  },
  badgeStatus: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 26,
  },
  heroDescription: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
  heroMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  instructorEditBarBtn: {
    marginTop: 10,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  instructorEditBarBtnText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '700',
  },
  metaInstructor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  metaInstructorIcon: {
    fontSize: 14,
  },
  metaInstructorName: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  metaRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaRatingStar: {
    color: '#eab308',
    fontSize: 14,
  },
  metaRatingScore: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  metaReviewCount: {
    fontSize: 11,
    color: '#94a3b8',
  },
  errorAlert: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  },
  errorAlertText: {
    color: '#991b1b',
    fontSize: 13,
  },
  enrollCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    gap: 12,
  },
  enrollHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  enrollSubtext: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
  },
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  progressEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#21634f',
    letterSpacing: 1,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  progressPercentText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#21634f',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#21634f',
    borderRadius: 4,
  },
  progressHint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  activeLessonHeader: {
    paddingVertical: 8,
    gap: 2,
  },
  activeLessonEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#21634f',
    letterSpacing: 1,
  },
  activeLessonTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  curriculumSection: {
    gap: 12,
  },
  curriculumSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  curriculumSectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: -8,
  },
  emptyCurriculumBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyCurriculumText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  chapterCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  chapterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#ffffff',
  },
  chapterIndex: {
    fontSize: 11,
    fontWeight: '700',
    color: '#21634f',
    letterSpacing: 0.5,
  },
  chapterTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 1,
  },
  chapterMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  accordionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionIconText: {
    fontSize: 12,
    color: '#334155',
  },
  chapterLessonsList: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
  },
  emptyLessonsText: {
    padding: 14,
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  lessonRowSelected: {
    backgroundColor: '#ecfdf5',
    borderLeftWidth: 4,
    borderLeftColor: '#21634f',
  },
  lessonRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonRowIconText: {
    fontSize: 11,
    color: '#21634f',
  },
  lessonRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  lessonRowTitleSelected: {
    color: '#065f46',
    fontWeight: '700',
  },
  lessonRowMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  completedPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  completedPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065f46',
  },
  quizzesSection: {
    gap: 14,
  },
  primaryButton: {
    backgroundColor: '#21634f',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
