'use client';
import { FormEvent, useEffect, useState } from 'react';
import type { components } from '@lms/api-client';
import { COURSE_TAGS } from '@lms/api-client';
import { session } from './session';
import { CourseEditor } from './course-editor';
import { CourseCreator } from './course-creator';
import { AdminPanel } from './admin-panel';
type Course = components['schemas']['CourseDto'];
type Announcement = components['schemas']['AnnouncementDto'];
export default function Home() {
  const [user, setUser] = useState(session.user);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [starFilter, setStarFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [adminView,setAdminView]=useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [announcementsQueue, setAnnouncementsQueue] = useState<Announcement[]>([]);
  const [announcementCountdown, setAnnouncementCountdown] = useState<number>(10);
  const [courseActionTarget, setCourseActionTarget] = useState<{
    course: Course;
    action: 'ARCHIVE' | 'DELETE';
  } | null>(null);
  const [courseActionApplyMode, setCourseActionApplyMode] = useState<'immediate' | 'scheduled' | 'range'>('immediate');
  const [courseActionScheduledAt, setCourseActionScheduledAt] = useState('');
  const [courseActionScheduledUntil, setCourseActionScheduledUntil] = useState('');
  const [courseActionReason, setCourseActionReason] = useState('');
  const [courseActionBusy, setCourseActionBusy] = useState(false);
  interface NotificationItem {
    id: string;
    type: string;
    title: string;
    message: string;
    created_at: string;
    read: boolean;
    course_id?: string;
    course_title?: string;
    quiz_id?: string;
    student_name?: string;
  }
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [registerRole, setRegisterRole] = useState<'STUDENT' | 'INSTRUCTOR'>('STUDENT');

  async function registerExtraRole(newRole: 'STUDENT' | 'INSTRUCTOR') {
    if (!user) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await session.api.POST('/api/v1/auth/switch-role', {
        body: { role: newRole }
      });
      if (error) throw new Error(error.message ?? 'Chưa thể đăng ký vai trò mới.');
      if (data) {
        setUser(data);
        session.user = data;
        setActiveRoleMode(newRole);
        localStorage.setItem('active_role_mode', newRole);
        setMessage(`Đã đăng ký thêm vai trò ${newRole === 'INSTRUCTOR' ? 'Giảng viên' : 'Học viên'} thành công!`);
        void loadCourses();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Lỗi khi đăng ký vai trò.');
    } finally {
      setBusy(false);
    }
  }

  async function loadNotifications() {
    if (!session.user) return;
    try {
      const { data } = await session.api.GET('/api/v1/announcements/notifications', {});
      if (data && Array.isArray(data)) {
        setNotifications(data as NotificationItem[]);
      }
    } catch {
      // Bỏ qua lỗi kết nối
    }
  }

  async function markAllNotificationsRead() {
    try {
      await session.api.POST('/api/v1/announcements/mark-all-read', {});
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      // Bỏ qua lỗi
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadNotifications();
    const interval = setInterval(() => {
      void loadNotifications();
    }, 25000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
      setDarkMode(true);
    } else {
      document.documentElement.classList.remove('dark');
      setDarkMode(false);
    }
    const savedSidebar = localStorage.getItem('sidebar_open');
    if (savedSidebar === 'false') {
      setSidebarOpen(false);
    } else if (!savedSidebar && typeof window !== 'undefined' && window.innerWidth <= 900) {
      setSidebarOpen(false);
    }
  }, []);

  function toggleTheme() {
    setDarkMode(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      return next;
    });
  }

  function toggleSidebar() {
    setSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_open', String(next));
      return next;
    });
  }

  const activeAnnouncement = announcementsQueue[0] || null;

  async function checkAnnouncements() {
    try {
      const { data } = await session.api.GET('/api/v1/announcements/unread', {});
      if (data && Array.isArray(data) && data.length > 0) {
        setAnnouncementsQueue(data);
      }
    } catch {
      // Bỏ qua lỗi kết nối thông báo
    }
  }

  async function dismissActiveAnnouncement() {
    const current = announcementsQueue[0];
    if (!current) return;
    setAnnouncementsQueue(prev => prev.slice(1));
    try {
      await session.api.POST('/api/v1/announcements/{id}/read', {
        params: { path: { id: current.id } },
      });
    } catch {
      // Bỏ qua lỗi đánh dấu đã đọc
    }
  }

  useEffect(() => {
    if (!activeAnnouncement) return;
    setAnnouncementCountdown(10);
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const remaining = Math.max(0, Math.ceil(10 - elapsed));
      setAnnouncementCountdown(remaining);
      if (elapsed >= 10) {
        clearInterval(timer);
        void dismissActiveAnnouncement();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [activeAnnouncement?.id]);

  async function handleCourseActionSubmit() {
    if (!courseActionTarget) return;
    const isScheduled = courseActionApplyMode === 'scheduled';
    const isRange = courseActionApplyMode === 'range';
    const scheduledIso = (isScheduled || isRange) && courseActionScheduledAt ? new Date(courseActionScheduledAt).toISOString() : undefined;
    const scheduledUntilIso = isRange && courseActionScheduledUntil ? new Date(courseActionScheduledUntil).toISOString() : undefined;
    const trimmedReason = courseActionReason.trim() || undefined;
    const bodyPayload = {
      ...(scheduledIso ? { scheduled_at: scheduledIso } : {}),
      ...(scheduledUntilIso ? { scheduled_until: scheduledUntilIso } : {}),
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    };

    setCourseActionBusy(true);
    try {
      if (courseActionTarget.action === 'ARCHIVE') {
        const { error } = await session.api.POST('/api/v1/courses/{id}/archive', {
          params: { path: { id: courseActionTarget.course.id } },
          body: bodyPayload,
        });
        if (error) throw new Error(error.message);
        setMessage(
          isRange
            ? `Đã lên lịch lưu trữ khóa học từ ${new Date(courseActionScheduledAt).toLocaleString('vi-VN')} đến ${new Date(courseActionScheduledUntil).toLocaleString('vi-VN')}.`
            : isScheduled
            ? `Đã lên lịch lưu trữ khóa học vào ${new Date(courseActionScheduledAt).toLocaleString('vi-VN')}.`
            : 'Đã ngưng xuất bản / chuyển khóa học sang trạng thái lưu trữ.'
        );
      } else if (courseActionTarget.action === 'DELETE') {
        let res = await session.api.DELETE('/api/v1/courses/{id}', {
          params: { path: { id: courseActionTarget.course.id } },
          body: bodyPayload,
        });
        if (res.error) {
          res = await session.api.POST('/api/v1/courses/{id}/delete', {
            params: { path: { id: courseActionTarget.course.id } },
            body: bodyPayload,
          });
        }
        if (res.error) throw new Error(res.error.message ?? 'Chưa thể xóa khóa học.');
        setMessage(isScheduled ? `Đã lên lịch xóa khóa học vào ${new Date(courseActionScheduledAt).toLocaleString('vi-VN')}.` : 'Đã xóa khóa học thành công.');
      }
      setCourseActionTarget(null);
      await loadCourses();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi thực hiện thao tác.');
    } finally {
      setCourseActionBusy(false);
    }
  }

  async function loadCourses() {
    const result: Course[] = [];
    for (let offset = 0; offset <= 10000; offset += 100) {
      const { data, error } = await session.api.GET('/api/v1/courses', { params: { query: { limit: 100, offset } } });
      if (!data) throw new Error(error?.message ?? 'Chưa thể tải danh sách khóa học.'); result.push(...data); if (data.length < 100) break;
    }
    setCourses(result);
  }
  useEffect(() => {
    const unsubscribe = session.onClear((reason) => {
      setUser(null);
      setSelected(null);
      setIsCreatingCourse(false);
      setAdminView(false);
      setCourses([]);
      setAnnouncementsQueue([]);
      setNotificationsOpen(false);
      setProfileMenuOpen(false);
      if (reason) {
        setMessage(reason);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    void session.restore().then(async () => {
      if (active) {
        setUser(session.user);
        await loadCourses();
        if (session.user) void checkAnnouncements();

        // Kiểm tra query parameter ?course=... để tự động mở khóa học khi truy cập qua liên kết chia sẻ
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const courseParam = params.get('course');
          if (courseParam) {
            try {
              const res = await session.api.GET('/api/v1/courses/{id}', {
                params: { path: { id: courseParam } },
              });
              if (res.data && active) {
                setSelected(res.data as Course);
              }
            } catch {
              // Bỏ qua nếu không tìm thấy khóa học
            }
          }
        }
      }
    }).catch(() => {}).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); const data = new FormData(event.currentTarget);
    try {
      const credentials = { email: String(data.get('email')), password: String(data.get('password')) };
      if (mode === 'register') await session.register({ ...credentials, display_name: String(data.get('name')), role: registerRole }); else await session.login(credentials);
      setUser(session.user);
      await loadCourses();
      void checkAnnouncements();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể kết nối API.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage(''); setSelected(null); setUser(null); setCourses([]); setSearch(''); setFilter('all'); setAnnouncementsQueue([]); setIsCreatingCourse(false); setCourseActionTarget(null); setAdminView(false);
    try { await session.logout(); } catch { setMessage('Đã xóa phiên trên máy. Chưa xác nhận thu hồi trên server do lỗi kết nối.'); } finally { setBusy(false); }
  }
  async function toggleLike(courseId: string, event: React.MouseEvent) {
    event.stopPropagation();
    setCourses(prev => prev.map(c => {
      if (c.id !== courseId) return c;
      const nextLiked = !c.user_liked;
      const nextCount = nextLiked ? (c.like_count || 0) + 1 : Math.max(0, (c.like_count || 0) - 1);
      return { ...c, user_liked: nextLiked, like_count: nextCount };
    }));
    try {
      const { data, error } = await session.api.POST('/api/v1/courses/{id}/like', {
        params: { path: { id: courseId } },
      });
      if (error) {
        await loadCourses();
      } else if (data) {
        setCourses(prev => prev.map(c => c.id === courseId ? { ...c, user_liked: data.liked, like_count: data.total_likes } : c));
      }
    } catch {
      await loadCourses();
    }
  }

  const [activeRoleMode, setActiveRoleMode] = useState<'STUDENT' | 'INSTRUCTOR' | null>(null);

  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem('active_role_mode');
    if (saved === 'STUDENT' || saved === 'INSTRUCTOR') {
      setActiveRoleMode(saved);
    } else {
      setActiveRoleMode(user.roles.includes('INSTRUCTOR') ? 'INSTRUCTOR' : 'STUDENT');
    }
  }, [user]);

  async function toggleRoleMode() {
    if (!user) return;
    const current = activeRoleMode || (user.roles.includes('INSTRUCTOR') ? 'INSTRUCTOR' : 'STUDENT');
    const nextMode = current === 'INSTRUCTOR' ? 'STUDENT' : 'INSTRUCTOR';
    setActiveRoleMode(nextMode);
    localStorage.setItem('active_role_mode', nextMode);
    setSelected(null);
    setIsCreatingCourse(false);
    setFilter('all');
    try {
      const { data } = await session.api.POST('/api/v1/auth/switch-role', {
        body: { role: nextMode }
      });
      if (data) {
        setUser(data);
        session.user = data;
        void loadCourses();
      }
    } catch {
      // Local mode switch still succeeds
    }
  }

  const effectiveRole = activeRoleMode || (user?.roles.includes('INSTRUCTOR') ? 'INSTRUCTOR' : 'STUDENT');
  const instructor = effectiveRole === 'INSTRUCTOR';
  const isStudent = effectiveRole === 'STUDENT';
  const roleCourses = instructor && user
    ? courses.filter(c => c.owner_id === user.id)
    : courses.filter(c => {
        // Giảng viên xem khóa học do chính mình tạo
        if (c.owner_id === user?.id) return true;
        // Khóa học công khai: hiển thị cho tất cả
        if (!c.access_mode || c.access_mode === 'PUBLIC') return true;
        // Học viên đã tham gia / đăng ký khóa học: luôn hiển thị
        if (c.user_enrolled) return true;
        // Khóa học chỉ định: chỉ hiển thị nếu học viên được mời (email nằm trong allowed_emails)
        if (c.access_mode === 'RESTRICTED') {
          const userEmail = user?.email?.toLowerCase().trim();
          if (!userEmail) return false;
          return Array.isArray(c.allowed_emails) && c.allowed_emails.some((e: string) => e.toLowerCase().trim() === userEmail);
        }
        // Khóa học share link: ẩn khỏi Khám phá / Tất cả khóa học (chỉ hiện khi đã tham gia)
        if (c.access_mode === 'LINK') {
          return false;
        }
        return true;
      });
  const filtered = roleCourses
    .filter(c => {
      const q = search.trim().toLocaleLowerCase('vi');
      const matchesSearch = !q ||
        c.title.toLocaleLowerCase('vi').includes(q) ||
        (c.description && c.description.toLocaleLowerCase('vi').includes(q)) ||
        (c.tag ? c.tag.toLocaleLowerCase('vi').includes(q) : false);

      const matchesStatus =
        filter === 'all' ? true
        : filter === 'enrolled' ? Boolean(c.user_enrolled)
        : filter === 'liked' ? Boolean(c.user_liked)
        : c.status === filter;
      const matchesTag = tagFilter === 'all' || c.tag === tagFilter;
      const matchesStar = starFilter === 'all' || (c.avg_rating || 0) >= Number(starFilter);

      return matchesSearch && matchesStatus && matchesTag && matchesStar;
    })
    .sort((a, b) => {
      if (sortBy === 'rating') {
        const diff = (b.avg_rating || 0) - (a.avg_rating || 0);
        if (diff !== 0) return diff;
      } else if (sortBy === 'likes') {
        const diff = (b.like_count || 0) - (a.like_count || 0);
        if (diff !== 0) return diff;
      } else if (sortBy === 'reviews') {
        const diff = (b.review_count || 0) - (a.review_count || 0);
        if (diff !== 0) return diff;
      } else if (sortBy === 'name') {
        return a.title.localeCompare(b.title, 'vi');
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const brand = <a className="brand" href="/" aria-label="T16 trang chủ">T16 <span className="brand-caption">learning space</span></a>;
  return <div className={user ? ('app-shell' + (sidebarOpen ? '' : ' sidebar-collapsed')) : 'landing'}>
    <header>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {user && (
          <button
            type="button"
            className="hamburger-btn"
            onClick={toggleSidebar}
            aria-label="Thanh bên"
            title="Thanh bên"
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>
        )}
        {brand}
        {user && <span className="breadcrumb-divider">/</span>}
        {user && (
          <span className="breadcrumb">
            {selected ? 'Nội dung khóa học' : 'Khóa học'}
          </span>
        )}
      </div>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {user && (
          <div className="notification-bell-wrapper" style={{ position: 'relative', zIndex: notificationsOpen ? 10001 : 1 }}>
            <button
              type="button"
              className="notification-bell-btn"
              onClick={() => {
                setNotificationsOpen(prev => !prev);
                if (!notificationsOpen) void loadNotifications();
              }}
              title="Thông báo hệ thống và khóa học"
              aria-label="Thông báo"
              style={{
                background: notificationsOpen ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                position: 'relative',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notifications.filter(n => !n.read).length > 0 && (
                <span
                  className="notification-badge"
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    background: '#dc2626',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 700,
                    minWidth: '16px',
                    height: '16px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                    lineHeight: 1,
                    boxShadow: '0 0 4px rgba(220, 38, 38, 0.6)',
                  }}
                >
                  {notifications.filter(n => !n.read).length > 9 ? '9+' : notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <>
                <div
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
                  onClick={() => setNotificationsOpen(false)}
                />
                <div
                  className="notification-popover"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: '380px',
                    maxWidth: '90vw',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
                    zIndex: 10000,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    className="notification-popover-header"
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--bg-elevated)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Thông báo</h4>
                      {notifications.filter(n => !n.read).length > 0 && (
                        <span className="badge" style={{ fontSize: '11px', background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', border: '1px solid #dc2626' }}>
                          {notifications.filter(n => !n.read).length} mới
                        </span>
                      )}
                    </div>
                    {notifications.filter(n => !n.read).length > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: '12px', padding: 0, color: 'var(--green)', fontWeight: 600 }}
                        onClick={() => void markAllNotificationsRead()}
                      >
                        Đánh dấu tất cả đã đọc
                      </button>
                    )}
                  </div>

                  <div
                    className="notification-popover-list"
                    style={{
                      maxHeight: '420px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {notifications.length === 0 ? (
                      <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        Chưa có thông báo nào.
                      </div>
                    ) : (
                      notifications.map(item => (
                        <div
                          key={item.id}
                          className={'notification-item' + (!item.read ? ' unread' : '')}
                          onClick={() => {
                            if (item.course_id) {
                              const c = courses.find(x => x.id === item.course_id);
                              if (c) {
                                setSelected(c);
                                setNotificationsOpen(false);
                              }
                            }
                          }}
                          style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border-color)',
                            cursor: item.course_id ? 'pointer' : 'default',
                            background: !item.read ? 'rgba(33, 99, 79, 0.07)' : 'transparent',
                            transition: 'background 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <span
                              className="badge"
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                background:
                                  item.type === 'SYSTEM'
                                    ? 'rgba(37, 99, 235, 0.12)'
                                    : item.type === 'SUBMISSION'
                                    ? 'rgba(217, 119, 6, 0.12)'
                                    : 'rgba(33, 99, 79, 0.12)',
                                color:
                                  item.type === 'SYSTEM'
                                    ? '#2563eb'
                                    : item.type === 'SUBMISSION'
                                    ? '#d97706'
                                    : 'var(--green)',
                              }}
                            >
                              {item.type === 'SYSTEM' ? 'Hệ thống' : item.type === 'SUBMISSION' ? 'Bài nộp học viên' : 'Bài học mới'}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {new Date(item.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                            </span>
                          </div>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '2px' }}>
                            {item.title}
                          </strong>
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                            {item.message}
                          </p>
                          {item.course_id && (
                            <span style={{ fontSize: '11px', color: 'var(--green)', marginTop: '2px', fontWeight: 500, textDecoration: 'underline' }}>
                              Mở khóa học &gt;&gt;
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        <span className="badge">Bản thử nghiệm</span>
        {user && (
          <div className="profile-menu-wrapper" style={{ position: 'relative', zIndex: profileMenuOpen ? 10001 : 1 }}>
            <button
              type="button"
              className="avatar-header-btn"
              onClick={() => {
                setProfileMenuOpen(prev => !prev);
                setNotificationsOpen(false);
              }}
              title="Menu tài khoản: Đổi vai trò, Dark mode, Đăng xuất"
              aria-label="Tài khoản cá nhân"
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: 'var(--green)',
                color: '#ffffff',
                border: '2px solid var(--border-color)',
                fontWeight: 700,
                fontSize: '15px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                boxShadow: profileMenuOpen ? '0 0 0 3px rgba(33, 99, 79, 0.3)' : 'none',
              }}
            >
              {user.display_name.slice(0, 1).toUpperCase()}
            </button>

            {profileMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
                  onClick={() => setProfileMenuOpen(false)}
                />
                <div
                  className="profile-popover"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 10px)',
                    right: 0,
                    width: '310px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
                    zIndex: 10000,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '16px',
                    gap: '12px',
                  }}
                >
                  {/* User info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: 'var(--green)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '17px',
                        flexShrink: 0,
                      }}
                    >
                      {user.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.display_name}
                      </strong>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.email}
                      </span>
                      <span
                        className="badge"
                        style={{
                          marginTop: '4px',
                          display: 'inline-block',
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: instructor ? 'rgba(217, 119, 6, 0.12)' : 'rgba(33, 99, 79, 0.12)',
                          color: instructor ? '#d97706' : 'var(--green)',
                          fontWeight: 600,
                        }}
                      >
                        Đang ở chế độ: {instructor ? 'Giảng viên' : 'Học viên'}
                      </span>
                    </div>
                  </div>

                  {/* Vai trò & Chuyển đổi vai trò / Đăng ký thêm */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Vai trò tài khoản
                    </span>

                    {/* Nếu có cả 2 vai trò: nút chuyển đổi */}
                    {user.roles.includes('INSTRUCTOR') && user.roles.includes('STUDENT') && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          void toggleRoleMode();
                        }}
                        style={{
                          width: '100%',
                          fontSize: '13px',
                          padding: '8px 12px',
                          justifyContent: 'center',
                          borderRadius: '8px',
                          fontWeight: 600,
                        }}
                      >
                        Chuyển sang chế độ {instructor ? 'Học viên' : 'Giảng viên'}
                      </button>
                    )}

                    {/* Nếu chỉ có 1 vai trò: nút đăng ký thêm vai trò còn thiếu */}
                    {!user.roles.includes('INSTRUCTOR') && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          void registerExtraRole('INSTRUCTOR');
                        }}
                        style={{
                          width: '100%',
                          fontSize: '13px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          fontWeight: 600,
                          borderColor: 'var(--green)',
                          color: 'var(--green)',
                        }}
                        title="Đăng ký thêm quyền Giảng viên để tạo và xuất bản khóa học"
                      >
                        + Đăng ký làm Giảng viên
                      </button>
                    )}

                    {!user.roles.includes('STUDENT') && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          void registerExtraRole('STUDENT');
                        }}
                        style={{
                          width: '100%',
                          fontSize: '13px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          fontWeight: 600,
                          borderColor: 'var(--green)',
                          color: 'var(--green)',
                        }}
                        title="Đăng ký thêm quyền Học viên để tham gia học các khóa học"
                      >
                        + Đăng ký làm Học viên
                      </button>
                    )}
                  </div>

                  {/* Dark Mode toggle inside popover */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderTop: '1px solid var(--border-color)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      Chế độ tối
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={darkMode}
                      className="switch-control"
                      onClick={toggleTheme}
                      style={{ margin: 0 }}
                      title={darkMode ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}
                    >
                      <span className={`switch-track ${darkMode ? 'active' : ''}`} aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                    </button>
                  </div>

                  {/* Logout button */}
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void logout();
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      textAlign: 'center',
                      borderRadius: '8px',
                      border: '1px solid rgba(220, 38, 38, 0.3)',
                      color: '#dc2626',
                      fontWeight: 600,
                    }}
                  >
                    Đăng xuất
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
    {user ? (
      <div className={'app-layout' + (sidebarOpen ? '' : ' sidebar-collapsed')}>
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}
        <aside className={'sidebar' + (sidebarOpen ? '' : ' collapsed')}>
          <p className="eyebrow" style={{ marginTop: '10px' }}>KHÔNG GIAN CỦA BẠN</p>
          {isStudent ? (
            <>
              <button
                className={filter === 'all' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('all'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Tất cả khóa học</span>
              </button>
              <button
                className={filter === 'enrolled' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('enrolled'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Đang học</span>
              </button>
              <button
                className={filter === 'liked' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('liked'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Yêu thích</span>
              </button>
            </>
          ) : instructor ? (
            <>
              <button
                className={filter === 'all' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('all'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Khóa học</span>
              </button>
              <button
                className={filter === 'DRAFT' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('DRAFT'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Bản nháp của tôi</span>
              </button>
            </>
          ) : (
            <>
              <button
                className={filter === 'all' && !selected && !isCreatingCourse ? 'nav-active' : ''}
                onClick={() => { setSelected(null); setIsCreatingCourse(false); setFilter('all'); if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false); }}
              >
                <span>Tất cả khóa học</span>
              </button>
            </>
          )}
          <div
            className="profile profile-clickable"
            onClick={() => void toggleRoleMode()}
            role="button"
            tabIndex={0}
            title={`Nhấn vào đây để chuyển sang chế độ ${instructor ? 'Học viên' : 'Giảng viên'}`}
            style={{ cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', padding: '12px 10px', borderRadius: '10px' }}
          >
            <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '13px' }}>
                {user.display_name}
              </strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Vai trò: {instructor ? 'Giảng viên' : 'Học viên'}
                </span>
                <span
                  className="badge role-switch-badge"
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    background: 'var(--green-light)',
                    color: 'var(--green)',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: '1px solid var(--green)',
                    alignSelf: 'flex-start',
                  }}
                >
                  {instructor ? 'Chuyển sang Học viên' : 'Chuyển sang Giảng viên'}
                </span>
              </div>
            </div>
          </div>
        </aside>
        <main>
          {activeAnnouncement && (
            <div className="announcement-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
              <div className="announcement-modal-card">
                <div className="announcement-modal-header">
                  <div>
                    <span className="eyebrow" style={{ margin: 0, color: 'var(--accent-color)' }}>THÔNG BÁO TỪ QUẢN TRỊ VIÊN</span>
                    <h3 id="announcement-title" style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 700 }}>
                      {activeAnnouncement.title}
                    </h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {announcementsQueue.length > 1 && (
                      <span className="badge" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', fontSize: '12px', fontWeight: 600 }}>
                        Thông báo 1 / {announcementsQueue.length}
                      </span>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      style={{ fontSize: '16px', lineHeight: 1, padding: '4px 8px', color: 'var(--text-muted)', cursor: 'pointer' }}
                      onClick={() => void dismissActiveAnnouncement()}
                      title="Đóng thông báo này"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="announcement-modal-body">
                  <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.65, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {activeAnnouncement.message}
                  </p>
                </div>

                <div className="announcement-modal-footer">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Người gửi: <strong>{activeAnnouncement.created_by_name || 'Quản trị viên'}</strong></span>
                    {activeAnnouncement.created_at && (
                      <span style={{ marginLeft: '12px' }}>
                        {new Date(activeAnnouncement.created_at).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '8px', cursor: 'pointer' }}
                      onClick={() => void dismissActiveAnnouncement()}
                    >
                      Đóng luôn
                    </button>
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: '8px 20px', fontSize: '13px', borderRadius: '8px', cursor: 'pointer' }}
                      onClick={() => void dismissActiveAnnouncement()}
                    >
                      {announcementsQueue.length > 1 ? `Đọc tiếp (${announcementCountdown}s)` : `Tự động đóng (${announcementCountdown}s)`}
                    </button>
                  </div>
                </div>

                <div className="announcement-progress-bar" style={{ width: `${(announcementCountdown / 10) * 100}%` }} />
              </div>
            </div>
          )}
          {user?.roles.includes('ADMIN') && (
            <button
              className="secondary"
              onClick={() => {
                setAdminView(v => {
                  const next = !v;
                  if (!next) void loadCourses();
                  return next;
                });
              }}
            >
              {adminView ? 'Mở thư viện khóa học' : 'Quản lý tài khoản và vận hành'}
            </button>
          )}
          {message && <p role="alert" className="notice">{message}</p>}
          {adminView&&user.roles.includes('ADMIN') ? <AdminPanel/> : isCreatingCourse ? (
            <CourseCreator
              onBack={() => setIsCreatingCourse(false)}
              onCreated={(newCourse) => {
                setSelected(newCourse);
                setIsCreatingCourse(false);
                void loadCourses();
              }}
            />
          ) : selected ? <CourseEditor key={`${user.id}-${selected.id}`} initial={selected} isInstructorMode={instructor} onBack={() => { setSelected(null); void loadCourses().catch(() => setMessage('Chưa tải lại được danh sách.')); }} onChange={loadCourses} />
            : <><section className="dashboard-intro"><div><p className="eyebrow">{instructor ? 'CÙNG LAN TỎA KIẾN THỨC' : 'HÔM NAY BẠN MUỐN HỌC GÌ?'}</p><h1>Xin chào, {user.display_name}</h1><p>{instructor ? 'Biến kiến thức của bạn thành những bài giảng đáng nhớ.' : 'Khám phá khóa học và bắt đầu với điều bạn yêu thích.'}</p></div></section><section className="welcome-banner"><div><span className="eyebrow">{instructor ? 'BÀI GIẢNG CỦA BẠN' : 'KHÔNG GIAN HỌC TẬP'}</span><h2>{instructor ? 'Từ ý tưởng đến bài học đầu tiên.' : 'Học theo nhịp của riêng bạn.'}</h2><p>{instructor ? 'Tạo khóa học, thêm video và chia sẻ với học viên.' : 'Mở khóa học để đăng ký và xem bài giảng.'}</p></div></section>
        {instructor && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '24px' }}>
            <button
              type="button"
              className="primary"
              onClick={() => setIsCreatingCourse(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 22px', fontSize: '14px', fontWeight: 600, borderRadius: '8px' }}
            >
              <span>Tạo khóa học mới</span>
            </button>
          </div>
        )}
        <section className="catalog">
          <div className="catalog-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            <div className="row catalog-title">
              <h2 style={{ margin: 0 }}>
                {instructor ? 'Khóa học của tôi' : 'Khám phá khóa học'} <span className="count">{filtered.length} / {roleCourses.length}</span>
              </h2>
              <div className="catalog-controls">
                <label className="search" style={{ flex: '2 1 180px', minWidth: '150px', margin: 0 }}>
                  <span className="sr-only">Tìm khóa học</span>
                  <input placeholder="Tìm tên, chủ đề…" value={search} onChange={event => setSearch(event.target.value)} style={{ width: '100%' }} />
                </label>
                <select
                  value={tagFilter}
                  onChange={e => setTagFilter(e.target.value)}
                  style={{ flex: '1 1 130px', height: '40px', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '0 8px', fontSize: '13px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                  title="Lọc theo tag chủ đề"
                >
                  <option value="all">Tất cả chủ đề</option>
                  {COURSE_TAGS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={starFilter}
                  onChange={e => setStarFilter(e.target.value)}
                  style={{ flex: '1 1 125px', height: '40px', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '0 8px', fontSize: '13px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                  title="Lọc theo số sao"
                >
                  <option value="all">Tất cả sao</option>
                  <option value="4.5">Từ 4.5 sao trở lên</option>
                  <option value="4.0">Từ 4.0 sao trở lên</option>
                  <option value="3.0">Từ 3.0 sao trở lên</option>
                </select>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  style={{ flex: '1 1 135px', height: '40px', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '0 8px', fontSize: '13px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                  title="Sắp xếp danh sách"
                >
                  <option value="newest">Mới nhất</option>
                  <option value="rating">Đánh giá cao nhất</option>
                  <option value="likes">Yêu thích nhất</option>
                  <option value="reviews">Nhiều nhận xét nhất</option>
                  <option value="name">Tên A-Z</option>
                </select>
              </div>
            </div>
            <div className="filters" style={{ margin: 0 }}>
              {isStudent && !user.roles.includes('ADMIN') ? (
                [['all', 'Tất cả'], ['enrolled', 'Đang học'], ['liked', 'Yêu thích']].map(([value, label]) => (
                  <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>
                    {label}
                  </button>
                ))
              ) : (
                [['all','Tất cả'],['DRAFT','Bản nháp'],['PUBLISHED','Đã xuất bản'],['ARCHIVED','Lưu trữ']]
                  .filter(([value]) => (instructor && !user.roles.includes('ADMIN')) || value !== 'DRAFT')
                  .map(([value,label]) => (
                    <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>
                      {label}
                    </button>
                  ))
              )}
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <h3>{search || tagFilter !== 'all' || starFilter !== 'all' ? 'Chưa tìm thấy khóa học phù hợp' : 'Một thư viện mới đang bắt đầu'}</h3>
              <p>{instructor ? 'Tạo bản nháp đầu tiên để bắt đầu thêm bài giảng.' : 'Các khóa học sẽ xuất hiện khi được giảng viên xuất bản.'}</p>
            </div>
          ) : (
            <ul className="courses">
              {filtered.map((course, index) => (
                <li key={course.id}>
                  {course.thumbnail_url ? (
                    <div className="course-cover custom-cover" style={{ height: '160px', width: '100%', position: 'relative', overflow: 'hidden' }}>
                      <img
                        src={course.thumbnail_url}
                        alt={course.title}
                        className="cover-img"
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                      />
                      <div className="cover-overlay" style={{ position: 'absolute', inset: 0, padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.65) 100%)', pointerEvents: 'none' }}>
                        <span className="cover-number" style={{ color: '#fff' }}>T16 / {String(index + 1).padStart(2,'0')}</span>
                        <span className="cover-label" style={{ color: '#fff' }}>HỌC HỎI MỖI NGÀY</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`course-cover cover-${index % 3}`}>
                      <span className="cover-number">T16 / {String(index + 1).padStart(2,'0')}</span>
                      <span className="cover-label">HỌC HỎI MỖI NGÀY</span>
                    </div>
                  )}
                  <div className="course-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {course.is_locked ? (
                          <span className="badge danger" style={{ background: '#dc2626', color: '#fff', fontWeight: 700, border: '1px solid #b91c1c' }}>
                            Đang bị khóa
                          </span>
                        ) : (
                          <span className={`badge ${course.status === 'PUBLISHED' ? 'ready' : ''}`}>
                            {course.status === 'DRAFT' ? 'Bản nháp' : course.status === 'PUBLISHED' ? 'Đã xuất bản' : 'Lưu trữ'}
                          </span>
                        )}
                        <span className="badge tag-badge">
                          {course.tag || 'CNTT & Phần mềm'}
                        </span>
                        {(course.access_mode === 'LINK' || course.access_mode === 'RESTRICTED') && (
                          <span
                            className="badge"
                            style={{
                              background: course.access_mode === 'LINK' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)',
                              color: course.access_mode === 'LINK' ? '#2563eb' : '#9333ea',
                              border: `1px solid ${course.access_mode === 'LINK' ? '#93c5fd' : '#d8b4fe'}`,
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {course.access_mode === 'LINK' ? 'Chia sẻ link' : 'Chỉ định học viên'}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px' }}>
                        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }} title={`Đánh giá trung bình: ${course.avg_rating || 0}/5 (${course.review_count || 0} nhận xét)`}>
                          <span style={{ color: '#f59e0b', letterSpacing: '1px' }}>
                            {'★'.repeat(Math.round(course.avg_rating || 5))}
                            <span style={{ color: 'var(--border-color)' }}>
                              {'★'.repeat(5 - Math.min(5, Math.round(course.avg_rating || 5)))}
                            </span>
                          </span>
                          <small style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({course.review_count || 0})</small>
                        </span>
                        {(isStudent || !user.roles.includes('ADMIN')) && (
                          <button
                            type="button"
                            onClick={(e) => void toggleLike(course.id, e)}
                            className="secondary"
                            style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', cursor: 'pointer' }}
                            title={course.user_liked ? 'Bỏ thích khóa học' : 'Yêu thích khóa học'}
                          >
                            <span>{course.user_liked ? 'Đã thích' : 'Thích'}</span> <strong>{course.like_count || 0}</strong>
                          </button>
                        )}
                      </div>
                    </div>
                    <h3>{course.title}</h3>
                    <p>{course.description || (course.owner_id === user.id ? 'Thêm nội dung và hoàn thiện khóa học của bạn.' : 'Khám phá nội dung và bắt đầu học.')}</p>
                    {course.action_reason && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: '4px', marginTop: '6px', borderLeft: '3px solid var(--accent-color)' }}>
                        <strong>Lý do điều chỉnh: </strong>{course.action_reason}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                      <button className="course-open" style={{ border: 0, padding: 0, marginTop: 0 }} onClick={() => setSelected(course)}>
                        {course.owner_id === user.id && instructor ? (course.is_locked ? 'Xem khóa học (Đang bị khóa)' : 'Quản lý bài giảng') : 'Mở khóa học'}
                      </button>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {(course.owner_id === user.id && instructor && !course.is_locked) && course.status === 'PUBLISHED' && (
                          <button
                            type="button"
                            className="text-button"
                            style={{ color: '#d97706', fontSize: '11px', padding: '0 4px', whiteSpace: 'nowrap' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCourseActionTarget({ course, action: 'ARCHIVE' });
                              setCourseActionApplyMode('immediate');
                              setCourseActionScheduledAt('');
                              setCourseActionScheduledUntil('');
                              setCourseActionReason('');
                            }}
                            title="Ngừng xuất bản / Lưu trữ khóa học"
                          >
                            Ngừng xuất bản
                          </button>
                        )}
                        {(course.owner_id === user.id && instructor && !course.is_locked) && (
                          <button
                            type="button"
                            className="text-button"
                            style={{ color: '#dc2626', fontSize: '11px', padding: '0 4px', whiteSpace: 'nowrap' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCourseActionTarget({ course, action: 'DELETE' });
                              setCourseActionApplyMode('immediate');
                              setCourseActionScheduledAt('');
                              setCourseActionScheduledUntil('');
                              setCourseActionReason('');
                            }}
                            title="Xóa khóa học này"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section></>}
        <footer>T16 Learning Space <span>·</span> Cùng nhau học điều mới mỗi ngày.</footer>
      </main>
    </div>
    ) : (
      <main>
        {message && <p role="alert" className="notice">{message}</p>}
        <div className="login-grid">
          <section className="intro">
            <p className="eyebrow">HỌC TẬP · KẾT NỐI · KHÁM PHÁ</p>
            <h1>Mỗi bài học,<br />một điều <em>mới.</em></h1>
            <p>Một không gian để chia sẻ bài giảng,<br />nuôi dưỡng sự tò mò và cùng nhau tiến bộ.</p>
          </section>
          <section className="panel auth">
            <span className="eyebrow">CHÀO BẠN ĐẾN VỚI T16</span>
            <h2>{mode === 'login' ? 'Chào mừng bạn trở lại' : 'Bắt đầu hành trình học'}</h2>
            <p>{mode === 'login' ? 'Tiếp tục hành trình học tập của bạn.' : 'Tài khoản mới được tạo với vai trò học viên.'}</p>
            <form onSubmit={authenticate}>
              {mode === 'register' && (
                <>
                  <label>Họ và tên<input name="name" autoComplete="name" required maxLength={100} /></label>
                  <div style={{ margin: '10px 0 6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                      Đăng ký với vai trò:
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <label
                        className="modal-radio-label"
                        style={{
                          margin: 0,
                          padding: '10px 12px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: registerRole === 'STUDENT' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>Học viên</span>
                        <input
                          type="radio"
                          name="reg_role"
                          value="STUDENT"
                          checked={registerRole === 'STUDENT'}
                          onChange={() => setRegisterRole('STUDENT')}
                          style={{ margin: 0 }}
                        />
                      </label>
                      <label
                        className="modal-radio-label"
                        style={{
                          margin: 0,
                          padding: '10px 12px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: registerRole === 'INSTRUCTOR' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>Giảng viên</span>
                        <input
                          type="radio"
                          name="reg_role"
                          value="INSTRUCTOR"
                          checked={registerRole === 'INSTRUCTOR'}
                          onChange={() => setRegisterRole('INSTRUCTOR')}
                          style={{ margin: 0 }}
                        />
                      </label>
                    </div>
                  </div>
                </>
              )}
              <label>Email<input name="email" type="email" placeholder="ban@example.com" autoComplete="email" required /></label>
              <label>Mật khẩu<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={12} maxLength={128} required /></label>
              <button disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
            </form>
            <button className="text-button" disabled={busy} onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
            </button>
          </section>
        </div>
        <footer>T16 Learning Space <span>·</span> Cùng nhau học điều mới mỗi ngày.</footer>
      </main>
    )}
    {courseActionTarget && (
      <div className="modal-backdrop" style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        padding: '20px'
      }}>
        <div className="modal-content panel" style={{
          maxWidth: '500px', width: '100%', background: 'var(--bg-surface)',
          borderRadius: '12px', border: '1px solid var(--border-color)',
          padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)'
        }}>
          <h3 style={{ margin: '0 0 8px' }}>
            {courseActionTarget.action === 'ARCHIVE' ? 'Ngưng xuất bản / Lưu trữ khóa học' : 'Xóa khóa học'}
          </h3>
          <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            {courseActionTarget.action === 'ARCHIVE'
              ? `Khóa học "${courseActionTarget.course.title}" sẽ chuyển sang trạng thái Lưu trữ. Bạn có thể chọn ngưng ngay hoặc lên lịch theo khoảng thời gian.`
              : `Bạn có chắc muốn xóa khóa học "${courseActionTarget.course.title}"? Thao tác có thể áp dụng ngay hoặc lên lịch kèm lý do.`}
          </p>

          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <label
              className="modal-radio-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: courseActionApplyMode === 'immediate' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Áp dụng ngay lập tức</span>
              <input
                type="radio"
                name="cardActionApplyMode"
                value="immediate"
                checked={courseActionApplyMode === 'immediate'}
                onChange={() => setCourseActionApplyMode('immediate')}
                style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
              />
            </label>

            <label
              className="modal-radio-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: courseActionApplyMode === 'scheduled' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Lên lịch theo ngày giờ</span>
              <input
                type="radio"
                name="cardActionApplyMode"
                value="scheduled"
                checked={courseActionApplyMode === 'scheduled'}
                onChange={() => {
                  setCourseActionApplyMode('scheduled');
                  if (!courseActionScheduledAt) {
                    const d = new Date(Date.now() + 3600 * 1000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setCourseActionScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }
                }}
                style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
              />
            </label>

            {courseActionTarget.action !== 'DELETE' && (
            <label
              className="modal-radio-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: courseActionApplyMode === 'range' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Áp dụng từ ngày nào đến ngày nào</span>
              <input
                type="radio"
                name="cardActionApplyMode"
                value="range"
                checked={courseActionApplyMode === 'range'}
                onChange={() => {
                  setCourseActionApplyMode('range');
                  if (!courseActionScheduledAt) {
                    const d = new Date(Date.now() + 3600 * 1000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setCourseActionScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }
                  if (!courseActionScheduledUntil) {
                    const d2 = new Date(Date.now() + 7 * 86400 * 1000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setCourseActionScheduledUntil(`${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}T${pad(d2.getHours())}:${pad(d2.getMinutes())}`);
                  }
                }}
                style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
              />
            </label>
          )}

            {courseActionApplyMode === 'scheduled' && (
              <div style={{ paddingLeft: '24px' }}>
                <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>
                  Chọn thời gian áp dụng:
                  <input
                    type="datetime-local"
                    value={courseActionScheduledAt}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={(e) => setCourseActionScheduledAt(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', marginTop: '4px' }}
                  />
                </label>
                <small style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  Hệ thống sẽ tự động thực hiện thao tác khi đến thời gian đã chọn.
                </small>
              </div>
            )}

            {courseActionApplyMode === 'range' && courseActionTarget.action !== 'DELETE' && (
              <div style={{ paddingLeft: '24px', display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '13px', display: 'block' }}>
                  Từ ngày giờ:
                  <input
                    type="datetime-local"
                    value={courseActionScheduledAt}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={(e) => setCourseActionScheduledAt(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', marginTop: '4px' }}
                  />
                </label>
                <label style={{ fontSize: '13px', display: 'block' }}>
                  Đến ngày giờ (tự động phục hồi xuất bản khi hết hạn):
                  <input
                    type="datetime-local"
                    value={courseActionScheduledUntil}
                    min={courseActionScheduledAt || new Date().toISOString().slice(0, 16)}
                    onChange={(e) => setCourseActionScheduledUntil(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', marginTop: '4px' }}
                  />
                </label>
                <small style={{ color: 'var(--text-muted)' }}>
                  Khóa học sẽ áp dụng từ ngày bắt đầu và tự động phục hồi khi đến ngày kết thúc.
                </small>
              </div>
            )}

            <label style={{ fontSize: '13px', display: 'block', marginTop: '8px' }}>
              Thông báo kèm lý do thực hiện (tùy chọn):
              <textarea
                rows={3}
                value={courseActionReason}
                onChange={(e) => setCourseActionReason(e.target.value)}
                placeholder="Nhập lý do ngưng xuất bản hoặc xóa khóa học để thông báo cho học viên..."
                style={{ width: '100%', padding: '8px 12px', marginTop: '4px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="secondary"
              disabled={courseActionBusy}
              onClick={() => setCourseActionTarget(null)}
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              className={courseActionTarget.action === 'DELETE' ? 'danger' : 'warning'}
              disabled={courseActionBusy || (courseActionApplyMode === 'scheduled' && !courseActionScheduledAt) || (courseActionApplyMode === 'range' && (!courseActionScheduledAt || !courseActionScheduledUntil))}
              onClick={() => void handleCourseActionSubmit()}
            >
              {courseActionBusy ? 'Đang xử lý…' : courseActionTarget.action === 'DELETE' ? 'Xác nhận Xóa' : 'Xác nhận Lưu trữ'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>;
}
