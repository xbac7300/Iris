import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { useRouter } from 'expo-router';
import { COURSE_TAGS, type components } from '@lms/api-client';
import {
  getCurrentApiUrl,
  initApiUrl,
  session,
  setApiUrl,
} from '../src/session';
import { useTheme, type ThemeColors } from '../src/theme';

type Course = components['schemas']['CourseDto'] & {
  is_locked?: boolean;
  locked_reason?: string | null;
  access_mode?: string;
  allowed_emails?: string[];
  avg_rating?: number;
  review_count?: number;
  like_count?: number;
  user_liked?: boolean;
  user_enrolled?: boolean;
  thumbnail_url?: string | null;
  tag?: string;
  instructor_name?: string | null;
};

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
  course_id?: string;
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(session?.user ?? null);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const { darkMode, toggleDarkMode, setDarkMode, colors } = useTheme();

  // Scroll and layout refs
  const mainScrollRef = useRef<ScrollView>(null);
  const adminSectionPositions = useRef<Record<string, number>>({});

  const scrollToAdminSection = (key: string) => {
    const y = adminSectionPositions.current[key];
    if (typeof y === 'number') {
      mainScrollRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: true });
    }
  };

  // Active workspace mode: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN'
  const [activeRoleMode, setActiveRoleMode] = useState<'STUDENT' | 'INSTRUCTOR' | 'ADMIN'>('STUDENT');

  // Login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register form
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerRole, setRegisterRole] = useState<'STUDENT' | 'INSTRUCTOR'>('STUDENT');

  // Status & messages
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Server settings modal
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getCurrentApiUrl());

  // Profile Menu Modal
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Notifications Modal
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  // Priority Announcement Popover in center of screen
  const [activeAnnouncement, setActiveAnnouncement] = useState<any | null>(null);
  const [announcementCountdown, setAnnouncementCountdown] = useState<number>(10);

  // Course Creator Modal (Instructor)
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseTag, setNewCourseTag] = useState('CNTT & Phần mềm');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [newCourseThumbnail, setNewCourseThumbnail] = useState('');
  const [newCourseAccessMode, setNewCourseAccessMode] = useState<'PUBLIC' | 'LINK' | 'RESTRICTED'>('PUBLIC');
  const [newCourseEmails, setNewCourseEmails] = useState('');

  // Course catalog & filtering
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'enrolled' | 'liked' | 'mine' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'rating' | 'likes' | 'reviews' | 'name'>('newest');
  const [starFilter, setStarFilter] = useState<'all' | '4.5' | '4.0' | '3.0'>('all');
  const [showSortFilterModal, setShowSortFilterModal] = useState(false);

  // Admin Panel states
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminComplaints, setAdminComplaints] = useState<any[]>([]);
  const [adminLockedCourses, setAdminLockedCourses] = useState<any[]>([]);
  const [adminBroadcasts, setAdminBroadcasts] = useState<any[]>([]);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState<'ALL' | 'INSTRUCTOR' | 'STUDENT'>('ALL');
  const [resolvingComplaint, setResolvingComplaint] = useState<any | null>(null);
  const [resolveAction, setResolveAction] = useState<'CLOSE_COURSE' | 'DISMISS'>('CLOSE_COURSE');
  const [resolveNotes, setResolveNotes] = useState('');

  // Accordion toggles for Admin sections
  const [showAdminBroadcastForm, setShowAdminBroadcastForm] = useState(true);
  const [showAdminBroadcasts, setShowAdminBroadcasts] = useState(true);
  const [showAdminLocked, setShowAdminLocked] = useState(true);
  const [showAdminComplaints, setShowAdminComplaints] = useState(true);
  const [showAdminUsers, setShowAdminUsers] = useState(true);

  // Initialize API URL & restore session
  useEffect(() => {
    void (async () => {
      const url = await initApiUrl();
      setServerUrlInput(url);
      try {
        await session.restore();
        if (session.user) {
          setUser(session.user);
          if (session.user.roles.includes('ADMIN')) {
            setActiveRoleMode('ADMIN');
          } else if (session.user.roles.includes('INSTRUCTOR')) {
            setActiveRoleMode('INSTRUCTOR');
          } else {
            setActiveRoleMode('STUDENT');
          }
        }
      } catch {
        // Không khôi phục được phiên
      }
    })();
  }, []);

  const loadCourses = useCallback(async () => {
    if (!session.user) return;
    setLoadingCourses(true);
    try {
      const { data, error } = await session.api.GET('/api/v1/courses', {
        params: { query: { limit: 100 } },
      });
      if (error) {
        setMessage(error.message);
      } else {
        setCourses((data as Course[]) ?? []);
      }
    } catch {
      setMessage('Không thể kết nối đến máy chủ API.');
    } finally {
      setLoadingCourses(false);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!session.user) return;
    setLoadingNotifs(true);
    try {
      const { data } = await session.api.GET('/api/v1/announcements/notifications' as any, {});
      if (data && Array.isArray(data)) {
        setNotifications(data as NotificationItem[]);
      }
    } catch {
      // Bỏ qua lỗi
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  // Check unread priority announcements for center pop-up
  const checkPriorityAnnouncements = useCallback(async () => {
    if (!session.user) return;
    try {
      const { data } = await session.api.GET('/api/v1/announcements/unread' as any, {});
      if (data && Array.isArray(data) && data.length > 0) {
        setActiveAnnouncement(data[0]);
        setAnnouncementCountdown(10);
      }
    } catch {
      // Bỏ qua lỗi
    }
  }, []);

  // Admin data loader
  const loadAdminData = useCallback(async () => {
    if (!session.user || !session.user.roles.includes('ADMIN')) return;
    try {
      const [u, a, c, l] = await Promise.all([
        session.api.GET('/api/v1/admin/users', { params: { query: { limit: 50, offset: 0 } } }),
        session.api.GET('/api/v1/admin/announcements'),
        (session.api.GET as any)('/api/v1/admin/complaints', {}),
        (session.api.GET as any)('/api/v1/admin/locked-courses', {}),
      ]);
      if (u.data) setAdminUsers(u.data);
      if (a.data) setAdminBroadcasts(a.data);
      if (c.data) setAdminComplaints(c.data);
      if (l.data) setAdminLockedCourses(l.data);
    } catch {
      // Bỏ qua lỗi
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadCourses();
      void loadNotifications();
      void checkPriorityAnnouncements();
      if (user.roles.includes('ADMIN')) {
        void loadAdminData();
      }
      const interval = setInterval(() => {
        void loadNotifications();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user, loadCourses, loadNotifications, checkPriorityAnnouncements, loadAdminData]);

  // Announcement countdown timer
  useEffect(() => {
    if (activeAnnouncement && announcementCountdown > 0) {
      const timer = setTimeout(() => {
        setAnnouncementCountdown(prev => {
          if (prev <= 1) {
            handleCloseAnnouncement();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [activeAnnouncement, announcementCountdown]);

  const handleCloseAnnouncement = async () => {
    if (activeAnnouncement) {
      try {
        await session.api.POST('/api/v1/announcements/{id}/read' as any, {
          params: { path: { id: activeAnnouncement.id } },
        });
      } catch {
        // Bỏ qua lỗi
      }
      setActiveAnnouncement(null);
    }
  };

  async function handleLogin() {
    setBusy(true);
    setMessage('');
    try {
      await session.login({ email: email.trim(), password });
      setUser(session.user);
      setPassword('');
      if (session.user?.roles.includes('ADMIN')) {
        setActiveRoleMode('ADMIN');
      } else if (session.user?.roles.includes('INSTRUCTOR')) {
        setActiveRoleMode('INSTRUCTOR');
      } else {
        setActiveRoleMode('STUDENT');
      }
      void loadCourses();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể kết nối đến máy chủ.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!registerName.trim() || !registerEmail.trim() || !registerPassword.trim()) {
      setMessage('Vui lòng điền đầy đủ thông tin đăng ký.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await session.register({
        display_name: registerName.trim(),
        email: registerEmail.trim(),
        password: registerPassword,
        role: registerRole,
      });
      setUser(session.user);
      setRegisterPassword('');
      setActiveRoleMode(registerRole);
      void loadCourses();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đăng ký tài khoản thất bại.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setShowProfileMenu(false);
    try {
      await session.logout();
    } catch {
      // Đã xóa phiên client
    } finally {
      setUser(null);
      setCourses([]);
      setNotifications([]);
      setPassword('');
      setActiveRoleMode('STUDENT');
      setBusy(false);
    }
  }

  async function handleSwitchRole(targetRole: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN') {
    if (!user) return;
    if (targetRole === 'ADMIN') {
      if (!user.roles.includes('ADMIN')) {
        setMessage('Tài khoản của bạn không có quyền Quản trị viên.');
        return;
      }
      setActiveRoleMode('ADMIN');
      setShowProfileMenu(false);
      void loadAdminData();
      return;
    }

    if (user.roles.includes(targetRole)) {
      setActiveRoleMode(targetRole);
      setShowProfileMenu(false);
      void loadCourses();
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await session.api.POST('/api/v1/auth/switch-role' as any, {
        body: { role: targetRole },
      });
      if (error) throw new Error(error.message);
      if (data) {
        setUser(data);
        session.user = data;
        setActiveRoleMode(targetRole);
        setShowProfileMenu(false);
        void loadCourses();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa đổi được vai trò.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterExtraRole(newRole: 'STUDENT' | 'INSTRUCTOR') {
    if (!user) return;
    setBusy(true);
    try {
      const { data, error } = await session.api.POST('/api/v1/auth/switch-role' as any, {
        body: { role: newRole },
      });
      if (error) throw new Error(error.message);
      if (data) {
        setUser(data);
        session.user = data;
        setActiveRoleMode(newRole);
        setShowProfileMenu(false);
        setMessage(`Đã đăng ký thêm vai trò ${newRole === 'INSTRUCTOR' ? 'Giảng viên' : 'Học viên'} thành công!`);
        void loadCourses();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Chưa đăng ký được vai trò mới.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLike(courseId: string) {
    if (!session.user) return;
    try {
      const { data } = await session.api.POST('/api/v1/courses/{id}/like' as any, {
        params: { path: { id: courseId } },
      });
      if (data) {
        setCourses(prev =>
          prev.map(c =>
            c.id === courseId
              ? { ...c, user_liked: data.liked, like_count: data.total_likes }
              : c
          )
        );
      }
    } catch {
      // Bỏ qua lỗi
    }
  }

  // Instructor Create Course
  async function handleCreateCourse() {
    if (!newCourseTitle.trim()) {
      setMessage('Vui lòng nhập tên khóa học.');
      return;
    }
    const parsedEmails = newCourseEmails
      .split(/[\n,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);

    if (newCourseAccessMode === 'RESTRICTED' && parsedEmails.length === 0) {
      setMessage('Vui lòng nhập ít nhất một email học viên được chỉ định.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await session.api.POST('/api/v1/courses', {
        body: {
          title: newCourseTitle.trim(),
          tag: newCourseTag,
          description: newCourseDesc.trim(),
          thumbnail_url: newCourseThumbnail.trim() || undefined,
          access_mode: newCourseAccessMode,
          allowed_emails: newCourseAccessMode === 'RESTRICTED' ? parsedEmails : [],
        } as any,
      });

      if (error || !data) throw new Error(error?.message ?? 'Lỗi khi tạo khóa học.');

      setShowCreateCourseModal(false);
      setNewCourseTitle('');
      setNewCourseDesc('');
      setNewCourseThumbnail('');
      setNewCourseEmails('');
      void loadCourses();
      // Navigate to course editor immediately
      router.push({
        pathname: '/course/edit/[id]',
        params: { id: (data as any).id },
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi tạo khóa học.');
    } finally {
      setBusy(false);
    }
  }

  // Admin Broadcast Announcement
  async function handleSendBroadcast() {
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      setMessage('Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await session.api.POST('/api/v1/admin/announcements' as any, {
        body: {
          title: broadcastTitle.trim(),
          message: broadcastMessage.trim(),
          target_type: broadcastTarget,
        },
      });
      if (error) throw new Error(error.message);
      setBroadcastTitle('');
      setBroadcastMessage('');
      setMessage('Đã phát thông báo hệ thống thành công!');
      void loadAdminData();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi phát thông báo.');
    } finally {
      setBusy(false);
    }
  }

  // Admin Unlock Course
  async function handleUnlockCourse(courseId: string, courseTitle: string) {
    Alert.alert(
      'Mở khóa khóa học',
      `Bạn có chắc chắn muốn gỡ khóa cho khóa học "${courseTitle}"?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Mở khóa ngay',
          onPress: async () => {
            try {
              const res = await session.api.POST('/api/v1/admin/courses/{id}/unlock' as any, {
                params: { path: { id: courseId } },
              });
              if (res.error) throw new Error(res.error.message);
              setMessage(`Đã mở khóa thành công cho "${courseTitle}".`);
              void loadAdminData();
              void loadCourses();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Lỗi khi mở khóa.');
            }
          },
        },
      ]
    );
  }

  // Admin Resolve Complaint
  async function handleResolveComplaint() {
    if (!resolvingComplaint) return;
    setBusy(true);
    try {
      const res = await session.api.POST('/api/v1/admin/complaints/{id}/resolve' as any, {
        params: { path: { id: resolvingComplaint.id } },
        body: {
          action: resolveAction,
          admin_notes: resolveNotes.trim(),
        },
      });
      if (res.error) throw new Error(res.error.message);
      setResolvingComplaint(null);
      setResolveNotes('');
      setMessage('Đã xử lý khiếu nại thành công!');
      void loadAdminData();
      void loadCourses();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi giải quyết khiếu nại.');
    } finally {
      setBusy(false);
    }
  }

  // Admin Toggle User Lock
  async function handleToggleUserLock(targetUser: any) {
    const isLocking = !targetUser.disabled;
    Alert.alert(
      isLocking ? 'Khóa tài khoản' : 'Mở khóa tài khoản',
      `Bạn có chắc chắn muốn ${isLocking ? 'khóa' : 'mở khóa'} tài khoản "${targetUser.email}"?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: isLocking ? 'Khóa' : 'Mở khóa',
          style: isLocking ? 'destructive' : 'default',
          onPress: async () => {
            try {
              const res = await session.api.POST(
                (isLocking ? '/api/v1/admin/users/{id}/lock' : '/api/v1/admin/users/{id}/unlock') as any,
                { params: { path: { id: targetUser.id } }, body: { reason: 'Quản trị viên thao tác' } }
              );
              if (res.error) throw new Error(res.error.message);
              void loadAdminData();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Lỗi khi cập nhật tài khoản.');
            }
          },
        },
      ]
    );
  }

  // Admin Toggle User Role
  async function handleToggleUserRole(userId: string, roleName: string, currentlyHas: boolean) {
    try {
      const res = await session.api.POST('/api/v1/admin/users/{id}/roles' as any, {
        params: { path: { id: userId } },
        body: { role: roleName, enabled: !currentlyHas },
      });
      if (res.error) throw new Error(res.error.message);
      void loadAdminData();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi đổi quyền.');
    }
  }

  const isInstructor = user?.roles.includes('INSTRUCTOR');
  const isAdmin = user?.roles.includes('ADMIN');
  const unreadNotifsCount = notifications.filter(n => !n.read).length;

  // Filter courses for student/instructor view
  const filteredCourses = courses
    .filter(c => {
      // In student mode, hide courses with access_mode LINK or RESTRICTED unless student is already enrolled or explicitly invited
      if (activeRoleMode === 'STUDENT') {
        if ((c.access_mode === 'LINK' || c.access_mode === 'RESTRICTED') && !c.user_enrolled) {
          const userEmail = (user?.email || '').toLowerCase();
          const isAllowed = c.allowed_emails && c.allowed_emails.some((e: string) => e.toLowerCase() === userEmail);
          if (!isAllowed) {
            return false;
          }
        }
      }

      if (search.trim()) {
        const kw = search.trim().toLowerCase();
        const matchTitle = c.title.toLowerCase().includes(kw);
        const matchDesc = (c.description || '').toLowerCase().includes(kw);
        const matchTag = (c.tag || '').toLowerCase().includes(kw);
        const matchInstructor = (c.instructor_name || '').toLowerCase().includes(kw);
        if (!matchTitle && !matchDesc && !matchTag && !matchInstructor) return false;
      }

      if (selectedTag !== 'all' && c.tag !== selectedTag) return false;

      // Status / Role Tabs
      if (activeRoleMode === 'INSTRUCTOR') {
        if (activeTab === 'mine') {
          if (c.owner_id !== user?.id) return false;
        } else if (activeTab === 'DRAFT') {
          if (c.status !== 'DRAFT' || c.owner_id !== user?.id) return false;
        } else if (activeTab === 'PUBLISHED') {
          if (c.status !== 'PUBLISHED' || c.owner_id !== user?.id) return false;
        } else if (activeTab === 'ARCHIVED') {
          if (c.status !== 'ARCHIVED' || c.owner_id !== user?.id) return false;
        }
      } else {
        if (activeTab === 'enrolled') return Boolean(c.user_enrolled);
        if (activeTab === 'liked') return Boolean(c.user_liked);
      }

      // Star filter
      const rating = c.avg_rating || 0;
      if (starFilter === '4.5' && rating < 4.5) return false;
      if (starFilter === '4.0' && rating < 4.0) return false;
      if (starFilter === '3.0' && rating < 3.0) return false;

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'rating') {
        return (b.avg_rating || 0) - (a.avg_rating || 0);
      }
      if (sortBy === 'likes') {
        return (b.like_count || 0) - (a.like_count || 0);
      }
      if (sortBy === 'reviews') {
        return (b.review_count || 0) - (a.review_count || 0);
      }
      if (sortBy === 'name') {
        return a.title.localeCompare(b.title, 'vi');
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

  // Filter admin users
  const filteredAdminUsers = adminUsers.filter(u => {
    if (!adminUserSearch.trim()) return true;
    const q = adminUserSearch.trim().toLowerCase();
    const matchName = (u.display_name || '').toLowerCase().includes(q);
    const matchEmail = (u.email || '').toLowerCase().includes(q);
    const matchRole = (u.roles || []).some((r: string) => r.toLowerCase().includes(q));
    return matchName || matchEmail || matchRole;
  });

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Top Header Bar */}
      <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.brandContainer}>
          <Text style={[styles.brandTitle, { color: colors.text }]}>TOPIC 16 LMS</Text>
          <Text style={[styles.brandSubtitle, { color: colors.textMuted }]}>
            {activeRoleMode === 'ADMIN'
              ? 'Trang Quản trị Hệ thống'
              : activeRoleMode === 'INSTRUCTOR'
              ? 'Không gian Giảng viên'
              : 'Không gian Học tập & RAG AI'}
          </Text>
        </View>

        <View style={styles.topBarActions}>
          {/* Dark Mode Toggle */}
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: colors.cardElevated }]}
            onPress={toggleDarkMode}
            accessibilityLabel="Đổi giao diện Sáng / Tối"
          >
            <Text style={styles.iconButtonText}>{darkMode ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>

          {/* Server Config Button */}
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: colors.cardElevated }]}
            onPress={() => setShowServerModal(true)}
            accessibilityLabel="Cấu hình IP máy chủ"
          >
            <Text style={styles.iconButtonText}>🌐</Text>
          </TouchableOpacity>

          {/* Notifications Button */}
          {user && (
            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: colors.cardElevated }]}
              onPress={() => setShowNotifModal(true)}
              accessibilityLabel="Thông báo"
            >
              <Text style={styles.iconButtonText}>🔔</Text>
              {unreadNotifsCount > 0 && (
                <View style={styles.badgeCount}>
                  <Text style={styles.badgeCountText}>
                    {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* User Avatar Button */}
          {user && (
            <TouchableOpacity
              style={styles.avatarButton}
              onPress={() => setShowProfileMenu(true)}
              accessibilityLabel="Tài khoản cá nhân"
            >
              <Text style={styles.avatarButtonText}>
                {(user.display_name || user.email).charAt(0).toUpperCase()}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error / Info banner */}
        {message ? (
          <View style={styles.bannerAlert}>
            <Text style={styles.bannerAlertText}>{message}</Text>
          </View>
        ) : null}

        {/* AUTH STATE: NOT LOGGED IN */}
        {!user ? (
          <View style={[styles.authCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.segmentContainer, { backgroundColor: colors.cardElevated }]}>
              <TouchableOpacity
                style={[styles.segmentButton, authTab === 'login' && styles.segmentButtonActive]}
                onPress={() => {
                  setAuthTab('login');
                  setMessage('');
                }}
              >
                <Text style={[styles.segmentText, authTab === 'login' && styles.segmentTextActive]}>
                  Đăng nhập
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segmentButton, authTab === 'register' && styles.segmentButtonActive]}
                onPress={() => {
                  setAuthTab('register');
                  setMessage('');
                }}
              >
                <Text style={[styles.segmentText, authTab === 'register' && styles.segmentTextActive]}>
                  Đăng ký tài khoản
                </Text>
              </TouchableOpacity>
            </View>

            {authTab === 'login' ? (
              /* LOGIN FORM */
              <View style={styles.formContainer}>
                <Text style={[styles.formTitle, { color: colors.text }]}>Chào mừng trở lại</Text>
                <Text style={[styles.formSubtitle, { color: colors.textMuted }]}>
                  Đăng nhập cùng tài khoản trên web để tiếp tục bài giảng và trao đổi AI.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Email tài khoản</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="name@example.com"
                    placeholderTextColor="#9ca3af"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Mật khẩu</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, busy && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Đăng nhập</Text>
                  )}
                </TouchableOpacity>

                {/* Quick login helpers */}
                <View style={styles.quickLoginSection}>
                  <Text style={[styles.quickLoginTitle, { color: colors.textMuted }]}>Đăng nhập nhanh mẫu:</Text>
                  <View style={styles.quickLoginPills}>
                    <TouchableOpacity style={styles.quickLoginPill} onPress={() => setEmail('student@lms.example')}>
                      <Text style={styles.quickLoginText}>Học viên (student)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.quickLoginPill} onPress={() => setEmail('instructor@lms.example')}>
                      <Text style={styles.quickLoginText}>Giảng viên (instructor)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.quickLoginPill} onPress={() => setEmail('admin@lms.example')}>
                      <Text style={styles.quickLoginText}>Admin (quản trị)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              /* REGISTER FORM */
              <View style={styles.formContainer}>
                <Text style={[styles.formTitle, { color: colors.text }]}>Tạo tài khoản mới</Text>
                <Text style={[styles.formSubtitle, { color: colors.textMuted }]}>
                  Chọn vai trò Học viên hoặc Giảng viên để trải nghiệm hệ thống.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Họ và tên</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={registerName}
                    onChangeText={setRegisterName}
                    placeholder="Ví dụ: Nguyễn Văn A"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={registerEmail}
                    onChangeText={setRegisterEmail}
                    placeholder="name@example.com"
                    placeholderTextColor="#9ca3af"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Mật khẩu</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                    value={registerPassword}
                    onChangeText={setRegisterPassword}
                    placeholder="Tối thiểu 6 ký tự"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Đăng ký với vai trò:</Text>
                  <View style={styles.rolePickerContainer}>
                    <TouchableOpacity
                      style={[styles.rolePickerItem, registerRole === 'STUDENT' && styles.rolePickerItemActive]}
                      onPress={() => setRegisterRole('STUDENT')}
                    >
                      <Text style={[styles.rolePickerText, registerRole === 'STUDENT' && styles.rolePickerTextActive]}>
                        Học viên
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rolePickerItem, registerRole === 'INSTRUCTOR' && styles.rolePickerItemActive]}
                      onPress={() => setRegisterRole('INSTRUCTOR')}
                    >
                      <Text style={[styles.rolePickerText, registerRole === 'INSTRUCTOR' && styles.rolePickerTextActive]}>
                        Giảng viên
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, busy && styles.buttonDisabled]}
                  onPress={handleRegister}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Tạo tài khoản</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          /* AUTH STATE: LOGGED IN */
          <View style={styles.authenticatedSection}>
            {/* VIEW MODE 1: ADMIN PANEL */}
            {activeRoleMode === 'ADMIN' ? (
              <View style={styles.adminPanelContainer}>
                {/* Admin Quick Jump Bar */}
                <View style={[styles.adminQuickNavCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.adminQuickNavLabel, { color: colors.textMuted }]}>
                    ĐIỀU HƯỚNG NHANH CÁC MỤC:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminQuickNavScroll}>
                    <TouchableOpacity
                      style={[styles.adminQuickNavBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => scrollToAdminSection('broadcast')}
                    >
                      <Text style={[styles.adminQuickNavBtnText, { color: colors.text }]}>📢 Phát TB</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminQuickNavBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => scrollToAdminSection('recent')}
                    >
                      <Text style={[styles.adminQuickNavBtnText, { color: colors.text }]}>🕒 Đã phát ({adminBroadcasts.length})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminQuickNavBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => scrollToAdminSection('locked')}
                    >
                      <Text style={[styles.adminQuickNavBtnText, { color: colors.text }]}>🔒 Khóa học ({adminLockedCourses.length})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminQuickNavBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => scrollToAdminSection('complaints')}
                    >
                      <Text style={[styles.adminQuickNavBtnText, { color: colors.text }]}>⚠️ Khiếu nại ({adminComplaints.length})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminQuickNavBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                      onPress={() => scrollToAdminSection('users')}
                    >
                      <Text style={[styles.adminQuickNavBtnText, { color: colors.text }]}>👥 Tài khoản ({adminUsers.length})</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>

                {/* 1. Broadcast System Announcement */}
                <View
                  onLayout={e => {
                    adminSectionPositions.current['broadcast'] = e.nativeEvent.layout.y;
                  }}
                  style={[styles.adminCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <TouchableOpacity
                    style={styles.accordionHeader}
                    onPress={() => setShowAdminBroadcastForm(v => !v)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.adminSectionTitle, { color: colors.text }]}>
                        1. Phát thông báo hệ thống
                      </Text>
                      <Text style={[styles.adminSectionSubtitle, { color: colors.textMuted }]}>
                        Gửi thông báo ưu tiên xuất hiện giữa màn hình toàn hệ thống hoặc đối tượng cụ thể.
                      </Text>
                    </View>
                    <Text style={[styles.accordionArrow, { color: colors.text }]}>
                      {showAdminBroadcastForm ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>

                  {showAdminBroadcastForm && (
                    <View style={styles.accordionContent}>
                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: colors.text }]}>Tiêu đề thông báo:</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                          placeholder="Ví dụ: Bảo trì máy chủ..."
                          placeholderTextColor="#9ca3af"
                          value={broadcastTitle}
                          onChangeText={setBroadcastTitle}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: colors.text }]}>Nội dung thông báo:</Text>
                        <TextInput
                          style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                          multiline
                          placeholder="Nhập nội dung chi tiết..."
                          placeholderTextColor="#9ca3af"
                          value={broadcastMessage}
                          onChangeText={setBroadcastMessage}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: colors.text }]}>Đối tượng nhận thông báo:</Text>
                        <View style={styles.segmentedRow}>
                          {[
                            ['ALL', 'Tất cả'],
                            ['INSTRUCTOR', 'Giảng viên'],
                            ['STUDENT', 'Học viên'],
                          ].map(([t, lbl]) => (
                            <TouchableOpacity
                              key={t}
                              style={[
                                styles.segmentPill,
                                broadcastTarget === t && styles.segmentPillActive,
                              ]}
                              onPress={() => setBroadcastTarget(t as any)}
                            >
                              <Text
                                style={[
                                  styles.segmentPillText,
                                  broadcastTarget === t && styles.segmentPillTextActive,
                                ]}
                              >
                                {lbl}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={handleSendBroadcast}
                        disabled={busy}
                      >
                        <Text style={styles.primaryButtonText}>Phát thông báo ngay</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* 2. Recent Broadcasts Accordion */}
                <View
                  onLayout={e => {
                    adminSectionPositions.current['recent'] = e.nativeEvent.layout.y;
                  }}
                  style={[styles.adminCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <TouchableOpacity
                    style={styles.accordionHeader}
                    onPress={() => setShowAdminBroadcasts(v => !v)}
                  >
                    <Text style={[styles.adminSectionTitle, { color: colors.text }]}>
                      2. Thông báo đã phát gần đây ({adminBroadcasts.length})
                    </Text>
                    <Text style={[styles.accordionArrow, { color: colors.text }]}>
                      {showAdminBroadcasts ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>

                  {showAdminBroadcasts && (
                    <View style={styles.accordionContent}>
                      {adminBroadcasts.length === 0 ? (
                        <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa phát thông báo nào.</Text>
                      ) : (
                        adminBroadcasts.map(b => (
                          <View key={b.id} style={[styles.adminListItem, { borderColor: colors.border }]}>
                            <Text style={[styles.adminItemTitle, { color: colors.text }]}>{b.title}</Text>
                            <Text style={[styles.adminItemDesc, { color: colors.textMuted }]}>{b.message}</Text>
                            <Text style={[styles.adminItemTime, { color: colors.textMuted }]}>
                              Đối tượng: {b.target_type} · Ngày:{' '}
                              {new Date(b.created_at).toLocaleString('vi-VN')}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>

                {/* 3. Locked Courses Accordion */}
                <View
                  onLayout={e => {
                    adminSectionPositions.current['locked'] = e.nativeEvent.layout.y;
                  }}
                  style={[styles.adminCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.accordionHeader}
                    onPress={() => setShowAdminLocked(v => !v)}
                  >
                    <Text style={[styles.adminSectionTitle, { color: colors.text }]}>
                      3. Quản lý khóa học bị khóa ({adminLockedCourses.length})
                    </Text>
                    <Text style={[styles.accordionArrow, { color: colors.text }]}>
                      {showAdminLocked ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>

                  {showAdminLocked && (
                    <View style={styles.accordionContent}>
                      {adminLockedCourses.length === 0 ? (
                        <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Hiện không có khóa học nào bị khóa.</Text>
                      ) : (
                        adminLockedCourses.map(c => (
                          <View key={c.id} style={[styles.adminListItem, { borderColor: colors.border }]}>
                            <Text style={[styles.adminItemTitle, { color: colors.text }]}>{c.title}</Text>
                            <Text style={[styles.adminItemDesc, { color: '#dc2626' }]}>
                              Lý do: {c.locked_reason || 'Vi phạm chính sách / khiếu nại'}
                            </Text>
                            <TouchableOpacity
                              style={styles.unlockBtn}
                              onPress={() => handleUnlockCourse(c.id, c.title)}
                            >
                              <Text style={styles.unlockBtnText}>Gỡ khóa khóa học</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>

                {/* 4. Course Complaints Accordion */}
                <View
                  onLayout={e => {
                    adminSectionPositions.current['complaints'] = e.nativeEvent.layout.y;
                  }}
                  style={[styles.adminCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <TouchableOpacity
                    style={styles.accordionHeader}
                    onPress={() => setShowAdminComplaints(v => !v)}
                  >
                    <Text style={[styles.adminSectionTitle, { color: colors.text }]}>
                      4. Khiếu nại từ học viên ({adminComplaints.length})
                    </Text>
                    <Text style={[styles.accordionArrow, { color: colors.text }]}>
                      {showAdminComplaints ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>

                  {showAdminComplaints && (
                    <View style={styles.accordionContent}>
                      {adminComplaints.length === 0 ? (
                        <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Chưa có khiếu nại nào cần xử lý.</Text>
                      ) : (
                        adminComplaints.map(comp => (
                          <View key={comp.id} style={[styles.adminListItem, { borderColor: colors.border }]}>
                            <View style={styles.complaintTopRow}>
                              <Text style={[styles.adminItemTitle, { color: colors.text }]}>
                                {comp.course_title || 'Khóa học'}
                              </Text>
                              <View style={styles.badgeDanger}>
                                <Text style={styles.badgeDangerText}>{comp.reason}</Text>
                              </View>
                            </View>
                            <Text style={[styles.adminItemDesc, { color: colors.text }]}>
                              Chi tiết: {comp.description}
                            </Text>
                            <Text style={[styles.adminItemTime, { color: colors.textMuted }]}>
                              Học viên: {comp.user_name || comp.user_email} · Gửi lúc:{' '}
                              {new Date(comp.created_at).toLocaleString('vi-VN')}
                            </Text>
                            {comp.status === 'PENDING' ? (
                              <TouchableOpacity
                                style={styles.resolveBtn}
                                onPress={() => setResolvingComplaint(comp)}
                              >
                                <Text style={styles.resolveBtnText}>Xử lý khiếu nại này</Text>
                              </TouchableOpacity>
                            ) : (
                              <Text style={styles.resolvedStatusText}>
                                Đã xử lý: {comp.status} ({comp.admin_notes || 'Không có ghi chú'})
                              </Text>
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>

                {/* 5. User Accounts Accordion */}
                <View
                  onLayout={e => {
                    adminSectionPositions.current['users'] = e.nativeEvent.layout.y;
                  }}
                  style={[styles.adminCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <TouchableOpacity
                    style={styles.accordionHeader}
                    onPress={() => setShowAdminUsers(v => !v)}
                  >
                    <Text style={[styles.adminSectionTitle, { color: colors.text }]}>
                      5. Quản lý danh sách tài khoản ({adminUsers.length})
                    </Text>
                    <Text style={[styles.accordionArrow, { color: colors.text }]}>
                      {showAdminUsers ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>

                  {showAdminUsers && (
                    <View style={styles.accordionContent}>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                        placeholder="Tìm theo tên, email hoặc vai trò..."
                        placeholderTextColor="#9ca3af"
                        value={adminUserSearch}
                        onChangeText={setAdminUserSearch}
                      />

                      {filteredAdminUsers.map(u => (
                        <View key={u.id} style={[styles.userRow, { borderColor: colors.border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.userNameText, { color: colors.text }]}>{u.display_name}</Text>
                            <Text style={[styles.userEmailText, { color: colors.textMuted }]}>{u.email}</Text>
                            <Text style={[styles.userRolesText, { color: colors.primary }]}>
                              Vai trò: {(u.roles || []).join(', ')}
                            </Text>
                            <Text style={[styles.userStatusText, u.disabled ? styles.textDanger : styles.textSuccess]}>
                              {u.disabled ? 'Đã bị khóa' : 'Đang hoạt động'}
                            </Text>
                          </View>

                          <View style={styles.userActionBtns}>
                            <TouchableOpacity
                              style={[styles.smallUserBtn, u.disabled ? styles.btnSuccess : styles.btnDanger]}
                              onPress={() => handleToggleUserLock(u)}
                            >
                              <Text style={styles.smallUserBtnText}>
                                {u.disabled ? 'Mở khóa' : 'Khóa'}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.smallUserRoleBtn}
                              onPress={() =>
                                handleToggleUserRole(
                                  u.id,
                                  'INSTRUCTOR',
                                  u.roles.includes('INSTRUCTOR')
                                )
                              }
                            >
                              <Text style={styles.smallUserRoleBtnText}>
                                {u.roles.includes('INSTRUCTOR') ? '- Giảng viên' : '+ Giảng viên'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ) : (
              /* VIEW MODE 2: STUDENT & INSTRUCTOR VIEWS */
              <View style={styles.catalogContainer}>
                {/* INSTRUCTOR TOP ACTION: Create Course */}
                {activeRoleMode === 'INSTRUCTOR' && (
                  <View style={styles.instructorActionBar}>
                    <TouchableOpacity
                      style={styles.createCourseBtn}
                      onPress={() => setShowCreateCourseModal(true)}
                    >
                      <Text style={styles.createCourseBtnText}>+ Soạn tạo khóa học mới</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Search Bar Row with Sort & Filter Button on Right */}
                <View style={styles.searchBarRow}>
                  <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                    <Text style={styles.searchIcon}>🔍</Text>
                    <TextInput
                      style={[styles.searchInput, { color: colors.text }]}
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Tìm theo tên bài giảng, chủ đề, giảng viên..."
                      placeholderTextColor="#9ca3af"
                    />
                    {search.length > 0 && (
                      <TouchableOpacity onPress={() => setSearch('')}>
                        <Text style={styles.clearSearchText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.sortFilterBtn,
                      {
                        backgroundColor: (sortBy !== 'newest' || starFilter !== 'all') ? colors.primary : colors.card,
                        borderColor: (sortBy !== 'newest' || starFilter !== 'all') ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setShowSortFilterModal(true)}
                    accessibilityLabel="Sắp xếp và lọc khóa học"
                  >
                    <Text
                      style={[
                        styles.sortFilterBtnText,
                        { color: (sortBy !== 'newest' || starFilter !== 'all') ? '#ffffff' : colors.text },
                      ]}
                    >
                      ⇅ Lọc {(sortBy !== 'newest' || starFilter !== 'all') ? '●' : ''}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Active Filter Pills (if any filter or sort applied) */}
                {(sortBy !== 'newest' || starFilter !== 'all') && (
                  <View style={styles.activeFiltersRow}>
                    {sortBy !== 'newest' && (
                      <TouchableOpacity
                        style={[styles.activeFilterPill, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                        onPress={() => setSortBy('newest')}
                      >
                        <Text style={[styles.activeFilterPillText, { color: colors.text }]}>
                          Xếp: {
                            sortBy === 'rating'
                              ? 'Đánh giá cao'
                              : sortBy === 'likes'
                              ? 'Yêu thích'
                              : sortBy === 'reviews'
                              ? 'Nhiều nhận xét'
                              : 'Tên A-Z'
                          } ✕
                        </Text>
                      </TouchableOpacity>
                    )}
                    {starFilter !== 'all' && (
                      <TouchableOpacity
                        style={[styles.activeFilterPill, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                        onPress={() => setStarFilter('all')}
                      >
                        <Text style={[styles.activeFilterPillText, { color: colors.text }]}>
                          Số sao: ≥ {starFilter} ⭐ ✕
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.clearAllFiltersBtn}
                      onPress={() => {
                        setSortBy('newest');
                        setStarFilter('all');
                      }}
                    >
                      <Text style={styles.clearAllFiltersBtnText}>Đặt lại</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Category Tags Horizontal Pill Scroll */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tagScrollContainer}
                >
                  <TouchableOpacity
                    style={[
                      styles.tagPill,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      selectedTag === 'all' && styles.tagPillActive,
                    ]}
                    onPress={() => setSelectedTag('all')}
                  >
                    <Text
                      style={[
                        styles.tagPillText,
                        { color: colors.text },
                        selectedTag === 'all' && styles.tagPillTextActive,
                      ]}
                    >
                      Tất cả chủ đề
                    </Text>
                  </TouchableOpacity>
                  {COURSE_TAGS.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.tagPill,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        selectedTag === t && styles.tagPillActive,
                      ]}
                      onPress={() => setSelectedTag(t)}
                    >
                      <Text
                        style={[
                          styles.tagPillText,
                          { color: colors.text },
                          selectedTag === t && styles.tagPillTextActive,
                        ]}
                      >
                        {t}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Status Filter Tabs */}
                <View style={styles.filterTabsRow}>
                  {activeRoleMode === 'INSTRUCTOR' ? (
                    <>
                      {[
                        ['all', `Tất cả (${courses.filter(c => c.owner_id === user.id).length})`],
                        ['DRAFT', `Bản nháp (${courses.filter(c => c.owner_id === user.id && c.status === 'DRAFT').length})`],
                        ['PUBLISHED', `Đã xuất bản (${courses.filter(c => c.owner_id === user.id && c.status === 'PUBLISHED').length})`],
                        ['ARCHIVED', `Lưu trữ (${courses.filter(c => c.owner_id === user.id && c.status === 'ARCHIVED').length})`],
                      ].map(([val, label]) => (
                        <TouchableOpacity
                          key={val}
                          style={[
                            styles.filterTab,
                            { backgroundColor: colors.cardElevated },
                            activeTab === val && styles.filterTabActive,
                          ]}
                          onPress={() => setActiveTab(val as any)}
                        >
                          <Text
                            style={[
                              styles.filterTabText,
                              { color: colors.textMuted },
                              activeTab === val && styles.filterTabTextActive,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[
                          styles.filterTab,
                          { backgroundColor: colors.cardElevated },
                          activeTab === 'all' && styles.filterTabActive,
                        ]}
                        onPress={() => setActiveTab('all')}
                      >
                        <Text
                          style={[
                            styles.filterTabText,
                            { color: colors.textMuted },
                            activeTab === 'all' && styles.filterTabTextActive,
                          ]}
                        >
                          Tất cả ({courses.length})
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.filterTab,
                          { backgroundColor: colors.cardElevated },
                          activeTab === 'enrolled' && styles.filterTabActive,
                        ]}
                        onPress={() => setActiveTab('enrolled')}
                      >
                        <Text
                          style={[
                            styles.filterTabText,
                            { color: colors.textMuted },
                            activeTab === 'enrolled' && styles.filterTabTextActive,
                          ]}
                        >
                          Đang học ({courses.filter(c => c.user_enrolled).length})
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.filterTab,
                          { backgroundColor: colors.cardElevated },
                          activeTab === 'liked' && styles.filterTabActive,
                        ]}
                        onPress={() => setActiveTab('liked')}
                      >
                        <Text
                          style={[
                            styles.filterTabText,
                            { color: colors.textMuted },
                            activeTab === 'liked' && styles.filterTabTextActive,
                          ]}
                        >
                          Yêu thích ({courses.filter(c => c.user_liked).length})
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                {/* Courses List */}
                {loadingCourses ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#21634f" />
                    <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                      Đang tải danh sách bài giảng…
                    </Text>
                  </View>
                ) : filteredCourses.length === 0 ? (
                  <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>
                      Chưa tìm thấy khóa học phù hợp
                    </Text>
                    <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                      Thử tìm kiếm với từ khóa khác hoặc chuyển sang chủ đề khác.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.coursesGrid}>
                    {filteredCourses.map(course => {
                      const isOwner = course.owner_id === user?.id;
                      const accessModeText =
                        course.access_mode === 'RESTRICTED'
                          ? 'Chỉ định'
                          : course.access_mode === 'LINK'
                          ? 'Chia sẻ link'
                          : 'Công khai';

                      return (
                        <View
                          key={course.id}
                          style={[
                            styles.courseCard,
                            { backgroundColor: colors.card, borderColor: colors.border },
                          ]}
                        >
                          {/* Course Thumbnail */}
                          <TouchableOpacity
                            activeOpacity={0.9}
                            onPress={() =>
                              router.push({
                                pathname: '/course/[id]',
                                params: { id: course.id },
                              })
                            }
                          >
                            <View style={styles.courseThumbnailBox}>
                              {course.thumbnail_url ? (
                                <Image
                                  source={{ uri: course.thumbnail_url }}
                                  style={styles.courseThumbnailImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.courseThumbnailFallback}>
                                  <Text style={styles.courseThumbnailFallbackText}>
                                    {course.title.slice(0, 2).toUpperCase()}
                                  </Text>
                                </View>
                              )}

                              <View style={styles.badgeCategory}>
                                <Text style={styles.badgeCategoryText}>
                                  {course.tag || 'CNTT & Phần mềm'}
                                </Text>
                              </View>

                              <View style={styles.badgeAccessMode}>
                                <Text style={styles.badgeAccessModeText}>
                                  {accessModeText}
                                </Text>
                              </View>
                            </View>
                          </TouchableOpacity>

                          {course.is_locked && (
                            <View style={styles.courseLockedBanner}>
                              <Text style={styles.courseLockedBannerText}>
                                Tạm khóa: {course.locked_reason || 'Đang chờ xem xét'}
                              </Text>
                            </View>
                          )}

                          <View style={styles.courseBody}>
                            <View style={styles.courseTitleRow}>
                              <TouchableOpacity
                                style={{ flex: 1 }}
                                onPress={() =>
                                  router.push({
                                    pathname: '/course/[id]',
                                    params: { id: course.id },
                                  })
                                }
                              >
                                <Text style={[styles.courseTitle, { color: colors.text }]} numberOfLines={2}>
                                  {course.title}
                                </Text>
                              </TouchableOpacity>

                              {/* Heart Like */}
                              <TouchableOpacity
                                style={[styles.likeButton, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                                onPress={() => handleToggleLike(course.id)}
                              >
                                <Text style={[styles.likeHeart, course.user_liked && styles.likeHeartActive]}>
                                  {course.user_liked ? '♥' : '♡'}
                                </Text>
                                <Text style={[styles.likeCount, { color: colors.textMuted }]}>
                                  {course.like_count || 0}
                                </Text>
                              </TouchableOpacity>
                            </View>

                            {course.description ? (
                              <Text style={[styles.courseDescription, { color: colors.textMuted }]} numberOfLines={2}>
                                {course.description}
                              </Text>
                            ) : null}

                            <View style={[styles.courseFooter, { borderTopColor: colors.border }]}>
                              <View style={styles.instructorTag}>
                                <Text style={styles.instructorIcon}>👤</Text>
                                <Text style={[styles.instructorName, { color: colors.textMuted }]} numberOfLines={1}>
                                  {course.instructor_name || 'Giảng viên LMS'}
                                </Text>
                              </View>

                              <View style={styles.ratingBadge}>
                                <Text style={styles.ratingStar}>★</Text>
                                <Text style={[styles.ratingScore, { color: colors.text }]}>
                                  {course.avg_rating && course.avg_rating > 0
                                    ? course.avg_rating.toFixed(1)
                                    : 'Mới'}
                                </Text>
                                {course.review_count && course.review_count > 0 ? (
                                  <Text style={styles.reviewCount}>({course.review_count})</Text>
                                ) : null}
                              </View>
                            </View>

                            {/* INSTRUCTOR ACTIONS: Edit & Manage */}
                            {activeRoleMode === 'INSTRUCTOR' && isOwner && (
                              <View style={styles.instructorCardActions}>
                                <TouchableOpacity
                                  style={styles.editCourseBtn}
                                  onPress={() =>
                                    router.push({
                                      pathname: '/course/edit/[id]',
                                      params: { id: course.id },
                                    })
                                  }
                                >
                                  <Text style={styles.editCourseBtnText}>
                                    ✏️ Chỉnh sửa bài giảng & khóa học
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* MODAL 1: HIGH PRIORITY BROADCAST POPOVER IN CENTER OF SCREEN */}
      {activeAnnouncement && (
        <Modal visible transparent animationType="fade">
          <View style={styles.priorityModalBackdrop}>
            <View style={styles.priorityModalCard}>
              <View style={styles.priorityModalHeader}>
                <Text style={styles.priorityModalBadge}>THÔNG BÁO TỪ QUẢN TRỊ VIÊN</Text>
                <View style={styles.countdownBadge}>
                  <Text style={styles.countdownBadgeText}>
                    Tự đóng sau {announcementCountdown}s
                  </Text>
                </View>
              </View>

              <Text style={styles.priorityModalTitle}>{activeAnnouncement.title}</Text>
              <ScrollView style={{ maxHeight: 220, marginVertical: 8 }}>
                <Text style={styles.priorityModalBody}>{activeAnnouncement.message}</Text>
              </ScrollView>

              <TouchableOpacity style={styles.closePriorityBtn} onPress={handleCloseAnnouncement}>
                <Text style={styles.closePriorityBtnText}>Đã hiểu & Đóng thông báo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL 2: USER PROFILE POPOVER & ROLE SWITCHER */}
      <Modal visible={showProfileMenu} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowProfileMenu(false)}
        >
          <View style={[styles.profileMenuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.profileMenuHeader}>
              <View style={styles.avatarCircleBig}>
                <Text style={styles.avatarCircleBigText}>
                  {(user?.display_name || user?.email || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileMenuName, { color: colors.text }]}>{user?.display_name}</Text>
                <Text style={[styles.profileMenuEmail, { color: colors.textMuted }]}>{user?.email}</Text>
                <View style={styles.roleTagPill}>
                  <Text style={styles.roleTagPillText}>
                    Chế độ: {activeRoleMode === 'ADMIN' ? 'Quản trị viên' : activeRoleMode === 'INSTRUCTOR' ? 'Giảng viên' : 'Học viên'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.menuDivider, { borderBottomColor: colors.border }]} />

            {/* Switch Role Options */}
            <Text style={[styles.menuSectionHeader, { color: colors.textMuted }]}>CHUYỂN ĐỔI KHÔNG GIAN</Text>

            <TouchableOpacity
              style={[styles.menuOptionBtn, activeRoleMode === 'STUDENT' && styles.menuOptionBtnActive]}
              onPress={() => handleSwitchRole('STUDENT')}
            >
              <Text style={styles.menuOptionBtnText}>👨‍🎓 Không gian Học viên</Text>
            </TouchableOpacity>

            {isInstructor ? (
              <TouchableOpacity
                style={[styles.menuOptionBtn, activeRoleMode === 'INSTRUCTOR' && styles.menuOptionBtnActive]}
                onPress={() => handleSwitchRole('INSTRUCTOR')}
              >
                <Text style={styles.menuOptionBtnText}>👨‍🏫 Không gian Giảng viên</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.menuOptionExtraBtn}
                onPress={() => handleRegisterExtraRole('INSTRUCTOR')}
              >
                <Text style={styles.menuOptionExtraBtnText}>+ Đăng ký làm Giảng viên</Text>
              </TouchableOpacity>
            )}

            {isAdmin && (
              <TouchableOpacity
                style={[styles.menuOptionBtn, activeRoleMode === 'ADMIN' && styles.menuOptionBtnActive]}
                onPress={() => handleSwitchRole('ADMIN')}
              >
                <Text style={styles.menuOptionBtnText}>🛡️ Bảng Quản trị Hệ thống</Text>
              </TouchableOpacity>
            )}

            <View style={[styles.menuDivider, { borderBottomColor: colors.border }]} />

            {/* Dark Mode Switch */}
            <View style={styles.menuSwitchRow}>
              <Text style={[styles.menuSwitchLabel, { color: colors.text }]}>Giao diện Tối (Dark mode):</Text>
              <Switch
                value={darkMode}
                onValueChange={toggleDarkMode}
                trackColor={{ true: '#21634f', false: '#cbd5e1' }}
              />
            </View>

            <View style={[styles.menuDivider, { borderBottomColor: colors.border }]} />

            {/* Logout */}
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>Đăng xuất tài khoản</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL 3: INSTRUCTOR COURSE CREATOR */}
      <Modal visible={showCreateCourseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={[styles.createCourseCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Tạo khóa học mới</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
              Nhập tiêu đề, chọn chủ đề và thiết lập quyền tham gia cho khóa học của bạn.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Tiêu đề khóa học *:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                placeholder="Ví dụ: Lập trình Python từ cơ bản đến nâng cao"
                placeholderTextColor="#9ca3af"
                value={newCourseTitle}
                onChangeText={setNewCourseTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Chủ đề đào tạo:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ gap: 6 }}>
                {COURSE_TAGS.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.tagChip,
                      { backgroundColor: colors.cardElevated, borderColor: colors.border },
                      newCourseTag === t && styles.tagChipActive,
                    ]}
                    onPress={() => setNewCourseTag(t)}
                  >
                    <Text
                      style={[
                        styles.tagChipText,
                        { color: colors.text },
                        newCourseTag === t && styles.tagChipTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Quyền truy cập tham gia:</Text>
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
                      newCourseAccessMode === m && styles.segmentPillActive,
                    ]}
                    onPress={() => setNewCourseAccessMode(m as any)}
                  >
                    <Text
                      style={[
                        styles.segmentPillText,
                        newCourseAccessMode === m && styles.segmentPillTextActive,
                      ]}
                    >
                      {lbl}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {newCourseAccessMode === 'RESTRICTED' && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Danh sách email học viên (cách nhau bởi dấu phẩy):
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                  multiline
                  placeholder="student1@example.com, student2@example.com"
                  placeholderTextColor="#9ca3af"
                  value={newCourseEmails}
                  onChangeText={setNewCourseEmails}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>URL ảnh bìa khóa học:</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                placeholder="https://example.com/thumbnail.jpg"
                placeholderTextColor="#9ca3af"
                value={newCourseThumbnail}
                onChangeText={setNewCourseThumbnail}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Mô tả tóm tắt nội dung:</Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                multiline
                placeholder="Nội dung chính học viên sẽ đạt được..."
                placeholderTextColor="#9ca3af"
                value={newCourseDesc}
                onChangeText={setNewCourseDesc}
              />
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateCourseModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleCreateCourse}
                disabled={busy}
              >
                <Text style={styles.modalPrimaryBtnText}>Tạo khóa học ngay</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: SORT & FILTER */}
      <Modal visible={showSortFilterModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={[styles.createCourseCard, { backgroundColor: colors.card, maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Sắp xếp & Bộ lọc khóa học</Text>
              <TouchableOpacity onPress={() => setShowSortFilterModal(false)} style={{ padding: 6 }}>
                <Text style={{ fontSize: 18, color: colors.textMuted, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
              Tùy chỉnh tiêu chí hiển thị bài giảng theo nhu cầu của bạn.
            </Text>

            {/* 1. Sort by */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Sắp xếp theo:</Text>
              <View style={styles.filterModalPillsWrap}>
                {[
                  ['newest', 'Mới nhất'],
                  ['rating', 'Đánh giá cao nhất'],
                  ['likes', 'Yêu thích nhất'],
                  ['reviews', 'Nhiều nhận xét nhất'],
                  ['name', 'Tên A - Z'],
                ].map(([sKey, sLabel]) => (
                  <TouchableOpacity
                    key={sKey}
                    style={[
                      styles.filterModalPill,
                      { backgroundColor: colors.cardElevated, borderColor: colors.border },
                      sortBy === sKey && styles.filterModalPillActive,
                    ]}
                    onPress={() => setSortBy(sKey as any)}
                  >
                    <Text
                      style={[
                        styles.filterModalPillText,
                        { color: colors.text },
                        sortBy === sKey && styles.filterModalPillTextActive,
                      ]}
                    >
                      {sLabel}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 2. Star filter */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Lọc theo số sao đánh giá:</Text>
              <View style={styles.filterModalPillsWrap}>
                {[
                  ['all', 'Tất cả sao'],
                  ['4.5', 'Từ 4.5 ⭐ trở lên'],
                  ['4.0', 'Từ 4.0 ⭐ trở lên'],
                  ['3.0', 'Từ 3.0 ⭐ trở lên'],
                ].map(([starKey, starLabel]) => (
                  <TouchableOpacity
                    key={starKey}
                    style={[
                      styles.filterModalPill,
                      { backgroundColor: colors.cardElevated, borderColor: colors.border },
                      starFilter === starKey && styles.filterModalPillActive,
                    ]}
                    onPress={() => setStarFilter(starKey as any)}
                  >
                    <Text
                      style={[
                        styles.filterModalPillText,
                        { color: colors.text },
                        starFilter === starKey && styles.filterModalPillTextActive,
                      ]}
                    >
                      {starLabel}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 3. Category Tags */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Lọc theo chủ đề đào tạo:</Text>
              <View style={styles.filterModalPillsWrap}>
                <TouchableOpacity
                  style={[
                    styles.filterModalPill,
                    { backgroundColor: colors.cardElevated, borderColor: colors.border },
                    selectedTag === 'all' && styles.filterModalPillActive,
                  ]}
                  onPress={() => setSelectedTag('all')}
                >
                  <Text
                    style={[
                      styles.filterModalPillText,
                      { color: colors.text },
                      selectedTag === 'all' && styles.filterModalPillTextActive,
                    ]}
                  >
                    Tất cả chủ đề
                  </Text>
                </TouchableOpacity>
                {COURSE_TAGS.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.filterModalPill,
                      { backgroundColor: colors.cardElevated, borderColor: colors.border },
                      selectedTag === t && styles.filterModalPillActive,
                    ]}
                    onPress={() => setSelectedTag(t)}
                  >
                    <Text
                      style={[
                        styles.filterModalPillText,
                        { color: colors.text },
                        selectedTag === t && styles.filterModalPillTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setSortBy('newest');
                  setStarFilter('all');
                  setSelectedTag('all');
                }}
              >
                <Text style={styles.modalCancelBtnText}>Đặt lại</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => setShowSortFilterModal(false)}
              >
                <Text style={styles.modalPrimaryBtnText}>Áp dụng</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL 4: ADMIN RESOLVE COMPLAINT */}
      <Modal visible={Boolean(resolvingComplaint)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.adminModalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Xử lý khiếu nại</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
              Khóa học: {resolvingComplaint?.course_title} · Lý do: {resolvingComplaint?.reason}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Quyết định xử lý:</Text>
              <View style={styles.segmentedRow}>
                <TouchableOpacity
                  style={[
                    styles.segmentPill,
                    resolveAction === 'CLOSE_COURSE' && styles.segmentPillDanger,
                  ]}
                  onPress={() => setResolveAction('CLOSE_COURSE')}
                >
                  <Text style={[styles.segmentPillText, resolveAction === 'CLOSE_COURSE' && styles.textWhite]}>
                    Khóa & Đóng khóa học
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.segmentPill,
                    resolveAction === 'DISMISS' && styles.segmentPillActive,
                  ]}
                  onPress={() => setResolveAction('DISMISS')}
                >
                  <Text style={[styles.segmentPillText, resolveAction === 'DISMISS' && styles.textWhite]}>
                    Bác bỏ khiếu nại
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Ghi chú giải quyết của Admin:</Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
                multiline
                placeholder="Ghi rõ lý do quyết định..."
                placeholderTextColor="#9ca3af"
                value={resolveNotes}
                onChangeText={setResolveNotes}
              />
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setResolvingComplaint(null)}
              >
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryBtn, resolveAction === 'CLOSE_COURSE' && { backgroundColor: '#dc2626' }]}
                onPress={handleResolveComplaint}
                disabled={busy}
              >
                <Text style={styles.modalPrimaryBtnText}>Xác nhận xử lý</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 5: NOTIFICATIONS CENTER */}
      <Modal visible={showNotifModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.notifModalCard, { backgroundColor: colors.card }]}>
            <View style={styles.notifModalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Thông báo hệ thống</Text>
              <TouchableOpacity onPress={() => setShowNotifModal(false)}>
                <Text style={[styles.closeIcon, { color: colors.text }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {notifications.length === 0 ? (
                <Text style={[styles.emptyNotice, { color: colors.textMuted }]}>Bạn không có thông báo nào.</Text>
              ) : (
                notifications.map(n => (
                  <View key={n.id} style={[styles.notifCardItem, { borderColor: colors.border }]}>
                    <Text style={[styles.notifItemTitle, { color: colors.text }]}>{n.title}</Text>
                    <Text style={[styles.notifItemBody, { color: colors.textMuted }]}>{n.message}</Text>
                    <Text style={[styles.notifItemDate, { color: colors.textMuted }]}>
                      {new Date(n.created_at).toLocaleString('vi-VN')}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL 6: SERVER IP CONFIG */}
      <Modal visible={showServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.serverModalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Cấu hình máy chủ API</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
              Nhập IP mạng Wi-Fi của máy tính đang chạy NestJS API (Ví dụ: http://192.168.1.12:4000)
            </Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActionsRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowServerModal(false)}>
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={async () => {
                  await setApiUrl(serverUrlInput);
                  setShowServerModal(false);
                  setMessage('Đã lưu cấu hình server: ' + getCurrentApiUrl());
                  if (user) void loadCourses();
                }}
              >
                <Text style={styles.modalPrimaryBtnText}>Lưu & Kết nối</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 48 : 36,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  brandContainer: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconButtonText: {
    fontSize: 16,
  },
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#21634f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  badgeCount: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#ef4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeCountText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  bannerAlert: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
  },
  bannerAlertText: {
    color: '#991b1b',
    fontSize: 13,
  },
  authCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    gap: 14,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentButtonActive: {
    backgroundColor: '#21634f',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  formContainer: {
    gap: 12,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  formSubtitle: {
    fontSize: 13,
    lineHeight: 18,
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
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#21634f',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  rolePickerContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  rolePickerItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  rolePickerItemActive: {
    borderColor: '#21634f',
    backgroundColor: '#ecfdf5',
  },
  rolePickerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  rolePickerTextActive: {
    color: '#21634f',
    fontWeight: '700',
  },
  quickLoginSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 6,
  },
  quickLoginTitle: {
    fontSize: 11,
    fontWeight: '600',
  },
  quickLoginPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickLoginPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  quickLoginText: {
    fontSize: 11,
    color: '#334155',
  },
  authenticatedSection: {
    gap: 16,
  },
  catalogContainer: {
    gap: 14,
  },
  instructorActionBar: {
    marginBottom: 4,
  },
  createCourseBtn: {
    backgroundColor: '#21634f',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  createCourseBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  clearSearchText: {
    fontSize: 14,
    color: '#94a3b8',
    padding: 4,
  },
  tagScrollContainer: {
    gap: 6,
    paddingVertical: 2,
  },
  tagPill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagPillActive: {
    backgroundColor: '#21634f',
    borderColor: '#21634f',
  },
  tagPillText: {
    fontSize: 12,
  },
  tagPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  filterTabsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  filterTabActive: {
    backgroundColor: '#21634f',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyContainer: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  coursesGrid: {
    gap: 14,
  },
  courseCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  courseThumbnailBox: {
    width: '100%',
    height: 150,
    backgroundColor: '#334155',
    position: 'relative',
  },
  courseThumbnailImage: {
    width: '100%',
    height: '100%',
  },
  courseThumbnailFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseThumbnailFallbackText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
  },
  badgeCategory: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeCategoryText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeAccessMode: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(33, 99, 79, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeAccessModeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  courseLockedBanner: {
    backgroundColor: '#fef2f2',
    padding: 6,
  },
  courseLockedBannerText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '600',
  },
  courseBody: {
    padding: 14,
    gap: 6,
  },
  courseTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  courseTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  likeHeart: {
    fontSize: 14,
    color: '#94a3b8',
  },
  likeHeartActive: {
    color: '#ef4444',
  },
  likeCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  courseDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  courseFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
  },
  instructorTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  instructorIcon: {
    fontSize: 12,
  },
  instructorName: {
    fontSize: 11,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingStar: {
    color: '#eab308',
    fontSize: 13,
  },
  ratingScore: {
    fontSize: 12,
    fontWeight: '700',
  },
  reviewCount: {
    fontSize: 10,
    color: '#94a3b8',
  },
  instructorCardActions: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  editCourseBtn: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  editCourseBtnText: {
    color: '#065f46',
    fontSize: 12,
    fontWeight: '700',
  },
  adminPanelContainer: {
    gap: 16,
  },
  adminCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  adminSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  adminSectionSubtitle: {
    fontSize: 12,
    marginTop: -4,
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accordionArrow: {
    fontSize: 14,
    fontWeight: '700',
  },
  accordionContent: {
    gap: 10,
    paddingTop: 4,
  },
  adminListItem: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
  },
  adminItemTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  adminItemDesc: {
    fontSize: 12,
  },
  adminItemTime: {
    fontSize: 10,
  },
  unlockBtn: {
    backgroundColor: '#21634f',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  unlockBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  complaintTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeDanger: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDangerText: {
    color: '#b91c1c',
    fontSize: 10,
    fontWeight: '700',
  },
  resolveBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  resolveBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  resolvedStatusText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
    marginTop: 2,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
  },
  userNameText: {
    fontSize: 13,
    fontWeight: '700',
  },
  userEmailText: {
    fontSize: 11,
  },
  userRolesText: {
    fontSize: 11,
    fontWeight: '600',
  },
  userStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  userActionBtns: {
    gap: 4,
  },
  smallUserBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignItems: 'center',
  },
  btnSuccess: {
    backgroundColor: '#21634f',
  },
  btnDanger: {
    backgroundColor: '#dc2626',
  },
  smallUserBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  smallUserRoleBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  smallUserRoleBtnText: {
    fontSize: 10,
    color: '#334155',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  profileMenuCard: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    gap: 10,
  },
  profileMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircleBig: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#21634f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircleBigText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  profileMenuName: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileMenuEmail: {
    fontSize: 12,
  },
  roleTagPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  roleTagPillText: {
    fontSize: 10,
    color: '#065f46',
    fontWeight: '700',
  },
  menuDivider: {
    borderBottomWidth: 1,
    marginVertical: 4,
  },
  menuSectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  menuOptionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  menuOptionBtnActive: {
    backgroundColor: '#21634f',
  },
  menuOptionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  menuOptionExtraBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#21634f',
  },
  menuOptionExtraBtnText: {
    fontSize: 12,
    color: '#21634f',
    fontWeight: '700',
  },
  menuSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuSwitchLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  logoutBtn: {
    backgroundColor: '#fee2e2',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
  priorityModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  priorityModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    gap: 10,
  },
  priorityModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priorityModalBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#dc2626',
    letterSpacing: 1,
  },
  countdownBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  countdownBadgeText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '700',
  },
  priorityModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  priorityModalBody: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 22,
  },
  closePriorityBtn: {
    backgroundColor: '#21634f',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closePriorityBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  createCourseCard: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  tagChipActive: {
    backgroundColor: '#21634f',
    borderColor: '#21634f',
  },
  tagChipText: {
    fontSize: 11,
  },
  tagChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
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
  segmentPillDanger: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  segmentPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  segmentPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
    paddingBottom: 20,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  modalCancelBtnText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  modalPrimaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#21634f',
  },
  modalPrimaryBtnText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '700',
  },
  adminModalCard: {
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  notifModalCard: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  notifModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  closeIcon: {
    fontSize: 18,
    fontWeight: '700',
    padding: 4,
  },
  notifCardItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 4,
  },
  notifItemTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  notifItemBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  notifItemDate: {
    fontSize: 10,
  },
  serverModalCard: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  emptyNotice: {
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  textWhite: {
    color: '#ffffff',
    fontWeight: '700',
  },
  textSuccess: {
    color: '#059669',
  },
  textDanger: {
    color: '#dc2626',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sortFilterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortFilterBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  activeFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
  },
  activeFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  activeFilterPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clearAllFiltersBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  clearAllFiltersBtnText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '700',
  },
  adminQuickNavCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  adminQuickNavLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  adminQuickNavScroll: {
    gap: 8,
  },
  adminQuickNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  adminQuickNavBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterModalPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  filterModalPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterModalPillActive: {
    backgroundColor: '#21634f',
    borderColor: '#21634f',
  },
  filterModalPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterModalPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
