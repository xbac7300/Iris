'use client';
import { useEffect, useState } from 'react';
import type { components } from '@lms/api-client';
import { session } from './session';

type AdminUser = components['schemas']['AdminUserDto'];
type Usage = components['schemas']['UsageDto'];
type Announcement = components['schemas']['AnnouncementDto'];

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Announcement state
  const [annTitle, setAnnTitle] = useState('');
  const [annMessage, setAnnMessage] = useState('');
  const [annTarget, setAnnTarget] = useState<'ALL' | 'INSTRUCTOR' | 'STUDENT' | 'USER'>('ALL');
  const [annTargetUser, setAnnTargetUser] = useState('');

  // Lock user modal state
  const [lockingUser, setLockingUser] = useState<AdminUser | null>(null);
  const [lockMode, setLockMode] = useState<'indefinite' | 'days' | 'range'>('indefinite');
  const [lockDays, setLockDays] = useState(7);
  const [lockFrom, setLockFrom] = useState('');
  const [lockUntil, setLockUntil] = useState('');
  const [lockReason, setLockReason] = useState('');

  // Course complaints state
  const [complaints, setComplaints] = useState<any[]>([]);
  const [resolvingComplaint, setResolvingComplaint] = useState<any | null>(null);
  const [resolveAction, setResolveAction] = useState<'CLOSE_COURSE' | 'DISMISS'>('CLOSE_COURSE');
  const [resolveNotes, setResolveNotes] = useState('');

  // Locked courses state
  const [lockedCourses, setLockedCourses] = useState<any[]>([]);

  // Collapse/Expand state for long sections
  const [showComplaints, setShowComplaints] = useState(true);
  const [showLockedCourses, setShowLockedCourses] = useState(true);
  const [showAnnouncements, setShowAnnouncements] = useState(true);
  const [showUsers, setShowUsers] = useState(true);
  const [userSearch, setUserSearch] = useState('');

  const filteredUsers = users.filter(u => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    const matchName = u.display_name.toLowerCase().includes(q);
    const matchEmail = u.email.toLowerCase().includes(q);
    const matchRole = u.roles.some(r => {
      const lowerR = r.toLowerCase();
      if (lowerR.includes(q)) return true;
      if (r === 'STUDENT' && ('học viên'.includes(q) || 'hoc vien'.includes(q))) return true;
      if (r === 'INSTRUCTOR' && ('giảng viên'.includes(q) || 'giang vien'.includes(q))) return true;
      if (r === 'ADMIN' && ('quản trị'.includes(q) || 'quan tri'.includes(q))) return true;
      return false;
    });
    const matchStatus = u.disabled
      ? ('đã khóa'.includes(q) || 'khoa'.includes(q) || (u.disabled_reason && u.disabled_reason.toLowerCase().includes(q)))
      : ('đang hoạt động'.includes(q) || 'hoat dong'.includes(q));
    return matchName || matchEmail || matchRole || matchStatus;
  });

  async function load(offset = page) {
    const [u, s, a, comp, locked] = await Promise.all([
      session.api.GET('/api/v1/admin/users', { params: { query: { limit: 20, offset: offset * 20 } } }),
      session.api.GET('/api/v1/admin/users/usage'),
      session.api.GET('/api/v1/admin/announcements'),
      (session.api.GET as any)('/api/v1/admin/complaints', {}),
      (session.api.GET as any)('/api/v1/admin/locked-courses', {}),
    ]);
    if (u.data) setUsers(u.data);
    if (s.data) setUsage(s.data);
    if (a.data) setAnnouncements(a.data);
    if (comp.data) setComplaints(comp.data);
    if (locked.data) setLockedCourses(locked.data);
  }

  async function handleUnlockCourse(courseId: string, title: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn gỡ khóa cho khóa học "${title}"? Khóa học sẽ được chuyển lại trạng thái Đã xuất bản và giảng viên có thể tương tác bình thường.`)) return;
    await act(async () => {
      const res = await session.api.POST('/api/v1/admin/courses/{id}/unlock' as any, {
        params: { path: { id: courseId } },
      });
      if (res.error) throw new Error((res.error as any).message ?? 'Không thể mở khóa khóa học.');
      setMessage(`Đã gỡ khóa thành công cho khóa học "${title}".`);
    });
  }

  async function handleResolveComplaint(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvingComplaint) return;
    await act(async () => {
      const res = await session.api.POST('/api/v1/admin/complaints/{id}/resolve' as any, {
        params: { path: { id: resolvingComplaint.id } },
        body: {
          action: resolveAction,
          admin_notes: resolveNotes.trim(),
        },
      });
      if (res.error) throw new Error((res.error as any).message ?? 'Không thể xử lý khiếu nại.');
      setMessage(resolveAction === 'CLOSE_COURSE' ? 'Đã đóng khóa học theo khiếu nại của học viên.' : 'Đã bác bỏ khiếu nại.');
      setResolvingComplaint(null);
      setResolveNotes('');
    });
  }

  useEffect(() => {
    void load(page).catch(() => setMessage('Không tải được dữ liệu quản trị.'));
  }, [page]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Thao tác chưa thành công.');
    } finally {
      setBusy(false);
    }
  }

  async function sendAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim()) return;
    if (annTarget === 'USER' && !annTargetUser) {
      setMessage('Vui lòng chọn người dùng nhận thông báo.');
      return;
    }

    await act(async () => {
      const res = await session.api.POST('/api/v1/admin/announcements', {
        body: {
          title: annTitle.trim(),
          message: annMessage.trim(),
          target_type: annTarget,
          target_user_id: annTarget === 'USER' ? annTargetUser : undefined,
        },
      });
      if (res.error) throw new Error(res.error.message ?? 'Không thể gửi thông báo.');
      setAnnTitle('');
      setAnnMessage('');
      setAnnTarget('ALL');
      setAnnTargetUser('');
      setMessage('Đã phát thông báo thành công!');
    });
  }

  async function deleteAnnouncement(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa thông báo này?')) return;
    await act(async () => {
      const res = await session.api.DELETE('/api/v1/admin/announcements/{id}', {
        params: { path: { id } },
      });
      if (res.error) throw new Error(res.error.message ?? 'Không thể xóa thông báo.');
      setMessage('Đã xóa thông báo.');
    });
  }

  async function submitLockUser(e: React.FormEvent) {
    e.preventDefault();
    if (!lockingUser) return;

    let computedUntil: string | undefined = undefined;
    if (lockMode === 'days') {
      const d = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
      computedUntil = d.toISOString();
    } else if (lockMode === 'range') {
      if (!lockUntil) {
        setMessage('Vui lòng chọn ngày kết thúc khóa.');
        return;
      }
      computedUntil = new Date(lockUntil).toISOString();
    }

    await act(async () => {
      const res = await session.api.POST('/api/v1/admin/users/{id}/status', {
        params: { path: { id: lockingUser.id } },
        body: {
          disabled: true,
          disabled_until: computedUntil,
          reason: lockReason.trim() || undefined,
        },
      });
      if (res.error) throw new Error(res.error.message ?? 'Không thể khóa tài khoản.');
      setLockingUser(null);
      setLockReason('');
      setMessage(`Đã khóa tài khoản "${lockingUser.display_name}".`);
    });
  }

  async function unlockUser(user: AdminUser) {
    await act(async () => {
      const res = await session.api.POST('/api/v1/admin/users/{id}/status', {
        params: { path: { id: user.id } },
        body: { disabled: false },
      });
      if (res.error) throw new Error(res.error.message ?? 'Không thể mở khóa.');
      setMessage(`Đã mở khóa tài khoản "${user.display_name}".`);
    });
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <section>
      <p className="eyebrow">QUẢN TRỊ HỆ THỐNG</p>
      <h1>Tài khoản và vận hành</h1>

      <div className="admin-container" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', position: 'relative' }}>
        {/* Main Content Area */}
        <div style={{ flex: '1 1 0%', minWidth: 0 }}>
          {usage && (
            <div id="admin-sec-usage" className="panel metric-grid">
              <div><strong>{usage.users}</strong><span>tài khoản</span></div>
              <div><strong>{usage.courses}</strong><span>khóa học</span></div>
              <div><strong>{usage.chats_today}</strong><span>câu trả lời hôm nay (UTC)</span></div>
              <p className="small">
                {usage.failed_ai_tasks} tác vụ AI lỗi · {usage.pending_media_jobs} video đang xử lý
              </p>
            </div>
          )}

      {/* Student Complaints Section */}
      <div id="admin-sec-complaints" className="panel" style={{ marginBottom: '24px' }}>
        <div
          onClick={() => setShowComplaints(v => !v)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <p className="eyebrow" style={{ margin: 0 }}>KHIẾU NẠI KHÓA HỌC TỪ HỌC VIÊN</p>
              {complaints.filter(c => c.status === 'PENDING').length > 0 && (
                <span className="badge" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', border: '1px solid #dc2626', fontWeight: 600 }}>
                  {complaints.filter(c => c.status === 'PENDING').length} khiếu nại chờ xử lý
                </span>
              )}
            </div>
            <h3 style={{ margin: 0 }}>Xem xét khiếu nại & Quyết định đóng khóa học</h3>
          </div>
          <button
            type="button"
            className="secondary"
            style={{ padding: '4px 10px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={(e) => { e.stopPropagation(); setShowComplaints(v => !v); }}
            aria-label={showComplaints ? 'Thu gọn khiếu nại' : 'Mở rộng khiếu nại'}
          >
            <span style={{ fontSize: '12px' }}>{showComplaints ? 'Thu gọn' : 'Mở rộng'}</span>
            <span style={{ fontSize: '11px', display: 'inline-block', transform: showComplaints ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>▼</span>
          </button>
        </div>

        {showComplaints && (
          <div style={{ marginTop: '14px' }}>
            <p className="small" style={{ marginBottom: '16px', color: 'var(--text-muted)' }}>
              Học viên có thể gửi khiếu nại về nội dung sai lệch, vi phạm hoặc video hỏng. Quản trị viên đưa ra quyết định đóng khóa học hoặc bác bỏ khiếu nại.
            </p>

            {complaints.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
                Hiện chưa có khiếu nại nào từ học viên.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {complaints.map(comp => (
              <div
                key={comp.id}
                className="complaint-card"
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                      Khóa học: {comp.course_title}
                    </strong>
                    <div className="small" style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                      Giảng viên: <strong>{comp.instructor_name}</strong> ({comp.instructor_email}) · Học viên khiếu nại: <strong>{comp.student_name}</strong> ({comp.student_email})
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      className="badge"
                      style={{
                        fontSize: '11px',
                        background: comp.status === 'PENDING' ? 'rgba(217, 119, 6, 0.12)' : comp.status === 'RESOLVED' ? 'rgba(220, 38, 38, 0.12)' : 'rgba(107, 114, 128, 0.12)',
                        color: comp.status === 'PENDING' ? '#d97706' : comp.status === 'RESOLVED' ? '#dc2626' : '#6b7280',
                      }}
                    >
                      {comp.status === 'PENDING' ? 'Chờ xử lý' : comp.status === 'RESOLVED' ? 'Đã đóng khóa học' : 'Đã bác bỏ'}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(comp.created_at).toLocaleString('vi-VN')}
                    </span>
                  </div>
                </div>

                <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: '6px', borderLeft: '3px solid #dc2626' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', marginBottom: '4px' }}>
                    Lý do: {comp.reason}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {comp.description}
                  </p>
                </div>

                {comp.admin_notes && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: '8px' }}>
                    Ghi chú xử lý của Quản trị viên: {comp.admin_notes}
                  </div>
                )}

                {comp.status === 'PENDING' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '12px', padding: '5px 12px' }}
                      disabled={busy}
                      onClick={() => {
                        setResolvingComplaint(comp);
                        setResolveAction('DISMISS');
                        setResolveNotes('');
                      }}
                    >
                      Bác bỏ khiếu nại
                    </button>
                    <button
                      type="button"
                      className="primary danger"
                      style={{ fontSize: '12px', padding: '5px 14px', background: '#dc2626', borderColor: '#dc2626' }}
                      disabled={busy}
                      onClick={() => {
                        setResolvingComplaint(comp);
                        setResolveAction('CLOSE_COURSE');
                        setResolveNotes('');
                      }}
                    >
                      Đóng khóa học ngay
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
          </div>
        )}
      </div>

      {/* Danh mục các khóa học đang bị khóa */}
      <div id="admin-sec-locked-courses" className="panel" style={{ marginBottom: '24px', borderLeft: '4px solid #dc2626' }}>
        <div
          onClick={() => setShowLockedCourses(v => !v)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap', gap: '8px' }}
        >
          <div>
            <p className="eyebrow" style={{ margin: 0, color: '#dc2626' }}>QUẢN LÝ KHÓA HỌC BỊ KHÓA</p>
            <h3 style={{ margin: '2px 0 0' }}>Khóa học đang bị khóa ({lockedCourses.length})</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="badge" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', border: '1px solid #ef4444' }}>
              {lockedCourses.length} khóa học
            </span>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={(e) => { e.stopPropagation(); setShowLockedCourses(v => !v); }}
              aria-label={showLockedCourses ? 'Thu gọn danh sách khóa học bị khóa' : 'Mở rộng danh sách khóa học bị khóa'}
            >
              <span style={{ fontSize: '12px' }}>{showLockedCourses ? 'Thu gọn' : 'Mở rộng'}</span>
              <span style={{ fontSize: '11px', display: 'inline-block', transform: showLockedCourses ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>▼</span>
            </button>
          </div>
        </div>

        {showLockedCourses && (
          <div style={{ marginTop: '14px' }}>
            <p className="small" style={{ marginBottom: '16px' }}>
              Các khóa học bị Quản trị viên đóng do khiếu nại hoặc kiểm duyệt. Giảng viên sở hữu không thể chỉnh sửa, thêm bài học hoặc tương tác với khóa học cho đến khi bạn gỡ khóa.
            </p>

            {lockedCourses.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', background: 'var(--bg-elevated)', borderRadius: '8px', color: 'var(--text-muted)' }}>
                Hiện không có khóa học nào đang bị khóa.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
            {lockedCourses.map(c => (
              <div
                key={c.id}
                className="locked-course-card"
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '14px',
                }}
              >
                <div style={{ flex: 1, minWidth: '260px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '15px' }}>{c.title}</strong>
                    <span className="badge" style={{ background: 'rgba(220, 38, 38, 0.12)', color: '#dc2626', fontSize: '11px', fontWeight: 700 }}>
                      Đang bị khóa
                    </span>
                  </div>
                  <div className="small" style={{ color: 'var(--text-muted)' }}>
                    Giảng viên: <strong>{c.owner_name}</strong> ({c.owner_email})
                    {c.locked_at && ` · Khóa lúc: ${new Date(c.locked_at).toLocaleString('vi-VN')}`}
                  </div>
                  {c.locked_reason && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: '6px', borderLeft: '3px solid #dc2626', fontSize: '13px' }}>
                      <span style={{ fontWeight: 600, color: '#dc2626' }}>Lý do khóa: </span>
                      <span>{c.locked_reason}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="primary"
                  style={{
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 600,
                    borderRadius: '8px',
                    background: 'var(--green)',
                    borderColor: 'var(--green)',
                  }}
                  disabled={busy}
                  onClick={() => void handleUnlockCourse(c.id, c.title)}
                >
                  Mở khóa / Gỡ khóa
                </button>
              </div>
            ))}
          </div>
        )}
          </div>
        )}
      </div>

      {/* Broadcast Announcement Section */}
      <div id="admin-sec-broadcast" className="panel" style={{ marginBottom: '24px' }}>
        <p className="eyebrow" style={{ margin: '0 0 8px 0' }}>THÔNG BÁO HỆ THỐNG</p>
        <h3 style={{ margin: '0 0 16px 0' }}>Phát thông báo đến người dùng</h3>
        <p className="small" style={{ marginBottom: '16px' }}>
          Người nhận sẽ thấy thông báo bật lên khi đăng nhập tài khoản, kèm thanh tự đóng sau 3 giây hoặc nút đóng ngay lập tức.
        </p>

        <form onSubmit={sendAnnouncement} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ flex: '2 1 240px', margin: 0 }}>
              Tiêu đề thông báo
              <input
                required
                maxLength={200}
                placeholder="Ví dụ: Lịch bảo trì hệ thống / Thông báo nghỉ lễ"
                value={annTitle}
                onChange={e => setAnnTitle(e.target.value)}
              />
            </label>
            <label style={{ flex: '1 1 180px', margin: 0 }}>
              Đối tượng nhận
              <select
                value={annTarget}
                onChange={e => setAnnTarget(e.target.value as any)}
                style={{ height: '42px', marginTop: '6px', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '0 10px', background: 'var(--input-bg)', color: 'var(--text-primary)', width: '100%' }}
              >
                <option value="ALL">Tất cả người dùng</option>
                <option value="INSTRUCTOR">Tất cả Giảng viên</option>
                <option value="STUDENT">Tất cả Học viên</option>
                <option value="USER">Gửi riêng cho cá nhân</option>
              </select>
            </label>
          </div>

          {annTarget === 'USER' && (
            <label style={{ margin: 0 }}>
              Chọn người dùng nhận thông báo
              <select
                required
                value={annTargetUser}
                onChange={e => setAnnTargetUser(e.target.value)}
                style={{ height: '42px', marginTop: '6px', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '0 10px', background: 'var(--input-bg)', color: 'var(--text-primary)', width: '100%' }}
              >
                <option value="">-- Chọn tài khoản --</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email}) - {u.roles.join(', ')}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label style={{ margin: 0 }}>
            Nội dung chi tiết thông báo
            <textarea
              required
              rows={3}
              placeholder="Nhập nội dung thông báo đầy đủ gửi đến người nhận..."
              value={annMessage}
              onChange={e => setAnnMessage(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button disabled={busy || !annTitle.trim() || !annMessage.trim()}>
              Phát thông báo ngay
            </button>
          </div>
        </form>

        {announcements.length > 0 && (
          <div id="admin-sec-announcements" style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <div
              onClick={() => setShowAnnouncements(v => !v)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginBottom: showAnnouncements ? '12px' : '0' }}
            >
              <h4 style={{ margin: 0, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Thông báo đã phát gần đây:</span>
                <span className="badge" style={{ fontSize: '11px', padding: '1px 6px' }}>{announcements.length}</span>
              </h4>
              <button
                type="button"
                className="secondary"
                style={{ padding: '3px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                onClick={(e) => { e.stopPropagation(); setShowAnnouncements(v => !v); }}
                aria-label={showAnnouncements ? 'Thu gọn thông báo đã phát' : 'Mở rộng thông báo đã phát'}
              >
                <span>{showAnnouncements ? 'Thu gọn' : 'Mở rộng'}</span>
                <span style={{ fontSize: '10px', display: 'inline-block', transform: showAnnouncements ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>▼</span>
              </button>
            </div>

            {showAnnouncements && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {announcements.map(a => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <strong>{a.title}</strong>
                      <span className="small" style={{ display: 'block', color: 'var(--text-muted)' }}>
                        Gửi tới: {a.target_type === 'ALL' ? 'Tất cả' : a.target_type === 'INSTRUCTOR' ? 'Giảng viên' : a.target_type === 'STUDENT' ? 'Học viên' : `Cá nhân: ${a.target_user_name || 'Người dùng'}`}
                        {' · '}Đã đọc: {a.read_count} lượt
                      </span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px', opacity: 0.9 }}>{a.message}</p>
                    </div>
                    <button
                      type="button"
                      className="text-button danger"
                      style={{ fontSize: '12px' }}
                      onClick={() => deleteAnnouncement(a.id)}
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Users Management Section */}
      <div id="admin-sec-users" className="panel" style={{ marginBottom: '24px' }}>
        <div
          onClick={() => setShowUsers(v => !v)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <p className="eyebrow" style={{ margin: 0 }}>NGƯỜI DÙNG & PHÂN QUYỀN</p>
              <span className="badge" style={{ fontSize: '11px', padding: '1px 8px' }}>
                {userSearch.trim() ? `${filteredUsers.length} / ${users.length} tài khoản` : `${users.length} tài khoản`}
              </span>
            </div>
            <h3 style={{ margin: 0 }}>Quản lý danh sách tài khoản</h3>
          </div>
          <button
            type="button"
            className="secondary"
            style={{ padding: '4px 10px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={(e) => { e.stopPropagation(); setShowUsers(v => !v); }}
            aria-label={showUsers ? 'Thu gọn danh sách tài khoản' : 'Mở rộng danh sách tài khoản'}
          >
            <span style={{ fontSize: '12px' }}>{showUsers ? 'Thu gọn' : 'Mở rộng'}</span>
            <span style={{ fontSize: '11px', display: 'inline-block', transform: showUsers ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>▼</span>
          </button>
        </div>

        {showUsers && (
          <div style={{ marginTop: '16px' }}>
            {/* Search Bar */}
            <div style={{ marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  placeholder="Tìm kiếm tài khoản theo tên, email, vai trò (học viên, giảng viên, admin)..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 36px 9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--input-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
                {userSearch && (
                  <button
                    type="button"
                    onClick={() => setUserSearch('')}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                    }}
                    title="Xóa tìm kiếm"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
                Không tìm thấy tài khoản nào khớp với từ khóa &quot;{userSearch}&quot;.
                <div style={{ marginTop: '8px' }}>
                  <button type="button" className="secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setUserSearch('')}>
                    Xóa từ khóa tìm kiếm
                  </button>
                </div>
              </div>
            ) : (
              <div className="admin-users">
                {filteredUsers.map(u => (
                  <article className="panel" key={u.id} style={{ marginBottom: '14px', background: 'var(--bg-elevated)' }}>
                    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <h3 style={{ margin: '0 0 4px 0' }}>{u.display_name}</h3>
                        <p className="small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                          {u.email} ·{' '}
                          {u.disabled ? (
                            <strong style={{ color: 'var(--red, #e53935)' }}>
                              Đã khóa {u.disabled_until ? `(đến ${new Date(u.disabled_until).toLocaleString('vi-VN')})` : '(Vô thời hạn)'}
                              {u.disabled_reason ? ` - Lý do: "${u.disabled_reason}"` : ''}
                            </strong>
                          ) : (
                            <span style={{ color: 'var(--green, #2e7d32)' }}>Đang hoạt động</span>
                          )}
                        </p>
                      </div>

                      {u.disabled ? (
                        <button
                          className="secondary"
                          style={{ color: 'var(--green, #2e7d32)', borderColor: 'var(--green, #2e7d32)' }}
                          disabled={busy || u.id === session.user?.id}
                          onClick={() => unlockUser(u)}
                        >
                          Mở khóa tài khoản
                        </button>
                      ) : (
                        <button
                          className="secondary danger"
                          disabled={busy || u.id === session.user?.id}
                          onClick={() => {
                            setLockingUser(u);
                            setLockMode('indefinite');
                            setLockDays(7);
                            setLockFrom('');
                            setLockUntil('');
                            setLockReason('');
                          }}
                        >
                          Khóa tài khoản
                        </button>
                      )}
                    </div>

                    <div className="filters" style={{ marginTop: '12px' }}>
                      {[
                        ['STUDENT', 'Học viên'],
                        ['INSTRUCTOR', 'Giảng viên'],
                        ['ADMIN', 'Quản trị'],
                      ].map(([role, label]) => (
                        <button
                          key={role}
                          className={u.roles.includes(role) ? 'selected' : ''}
                          aria-pressed={u.roles.includes(role)}
                          disabled={busy || u.id === session.user?.id}
                          onClick={() =>
                            void act(async () => {
                              const r = await session.api.POST('/api/v1/admin/users/{id}/roles', {
                                params: { path: { id: u.id } },
                                body: { role: role as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN', enabled: !u.roles.includes(role) },
                              });
                              if (r.error) throw new Error(r.error.message);
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <button className="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Trang trước
              </button>
              <span className="small">Trang {page + 1}</span>
              <button className="secondary" disabled={users.length < 20} onClick={() => setPage(p => p + 1)}>
                Trang sau
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
      {/* End Main Content Area */}

      {/* Right-side Quick Navigation Bar */}
      <aside
        className="admin-quick-nav"
        style={{
          width: '210px',
          flexShrink: 0,
          position: 'sticky',
          top: '24px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '16px 14px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
          ĐIỀU HƯỚNG NHANH
        </span>
        {[
          { id: 'admin-sec-usage', label: 'Thống kê vận hành' },
          { id: 'admin-sec-complaints', label: 'Khiếu nại từ học viên', badge: complaints.filter(c => c.status === 'PENDING').length },
          { id: 'admin-sec-locked-courses', label: 'Khóa học bị khóa', badge: lockedCourses.length },
          { id: 'admin-sec-broadcast', label: 'Phát thông báo' },
          { id: 'admin-sec-announcements', label: 'Thông báo đã phát', badge: announcements.length },
          { id: 'admin-sec-users', label: 'Quản lý tài khoản', badge: users.length },
        ].map(item => (
          <button
            key={item.id}
            type="button"
            className="text-button"
            onClick={() => scrollToSection(item.id)}
            style={{
              textAlign: 'left',
              padding: '7px 10px',
              borderRadius: '8px',
              fontSize: '12.5px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            {Boolean(item.badge) && (
              <span className="badge" style={{ fontSize: '10px', padding: '1px 5px', background: 'var(--badge-bg)', color: 'var(--badge-text)', fontWeight: 600 }}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </aside>
      </div>

      {/* Account Lock Modal */}
      {lockingUser && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="modal-content panel"
            style={{
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              background: 'var(--bg-card)',
            }}
          >
            <h3 style={{ margin: '0 0 8px 0' }}>Khóa tài khoản: {lockingUser.display_name}</h3>
            <p className="small" style={{ marginBottom: '16px' }}>
              {lockingUser.email} · Người dùng sẽ bị thu hồi phiên đăng nhập ngay lập tức.
            </p>

            <form onSubmit={submitLockUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label
                  className="modal-radio-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: lockMode === 'indefinite' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Khóa vĩnh viễn (Vô thời hạn)</span>
                  <input
                    type="radio"
                    name="lock_mode"
                    value="indefinite"
                    checked={lockMode === 'indefinite'}
                    onChange={() => setLockMode('indefinite')}
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
                    background: lockMode === 'days' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Khóa theo số ngày</span>
                  <input
                    type="radio"
                    name="lock_mode"
                    value="days"
                    checked={lockMode === 'days'}
                    onChange={() => setLockMode('days')}
                    style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
                  />
                </label>
                {lockMode === 'days' && (
                  <div style={{ marginLeft: '14px', marginBottom: '10px' }}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={lockDays}
                      onChange={e => setLockDays(Number(e.target.value))}
                      style={{ width: '120px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                    />
                    <span style={{ marginLeft: '8px', fontSize: '13px' }}>ngày</span>
                  </div>
                )}

                <label
                  className="modal-radio-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: lockMode === 'range' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Khóa từ ngày đến ngày</span>
                  <input
                    type="radio"
                    name="lock_mode"
                    value="range"
                    checked={lockMode === 'range'}
                    onChange={() => setLockMode('range')}
                    style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
                  />
                </label>
                {lockMode === 'range' && (
                  <div style={{ marginLeft: '26px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                    <label style={{ fontSize: '12px', margin: 0 }}>
                      Từ ngày (áp dụng ngay hoặc hẹn trước):
                      <input
                        type="datetime-local"
                        value={lockFrom}
                        onChange={e => setLockFrom(e.target.value)}
                        style={{ marginTop: '4px', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', width: '100%' }}
                      />
                    </label>
                    <label style={{ fontSize: '12px', margin: 0 }}>
                      Đến ngày mở khóa:
                      <input
                        type="datetime-local"
                        required={lockMode === 'range'}
                        value={lockUntil}
                        onChange={e => setLockUntil(e.target.value)}
                        style={{ marginTop: '4px', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', width: '100%' }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <label style={{ margin: 0 }}>
                Lý do khóa tài khoản (hiển thị khi người dùng đăng nhập):
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Ví dụ: Vi phạm quy chế học tập, đăng tải nội dung không phù hợp..."
                  value={lockReason}
                  onChange={e => setLockReason(e.target.value)}
                  style={{ marginTop: '6px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="secondary" onClick={() => setLockingUser(null)}>
                  Hủy
                </button>
                <button type="submit" className="danger" disabled={busy}>
                  Xác nhận khóa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resolvingComplaint && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: '20px' }}>
          <div className="modal-content panel" style={{ maxWidth: '520px', width: '100%', background: 'var(--bg-surface)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: resolveAction === 'CLOSE_COURSE' ? '#dc2626' : 'var(--text-primary)' }}>
              {resolveAction === 'CLOSE_COURSE' ? 'Xác nhận Đóng khóa học' : 'Bác bỏ khiếu nại'}
            </h3>
            <p className="small" style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
              Khóa học: <strong>{resolvingComplaint.course_title}</strong> (Giảng viên: {resolvingComplaint.instructor_name})
            </p>
            <form onSubmit={handleResolveComplaint}>
              <label style={{ fontSize: '13px', display: 'block', marginBottom: '16px' }}>
                Lý do / Ghi chú xử lý của Quản trị viên:
                <textarea
                  rows={3}
                  value={resolveNotes}
                  onChange={e => setResolveNotes(e.target.value)}
                  placeholder={resolveAction === 'CLOSE_COURSE' ? 'Nhập lý do đóng khóa học để thông báo cho học viên và giảng viên...' : 'Nhập lý do bác bỏ khiếu nại...'}
                  style={{ width: '100%', marginTop: '6px', padding: '8px' }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="secondary" disabled={busy} onClick={() => setResolvingComplaint(null)}>
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={resolveAction === 'CLOSE_COURSE' ? 'primary danger' : 'primary'}
                  disabled={busy}
                  style={resolveAction === 'CLOSE_COURSE' ? { background: '#dc2626', borderColor: '#dc2626' } : {}}
                >
                  {busy ? 'Đang xử lý…' : (resolveAction === 'CLOSE_COURSE' ? 'Đóng khóa học' : 'Xác nhận bác bỏ')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
