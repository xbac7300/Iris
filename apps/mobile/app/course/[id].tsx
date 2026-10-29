import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { components } from '@lms/api-client';
import { getActiveRoleMode, getCurrentApiUrl, session } from '../../src/session';
import { useTheme } from '../../src/theme';
import {
  NativeLesson,
  NativeQuiz,
  NativeReviewsAndComplaints,
} from '../../src/learning';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const smoothAnimate = () => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
};

type Course = components['schemas']['CourseDto'] & {
  is_locked?: boolean;
  locked_reason?: string | null;
  scheduled_until?: string | null;
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
  const curriculumPositionRef = useRef<number>(0);

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);

  // Active chapter index & Quick-jump Outline Modal
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showCourseDetails, setShowCourseDetails] = useState(false);
  const [collapsedCurriculum, setCollapsedCurriculum] = useState(false);

  const [canRead, setCanRead] = useState(false);
  const [message, setMessage] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const isOwner = Boolean(session?.user && course && session.user.id === course.owner_id && getActiveRoleMode() === 'INSTRUCTOR');
  const isAdmin = Boolean(session?.user?.roles?.includes('ADMIN'));
  const isCourseLockedForUser = Boolean(course?.is_locked && !isAdmin);

  const glassBackdrop = darkMode ? 'rgba(2, 6, 23, 0.92)' : 'rgba(15, 23, 42, 0.86)';
  const glassCardBg = darkMode ? '#0f172a' : '#ffffff';
  const glassCardBorder = darkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(203, 213, 225, 0.8)';
  const alertBg = darkMode ? 'rgba(127, 29, 29, 0.78)' : 'rgba(254, 242, 242, 0.94)';
  const alertBorder = darkMode ? 'rgba(248, 113, 113, 0.45)' : '#fca5a5';
  const alertText = darkMode ? '#fecaca' : '#991b1b';

  // Listen for forced session clear (e.g. account locked by Admin while viewing a course)
  useEffect(() => {
    const unsubscribe = session.onClear(() => {
      router.replace('/');
    });
    return unsubscribe;
  }, [router]);

  const loadCourseData = useCallback(async () => {
    if (!session || !id) return;
    try {
      // 1. Get Course details
      const c = await session.api.GET('/api/v1/courses/{id}', {
        params: { path: { id } },
      });
      let hasReadAccess = false;
      if (c.data) {
        const fetchedCourse = c.data as Course;
        setCourse(fetchedCourse);
        // If course is locked and user is not ADMIN, immediately stop playback and clear curriculum
        if (fetchedCourse.is_locked && !session.user?.roles?.includes('ADMIN')) {
          setCanRead(false);
          setModules([]);
          setLessons([]);
          setQuizzes([]);
          setSelectedLesson(null);
          setPlayback(null);
          return;
        }
        const isInstructorMode = getActiveRoleMode() === 'INSTRUCTOR';
        const userIsOwner = Boolean(session.user && fetchedCourse.owner_id === session.user.id && isInstructorMode);
        const userIsAdmin = Boolean(session.user?.roles?.includes('ADMIN') && getActiveRoleMode() === 'ADMIN');
        const userIsEnrolled = Boolean(fetchedCourse.user_enrolled);
        hasReadAccess = Boolean(userIsOwner || userIsAdmin || userIsEnrolled);
        setCanRead(hasReadAccess);
      }

      // 2. Get Modules
      const m = await session.api.GET('/api/v1/courses/{id}/modules', {
        params: { path: { id }, query: { limit: 100 } },
      });
      if (m.data) setModules(m.data);

      // 3. Get Lessons & Quizzes (only if user has enrolled or has permission)
      if (hasReadAccess) {
        const l = await session.api.GET('/api/v1/courses/{id}/lessons', {
          params: { path: { id }, query: { limit: 100 } },
        });
        if (l.data) {
          setLessons(l.data);
        } else {
          setLessons([]);
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
      } else {
        setLessons([]);
        setQuizzes([]);
        setSelectedLesson(null);
        setPlayback(null);
      }
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

  // When lessons load, auto-select first READY lesson if none selected and user has access
  useEffect(() => {
    if (!isCourseLockedForUser && (canRead || isOwner) && lessons.length > 0 && !selectedLesson && !playback) {
      const readyLesson = lessons.find(l => l.media_status === 'READY');
      if (readyLesson) {
        void handleSelectLesson(readyLesson);
      } else {
        setSelectedLesson(lessons[0]);
      }
    }
  }, [lessons, canRead, isOwner, selectedLesson, playback, isCourseLockedForUser]);

  async function handleSelectLesson(lesson: Lesson) {
    if (!session || !id || isCourseLockedForUser) return;
    smoothAnimate();
    setSelectedLesson(lesson);
    const chIdx = modules.findIndex(m => m.id === lesson.module_id);
    if (chIdx >= 0) {
      setActiveChapterIndex(chIdx);
    }
    setMessage('');
    if (lesson.media_status !== 'READY') {
      setPlayback(null);
      setMessage('Video bài giảng này đang được xử lý hoặc chưa tải lên.');
      return;
    }
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
      const { data } = await session.api.POST('/api/v1/courses/{id}/like', {
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

  // Ordered flat list of lessons following chapter order for Previous/Next navigation
  const orderedLessons = modules.flatMap((mod, modIdx) =>
    lessons
      .filter(l => l.module_id === mod.id)
      .map((l, lesIdx) => ({
        lesson: l,
        chapterIndex: modIdx,
        chapterTitle: mod.title,
        lessonIndex: lesIdx,
        code: `${modIdx + 1}.${lesIdx + 1}`,
      }))
  );
  const currentLessonEntryIdx = selectedLesson
    ? orderedLessons.findIndex(item => item.lesson.id === selectedLesson.id)
    : -1;
  const currentLessonEntry =
    currentLessonEntryIdx >= 0 ? orderedLessons[currentLessonEntryIdx] : null;
  const prevLessonEntry =
    currentLessonEntryIdx > 0 ? orderedLessons[currentLessonEntryIdx - 1] : null;
  const nextLessonEntry =
    currentLessonEntryIdx >= 0 && currentLessonEntryIdx < orderedLessons.length - 1
      ? orderedLessons[currentLessonEntryIdx + 1]
      : null;

  const safeChapterIndex =
    modules.length > 0 ? Math.min(activeChapterIndex, modules.length - 1) : 0;
  const activeChapter = modules[safeChapterIndex] ?? null;
  const activeChapterLessons = activeChapter
    ? lessons.filter(l => l.module_id === activeChapter.id)
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top Header / Back Bar (Fixed Safe Top Header) */}
      <View style={[styles.topNavBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.back()}
          accessibilityLabel="Trở về danh sách"
        >
          <Text style={[styles.backButtonText, { color: colors.text }]}>‹ Trở về</Text>
        </TouchableOpacity>

        <View style={styles.topNavRightRow}>
          {course && (
            <TouchableOpacity
              style={{
                paddingVertical: 7,
                paddingHorizontal: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
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
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Chia sẻ</Text>
            </TouchableOpacity>
          )}

          {course && (
            <TouchableOpacity
              style={[styles.likeHeaderBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleToggleLike}
            >
              <Text style={[styles.likeCountText, { color: course.user_liked ? colors.primary : colors.text }]}>
                {course.user_liked ? 'Đã thích' : 'Thích'} ({course.like_count || 0})
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={[styles.container, { backgroundColor: colors.bg, flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
      >

      {/* Locked Course Banner (Adaptive Dark/Light Mode) */}
      {course?.is_locked && (
        <View
          style={[
            styles.lockedAlertBanner,
            { backgroundColor: alertBg, borderColor: alertBorder },
          ]}
        >
          <Text style={[styles.lockedAlertTitle, { color: alertText }]}>
            Khóa học đang bị tạm khóa
          </Text>
          <Text style={[styles.lockedAlertReason, { color: alertText }]}>
            Lý do: {course.locked_reason || 'Đang chờ rà soát từ ban quản trị'}
          </Text>
          {course.scheduled_until ? (
            <Text style={[styles.lockedAlertReason, { color: alertText, fontWeight: '700' }]}>
              Thời gian mở khóa dự kiến: {new Date(course.scheduled_until).toLocaleString('vi-VN')}
            </Text>
          ) : null}
        </View>
      )}

      {/* Course Hero Card (ONLY shown when user is NOT enrolled) */}
      {!canRead && !isOwner && course && (
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {course.thumbnail_url ? (
            <Image
              source={{ uri: course.thumbnail_url }}
              style={styles.heroThumbnail}
              resizeMode="cover"
            />
          ) : null}

          <View style={styles.heroBody}>
            <View style={styles.tagsRow}>
              <View
                style={[
                  styles.badgeCategory,
                  { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.badgeCategoryText, { color: colors.text }]}>
                  {course.tag || 'CNTT & Phần mềm'}
                </Text>
              </View>

              <View
                style={[
                  styles.badgeAccessMode,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <Text style={[styles.badgeAccessModeText, { color: colors.primary }]}>
                  {course.access_mode === 'RESTRICTED'
                    ? 'Chỉ định'
                    : course.access_mode === 'LINK'
                    ? 'Chia sẻ link'
                    : 'Công khai'}
                </Text>
              </View>

              {course.status && (
                <View
                  style={[
                    styles.badgeStatus,
                    {
                      backgroundColor: darkMode ? 'rgba(59, 130, 246, 0.2)' : '#eff6ff',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeStatusText,
                      { color: darkMode ? '#93c5fd' : '#1d4ed8' },
                    ]}
                  >
                    {course.status === 'PUBLISHED'
                      ? 'Đã xuất bản'
                      : course.status === 'ARCHIVED'
                      ? 'Lưu trữ'
                      : 'Bản nháp'}
                  </Text>
                </View>
              )}
            </View>

            <Text style={[styles.heroTitle, { color: colors.text }]}>{course.title ?? 'Đang tải khóa học…'}</Text>

            {course.description ? (
              <Text style={[styles.heroDescription, { color: colors.textMuted }]}>{course.description}</Text>
            ) : null}

            {/* Rating & Instructor Info */}
            <View style={[styles.heroMetaRow, { borderTopColor: colors.border }]}>
              <View style={styles.metaInstructor}>
                <Text style={[styles.metaInstructorName, { color: colors.textMuted }]}>
                  Giảng viên: {course.instructor_name || 'Giảng viên LMS'}
                </Text>
              </View>

              <View style={styles.metaRating}>
                {course.avg_rating && Number(course.avg_rating) > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: '#f59e0b', fontSize: 13, letterSpacing: 1 }}>
                      {'★'.repeat(Math.round(Number(course.avg_rating)))}
                      <Text style={{ color: colors.border }}>
                        {'★'.repeat(5 - Math.min(5, Math.round(Number(course.avg_rating))))}
                      </Text>
                    </Text>
                    <Text style={[styles.metaRatingScore, { color: colors.text }]}>
                      {Number(course.avg_rating).toFixed(1)}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.metaRatingScore, { color: colors.textMuted }]}>Chưa có đánh giá</Text>
                )}
                {course.review_count && Number(course.review_count) > 0 ? (
                  <Text style={[styles.metaReviewCount, { color: colors.textMuted }]}>({course.review_count})</Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      )}

      {message ? (
        <View style={[styles.errorAlert, { backgroundColor: alertBg, borderColor: alertBorder }]}>
          <Text style={[styles.errorAlertText, { color: alertText }]}>{message}</Text>
        </View>
      ) : null}

      {/* IF COURSE IS LOCKED: BLOCK PLAYBACK, LESSONS, AND QUIZZES */}
      {isCourseLockedForUser ? (
        <View style={[styles.enrollCard, { backgroundColor: colors.card, borderColor: alertBorder }]}>
          <Text style={[styles.enrollHeading, { color: alertText }]}>
            Khóa học hiện đang bị tạm khóa
          </Text>
          <Text style={[styles.enrollSubtext, { color: colors.textSecondary }]}>
            Mọi hoạt động xem bài giảng video, hỏi đáp AI và làm bài kiểm tra trong khóa học này đã bị tạm dừng bởi Quản trị viên.
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: alertText, textAlign: 'center' }}>
            Lý do: {course?.locked_reason || 'Vi phạm quy định hoặc đang rà soát nội dung'}
            {course?.scheduled_until
              ? `\nMở khóa tự động lúc: ${new Date(course.scheduled_until).toLocaleString('vi-VN')}`
              : '\nThời hạn: Cho đến khi Quản trị viên gỡ khóa'}
          </Text>
        </View>
      ) : !canRead && !isOwner ? (
        /* NOT ENROLLED BANNER */
        <View style={[styles.enrollCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.enrollHeading, { color: colors.text }]}>Bắt đầu lộ trình học tập ngay</Text>
          <Text style={[styles.enrollSubtext, { color: colors.textMuted }]}>
            Đăng ký khóa học để mở toàn bộ bài giảng video, transcript đồng bộ, trợ lý AI
            và các bài kiểm tra đánh giá năng lực.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }, enrolling && styles.buttonDisabled]}
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
          {/* ACTIVE VIDEO PLAYER & LEARNING TABS */}
          {playback && (
            <View
              onLayout={e => {
                playerPositionRef.current = e.nativeEvent.layout.y;
              }}
              style={styles.playerSectionWrapper}
            >
              {/* Active Lesson Top Bar + Switcher */}
              <View style={[styles.activeLessonCardHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.activeLessonHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.activeLessonBadgeRow}>
                      <View style={[styles.playingPulseBadge, { backgroundColor: colors.primaryLight }]}>
                        <Text style={[styles.activeLessonEyebrow, { color: colors.primary }]}>
                          ĐANG PHÁT {currentLessonEntry ? `· BÀI ${currentLessonEntry.code}` : ''}
                        </Text>
                      </View>
                      {currentLessonEntry && (
                        <Text style={[styles.activeChapterNameHint, { color: colors.textMuted }]} numberOfLines={1}>
                          Chương {currentLessonEntry.chapterIndex + 1}: {currentLessonEntry.chapterTitle}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.activeLessonTitle, { color: colors.text }]}>
                      {selectedLesson?.title || 'Bài học video'}
                    </Text>
                  </View>
                </View>

                {/* Quick Previous / Select Lesson / Next Switcher Bar */}
                {orderedLessons.length > 1 && (
                  <View style={[styles.quickLessonSwitchRow, { borderTopColor: colors.border }]}>
                    <TouchableOpacity
                      style={[
                        styles.quickSwitchBtn,
                        { backgroundColor: colors.cardElevated, borderColor: colors.border },
                        !prevLessonEntry && styles.buttonDisabled,
                      ]}
                      disabled={!prevLessonEntry}
                      onPress={() => prevLessonEntry && void handleSelectLesson(prevLessonEntry.lesson)}
                    >
                      <Text style={[styles.quickSwitchBtnText, { color: colors.text }]} numberOfLines={1}>
                        ‹ {prevLessonEntry ? `Bài ${prevLessonEntry.code}` : 'Bài đầu'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.quickCenterOutlineBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                      onPress={() => setShowOutlineModal(true)}
                    >
                      <Text style={[styles.quickCenterOutlineText, { color: colors.primary }]}>
                        Danh sách bài ({currentLessonEntryIdx + 1}/{orderedLessons.length})
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.quickSwitchBtn,
                        { backgroundColor: colors.cardElevated, borderColor: colors.border },
                        !nextLessonEntry && styles.buttonDisabled,
                      ]}
                      disabled={!nextLessonEntry}
                      onPress={() => nextLessonEntry && void handleSelectLesson(nextLessonEntry.lesson)}
                    >
                      <Text style={[styles.quickSwitchBtnText, { color: colors.text }]} numberOfLines={1}>
                        {nextLessonEntry ? `Bài ${nextLessonEntry.code}` : 'Bài cuối'} ›
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
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

          {/* CHAPTERS & LESSONS STEPPER + QUICK NAVIGATION (With Collapsible Toggle) */}
          <View
            style={styles.curriculumSection}
            onLayout={e => {
              curriculumPositionRef.current = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.curriculumHeaderRow}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={[styles.curriculumSectionTitle, { color: colors.text }]}>
                  Nội dung bài học
                </Text>
                <Text style={[styles.curriculumSectionSubtitle, { color: colors.textMuted }]}>
                  {modules.length} chương · {lessons.length} bài giảng video
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                {modules.length > 0 && (
                  <TouchableOpacity
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 8,
                      backgroundColor: colors.cardElevated,
                      borderColor: colors.border,
                      borderWidth: 1,
                    }}
                    onPress={() => {
                      smoothAnimate();
                      setCollapsedCurriculum(prev => !prev);
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>
                      {collapsedCurriculum ? 'Mở rộng bài học ▼' : 'Thu gọn bài học ▲'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {!collapsedCurriculum && (
              modules.length === 0 ? (
                <View style={[styles.emptyCurriculumBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCurriculumText, { color: colors.textMuted }]}>
                    Khóa học chưa có bài giảng nào được thêm vào.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Horizontal Chapter Selector Pills */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chapterStepperScroll}
                  >
                    {modules.map((mod, idx) => {
                      const isCurrent = idx === safeChapterIndex;
                      const count = lessons.filter(l => l.module_id === mod.id).length;
                      return (
                        <TouchableOpacity
                          key={mod.id}
                          style={[
                            styles.chapterPill,
                            {
                              backgroundColor: isCurrent ? colors.primary : colors.card,
                              borderColor: isCurrent ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => {
                            smoothAnimate();
                            setActiveChapterIndex(idx);
                          }}
                        >
                          <Text
                            style={[
                              styles.chapterPillTitle,
                              { color: isCurrent ? '#ffffff' : colors.text },
                            ]}
                          >
                            Chương {idx + 1}
                          </Text>
                          <Text
                            style={[
                              styles.chapterPillCount,
                              { color: isCurrent ? 'rgba(255,255,255,0.85)' : colors.textMuted },
                            ]}
                          >
                            {count} bài
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Active Chapter Card */}
                  {activeChapter && (
                    <View style={[styles.chapterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      {/* Chapter Header with Chapter Prev/Next Controls */}
                      <View style={[styles.chapterHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <View style={styles.chapterBadgeRow}>
                            <View style={[styles.chapterNumberBadge, { backgroundColor: colors.primaryLight }]}>
                              <Text style={[styles.chapterIndex, { color: colors.primary }]}>
                                CHƯƠNG {safeChapterIndex + 1} / {modules.length}
                              </Text>
                            </View>
                            <Text style={[styles.chapterMeta, { color: colors.textMuted }]}>
                              {activeChapterLessons.length} bài học
                            </Text>
                          </View>
                          <Text style={[styles.chapterTitle, { color: colors.text }]}>
                            {activeChapter.title}
                          </Text>
                        </View>

                        <TouchableOpacity
                          style={[styles.chapterJumpBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                          onPress={() => setShowOutlineModal(true)}
                        >
                          <Text style={[styles.chapterJumpBtnText, { color: colors.primary }]}>
                            Danh sách ▾
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Lessons list inside active chapter */}
                      <View style={[styles.chapterLessonsList, { backgroundColor: colors.cardElevated }]}>
                        {activeChapterLessons.length === 0 ? (
                          <Text style={[styles.emptyLessonsText, { color: colors.textMuted }]}>
                            Chưa có bài học trong chương này.
                          </Text>
                        ) : (
                          activeChapterLessons.map((les, lesIdx) => {
                            const isSelected = selectedLesson?.id === les.id;
                            const lesProgress = progress?.lessons.find(
                              p => p.lesson_id === les.id
                            );
                            const watchedPercent = Math.round(
                              (lesProgress?.watched_ratio ?? 0) * 100
                            );
                            const isCompleted = lesProgress?.complete;
                            const lessonCode = `${safeChapterIndex + 1}.${lesIdx + 1}`;

                            return (
                              <TouchableOpacity
                                key={les.id}
                                style={[
                                  styles.lessonRow,
                                  { borderBottomColor: colors.border },
                                  isSelected && {
                                    backgroundColor: darkMode ? '#142f26' : '#ecfdf5',
                                    borderLeftColor: colors.primary,
                                    borderLeftWidth: 4,
                                  },
                                ]}
                                onPress={() => void handleSelectLesson(les)}
                              >
                                <View
                                  style={[
                                    styles.lessonRowIcon,
                                    {
                                      backgroundColor: isCompleted
                                        ? colors.primary
                                        : isSelected
                                        ? colors.primaryLight
                                        : colors.card,
                                      borderColor: isCompleted || isSelected ? colors.primary : colors.border,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.lessonRowIconText,
                                      { color: isCompleted ? '#ffffff' : colors.primary },
                                    ]}
                                  >
                                    {isCompleted ? '✓' : isSelected ? '▶' : lessonCode}
                                  </Text>
                                </View>

                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={[
                                      styles.lessonRowTitle,
                                      {
                                        color: isSelected
                                          ? darkMode
                                            ? '#34d399'
                                            : '#065f46'
                                          : colors.text,
                                      },
                                      isSelected && styles.lessonRowTitleSelected,
                                    ]}
                                  >
                                    Bài {lessonCode}: {les.title}
                                  </Text>
                                  <Text style={[styles.lessonRowMeta, { color: colors.textMuted }]}>
                                    {les.duration_sec
                                      ? `${Math.floor(les.duration_sec / 60)}p ${les.duration_sec % 60}s`
                                      : 'Video bài giảng'}
                                    {les.media_status === 'READY'
                                      ? ' · Sẵn sàng'
                                      : ' · Đang xử lý'}
                                    {` · Đã xem ${watchedPercent}%`}
                                  </Text>
                                </View>

                                {isCompleted ? (
                                  <View style={styles.completedPill}>
                                    <Text style={styles.completedPillText}>Đạt</Text>
                                  </View>
                                ) : isSelected ? (
                                  <View style={[styles.playingMiniPill, { backgroundColor: colors.primary }]}>
                                    <Text style={styles.playingMiniPillText}>Đang mở</Text>
                                  </View>
                                ) : null}
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>

                      {/* Chapter Quizzes for active chapter */}
                      {(() => {
                        const chapterQuizzes = quizzes.filter(q => q.module_id === activeChapter.id);
                        if (chapterQuizzes.length === 0) return null;
                        return (
                          <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, paddingHorizontal: 10, gap: 10 }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                              Bài kiểm tra chương ({chapterQuizzes.length})
                            </Text>
                            {chapterQuizzes.map(quiz => (
                              <NativeQuiz
                                key={quiz.id}
                                quiz={quiz}
                                isOwner={isOwner}
                                onResult={() => void loadCourseData()}
                              />
                            ))}
                          </View>
                        );
                      })()}

                      {/* Chapter Footer Prev / Next Switcher */}
                      {modules.length > 1 && (
                        <View style={[styles.chapterFooterNav, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                          <TouchableOpacity
                            style={[
                              styles.chapterSwitchBtn,
                              { backgroundColor: colors.cardElevated, borderColor: colors.border },
                              safeChapterIndex === 0 && styles.buttonDisabled,
                            ]}
                            disabled={safeChapterIndex === 0}
                            onPress={() => setActiveChapterIndex(Math.max(0, safeChapterIndex - 1))}
                          >
                            <Text style={[styles.chapterSwitchBtnText, { color: colors.text }]}>
                              ‹ Chương trước
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.chapterFooterCenterBtn}
                            onPress={() => setShowOutlineModal(true)}
                          >
                            <Text style={[styles.chapterFooterCenterText, { color: colors.textMuted }]}>
                              Chương {safeChapterIndex + 1} / {modules.length}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.chapterSwitchBtn,
                              { backgroundColor: colors.primary, borderColor: colors.primary },
                              safeChapterIndex >= modules.length - 1 && styles.buttonDisabled,
                            ]}
                            disabled={safeChapterIndex >= modules.length - 1}
                            onPress={() =>
                              setActiveChapterIndex(Math.min(modules.length - 1, safeChapterIndex + 1))
                            }
                          >
                            <Text style={[styles.chapterSwitchBtnText, { color: '#ffffff' }]}>
                              Chương sau ›
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )
            )}
          </View>

          {/* CHI TIẾT KHÓA HỌC: ACCORDION AT BOTTOM */}
          {course && (
            <View style={[styles.detailsSectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.detailsSectionHeader}
                onPress={() => {
                  smoothAnimate();
                  setShowCourseDetails(prev => !prev);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailsSectionTitle, { color: colors.text }]}>
                    Chi tiết khóa học
                  </Text>
                  <Text style={[styles.detailsSectionSubtitle, { color: colors.textMuted }]}>
                    {showCourseDetails ? 'Chạm để thu gọn' : 'Thông tin khóa học, giảng viên và đánh giá khiếu nại'}
                  </Text>
                </View>
                <View style={[styles.detailsSectionToggleBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                  <Text style={[styles.detailsSectionToggleText, { color: colors.primary }]}>
                    {showCourseDetails ? 'Thu gọn ▲' : 'Mở rộng ▼'}
                  </Text>
                </View>
              </TouchableOpacity>

              {showCourseDetails && (
                <View style={[styles.detailsSectionBody, { borderTopColor: colors.border }]}>
                  {/* Thumbnail */}
                  {course.thumbnail_url ? (
                    <Image
                      source={{ uri: course.thumbnail_url }}
                      style={styles.heroThumbnail}
                      resizeMode="cover"
                    />
                  ) : null}

                  {/* Tags Row */}
                  <View style={styles.tagsRow}>
                    <View
                      style={[
                        styles.badgeCategory,
                        { backgroundColor: colors.cardElevated, borderColor: colors.border, borderWidth: 1 },
                      ]}
                    >
                      <Text style={[styles.badgeCategoryText, { color: colors.text }]}>
                        {course.tag || 'CNTT & Phần mềm'}
                      </Text>
                    </View>

                    <View style={[styles.badgeAccessMode, { backgroundColor: colors.primaryLight }]}>
                      <Text style={[styles.badgeAccessModeText, { color: colors.primary }]}>
                        {course.access_mode === 'RESTRICTED'
                          ? 'Chỉ định'
                          : course.access_mode === 'LINK'
                          ? 'Chia sẻ link'
                          : 'Công khai'}
                      </Text>
                    </View>

                    {course.status && (
                      <View
                        style={[
                          styles.badgeStatus,
                          {
                            backgroundColor: darkMode ? 'rgba(59, 130, 246, 0.2)' : '#eff6ff',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeStatusText,
                            { color: darkMode ? '#93c5fd' : '#1d4ed8' },
                          ]}
                        >
                          {course.status === 'PUBLISHED'
                            ? 'Đã xuất bản'
                            : course.status === 'ARCHIVED'
                            ? 'Lưu trữ'
                            : 'Bản nháp'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Title & Description */}
                  <Text style={[styles.heroTitle, { color: colors.text }]}>{course.title}</Text>
                  {course.description ? (
                    <Text style={[styles.heroDescription, { color: colors.textMuted }]}>{course.description}</Text>
                  ) : null}

                  {/* Instructor & Rating */}
                  <View style={[styles.heroMetaRow, { borderTopColor: colors.border }]}>
                    <View style={styles.metaInstructor}>
                      <Text style={[styles.metaInstructorName, { color: colors.textMuted }]}>
                        Giảng viên: {course.instructor_name || 'Giảng viên LMS'}
                      </Text>
                    </View>

                    <View style={styles.metaRating}>
                      {course.avg_rating && Number(course.avg_rating) > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={{ color: '#f59e0b', fontSize: 13, letterSpacing: 1 }}>
                            {'★'.repeat(Math.round(Number(course.avg_rating)))}
                            <Text style={{ color: colors.border }}>
                              {'★'.repeat(5 - Math.min(5, Math.round(Number(course.avg_rating))))}
                            </Text>
                          </Text>
                          <Text style={[styles.metaRatingScore, { color: colors.text }]}>
                            {Number(course.avg_rating).toFixed(1)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.metaRatingScore, { color: colors.textMuted }]}>Chưa có đánh giá</Text>
                      )}
                      {course.review_count && Number(course.review_count) > 0 ? (
                        <Text style={[styles.metaReviewCount, { color: colors.textMuted }]}>({course.review_count})</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Instructor Edit Bar: ONLY visible when user is in INSTRUCTOR mode */}
                  {isOwner && getActiveRoleMode() === 'INSTRUCTOR' && !course.is_locked && (
                    <TouchableOpacity
                      style={[styles.instructorEditBarBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                      onPress={() =>
                        router.push({
                          pathname: '/course/edit/[id]',
                          params: { id: course.id },
                        })
                      }
                    >
                      <Text style={[styles.instructorEditBarBtnText, { color: colors.primary }]}>
                        Quản lý & Chỉnh sửa bài giảng khóa học
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Progress info */}
                  {progress && !isOwner && (
                    <View style={[styles.progressCard, { backgroundColor: colors.cardElevated, borderColor: colors.border, padding: 12, borderRadius: 10, marginTop: 4 }]}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
                        Tiến độ học tập: {progress.completed_count}/{progress.required_count} ({Math.round(
                          (progress.completed_count / Math.max(1, progress.required_count)) * 100
                        )}%)
                      </Text>
                      <View style={styles.progressBarTrack}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.min(
                                100,
                                Math.round((progress.completed_count / Math.max(1, progress.required_count)) * 100)
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  )}

                  {/* Reviews & Complaints */}
                  <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
                    <Text style={[styles.curriculumSectionTitle, { color: colors.text, marginBottom: 8 }]}>
                      Đánh giá & Khiếu nại
                    </Text>
                    <NativeReviewsAndComplaints
                      courseId={course.id}
                      isEnrolled={canRead || isOwner}
                      isOwner={Boolean(isOwner)}
                    />
                  </View>
                </View>
              )}
            </View>
          )}

          {/* QUICK-JUMP COURSE OUTLINE MODAL (Adaptive Blur Dark/Light Mode) */}
          <Modal
            visible={showOutlineModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowOutlineModal(false)}
          >
            <View style={[styles.outlineModalOverlay, { backgroundColor: glassBackdrop }]}>
              <View style={[styles.outlineModalCard, { backgroundColor: glassCardBg, borderColor: glassCardBorder }]}>
                <View style={[styles.outlineModalHeader, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.outlineModalTitle, { color: colors.text }]}>
                      Mục lục khóa học
                    </Text>
                    <Text style={[styles.outlineModalSubtitle, { color: colors.textMuted }]}>
                      Chạm vào chương hoặc bài học để chuyển đến ngay lập tức ({modules.length} chương · {lessons.length} bài)
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.outlineCloseBtn, { backgroundColor: colors.cardElevated }]}
                    onPress={() => setShowOutlineModal(false)}
                  >
                    <Text style={[styles.outlineCloseBtnText, { color: colors.text }]}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.outlineModalScroll}
                  contentContainerStyle={styles.outlineModalScrollContent}
                  showsVerticalScrollIndicator
                >
                  {modules.map((mod, modIdx) => {
                    const modLessons = lessons.filter(l => l.module_id === mod.id);
                    const isActiveCh = modIdx === safeChapterIndex;

                    return (
                      <View
                        key={mod.id}
                        style={[
                          styles.outlineChapterBlock,
                          {
                            backgroundColor: colors.cardElevated,
                            borderColor: isActiveCh ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.outlineChapterHeader}
                          onPress={() => {
                            setActiveChapterIndex(modIdx);
                            setShowOutlineModal(false);
                            setTimeout(() => {
                              scrollRef.current?.scrollTo({
                                y: curriculumPositionRef.current,
                                animated: true,
                              });
                            }, 120);
                          }}
                        >
                          <View style={[styles.outlineChapterBadge, { backgroundColor: isActiveCh ? colors.primary : colors.card }]}>
                            <Text style={[styles.outlineChapterBadgeText, { color: isActiveCh ? '#ffffff' : colors.primary }]}>
                              Chương {modIdx + 1}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.outlineChapterTitle, { color: colors.text }]}>
                              {mod.title}
                            </Text>
                            <Text style={[styles.outlineChapterCount, { color: colors.textMuted }]}>
                              {modLessons.length} bài giảng · Chạm để xem chương
                            </Text>
                          </View>
                          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>Mở ›</Text>
                        </TouchableOpacity>

                        {modLessons.length > 0 && (
                          <View style={[styles.outlineLessonsList, { borderTopColor: colors.border }]}>
                            {modLessons.map((les, lesIdx) => {
                              const isPlaying = selectedLesson?.id === les.id;
                              const lesProg = progress?.lessons.find(p => p.lesson_id === les.id);
                              const isDone = Boolean(lesProg?.complete);
                              const pct = Math.round((lesProg?.watched_ratio ?? 0) * 100);
                              const code = `${modIdx + 1}.${lesIdx + 1}`;

                              return (
                                <TouchableOpacity
                                  key={les.id}
                                  style={[
                                    styles.outlineLessonItem,
                                    {
                                      backgroundColor: isPlaying
                                        ? darkMode
                                          ? '#142f26'
                                          : '#ecfdf5'
                                        : colors.card,
                                      borderColor: isPlaying ? colors.primary : colors.border,
                                    },
                                  ]}
                                  onPress={() => {
                                    setActiveChapterIndex(modIdx);
                                    setShowOutlineModal(false);
                                    void handleSelectLesson(les);
                                  }}
                                >
                                  <View
                                    style={[
                                      styles.outlineLessonCodeCircle,
                                      {
                                        backgroundColor: isDone
                                          ? colors.primary
                                          : isPlaying
                                          ? colors.primaryLight
                                          : colors.cardElevated,
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.outlineLessonCodeText,
                                        { color: isDone ? '#ffffff' : colors.primary },
                                      ]}
                                    >
                                      {isDone ? '✓' : code}
                                    </Text>
                                  </View>

                                  <View style={{ flex: 1 }}>
                                    <Text
                                      style={[
                                        styles.outlineLessonTitle,
                                        {
                                          color: isPlaying
                                            ? darkMode
                                              ? '#34d399'
                                              : '#065f46'
                                            : colors.text,
                                        },
                                      ]}
                                      numberOfLines={2}
                                    >
                                      Bài {code}: {les.title}
                                    </Text>
                                    <Text style={[styles.outlineLessonMeta, { color: colors.textMuted }]}>
                                      {les.media_status === 'READY' ? '▶ Phát ngay' : '⏳ Đang xử lý'}
                                      {` · Đã xem ${pct}%`}
                                    </Text>
                                  </View>

                                  {isPlaying && (
                                    <View style={[styles.playingMiniPill, { backgroundColor: colors.primary }]}>
                                      <Text style={styles.playingMiniPillText}>Đang phát</Text>
                                    </View>
                                  )}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  topNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 42),
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    zIndex: 10,
    gap: 8,
  },
  topNavRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  outlineTopBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  outlineTopBtnText: {
    fontSize: 13,
    fontWeight: '700',
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
  playerSectionWrapper: {
    gap: 10,
  },
  activeLessonCardHeader: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  activeLessonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  activeLessonBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  playingPulseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeChapterNameHint: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  outlineActionPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  outlineActionPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  quickLessonSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  quickSwitchBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  quickSwitchBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  quickCenterOutlineBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  quickCenterOutlineText: {
    fontSize: 12,
    fontWeight: '700',
  },
  activeLessonHeader: {
    paddingVertical: 8,
    gap: 2,
  },
  activeLessonEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#21634f',
    letterSpacing: 0.6,
  },
  activeLessonTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  curriculumSection: {
    gap: 12,
  },
  curriculumHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  curriculumSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  curriculumSectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  openOutlineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openOutlineBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  chapterStepperScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  chapterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chapterPillTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  chapterPillCount: {
    fontSize: 11,
    fontWeight: '600',
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
    borderBottomWidth: 1,
    gap: 10,
  },
  chapterBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  chapterNumberBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  chapterIndex: {
    fontSize: 10,
    fontWeight: '800',
    color: '#21634f',
    letterSpacing: 0.5,
  },
  chapterTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  chapterMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  chapterJumpBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  chapterJumpBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chapterFooterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  chapterSwitchBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  chapterSwitchBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chapterFooterCenterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chapterFooterCenterText: {
    fontSize: 12,
    fontWeight: '700',
  },
  playingMiniPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  playingMiniPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  outlineModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'flex-end',
  },
  outlineModalCard: {
    maxHeight: '84%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  outlineModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    gap: 12,
  },
  outlineModalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  outlineModalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  outlineCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineCloseBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  outlineModalScroll: {
    paddingHorizontal: 16,
  },
  outlineModalScrollContent: {
    paddingVertical: 14,
    gap: 12,
    paddingBottom: 30,
  },
  outlineChapterBlock: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  outlineChapterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  outlineChapterBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  outlineChapterBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  outlineChapterTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  outlineChapterCount: {
    fontSize: 11,
    marginTop: 1,
  },
  outlineLessonsList: {
    borderTopWidth: 1,
    padding: 8,
    gap: 6,
  },
  outlineLessonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  outlineLessonCodeCircle: {
    minWidth: 32,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLessonCodeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  outlineLessonTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  outlineLessonMeta: {
    fontSize: 11,
    marginTop: 2,
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
    minWidth: 32,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonRowIconText: {
    fontSize: 11,
    fontWeight: '800',
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
  detailsSectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 20,
  },
  detailsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  detailsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  detailsSectionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  detailsSectionToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  detailsSectionToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailsSectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 12,
  },
});
