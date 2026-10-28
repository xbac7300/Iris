'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { components, CourseTag } from '@lms/api-client';
import { session } from './session';
import { ProgressTracker, COURSE_TAGS } from '@lms/api-client';
import { LearningPanel } from './learning-panel';
import { CourseLearning, ChapterQuizSection, LessonQuizSection } from './course-learning';
import { CourseFeedback } from './course-feedback';
import { processImageFile } from './image-utils';
type Course = components['schemas']['CourseDto'];
type Lesson = components['schemas']['LessonDetailsDto'];
type Module = components['schemas']['ModuleDto'];
type Playback = components['schemas']['PlaybackDto'];
const stateNames: Record<string, string> = { UPLOADING: 'Chờ tải video', VALIDATING: 'Đang kiểm tra video', READY: 'Sẵn sàng', FAILED: 'Xử lý thất bại' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không thể kết nối. Vui lòng thử lại.';

function LessonCard({ lesson, courseId, editable, owner, refresh, onDelete }: { lesson: Lesson; courseId: string; editable: boolean; owner: boolean; refresh: () => Promise<void>; onDelete?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [playback, setPlayback] = useState<Playback | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef(true);
  const recovery = useRef(false);
  const resume = useRef<{ position: number; playing: boolean } | null>(null);
  const tracker = useRef<ProgressTracker|null>(null);
  const [progressText,setProgressText]=useState('');
  const playbackMedia=playback?.media_version;
  useEffect(()=>{
    if(!playbackMedia)return;
    const tracking=new ProgressTracker(session,lesson.id,()=>crypto.randomUUID(),setProgressText);tracker.current=tracking;
    void tracking.start().then(position=>{if(video.current&&position>0)video.current.currentTime=position;}).catch(()=>setProgressText('Chưa mở được phiên lưu tiến độ.'));
    const tick=()=>{const el=video.current;if(el)tracking.sample(el.currentTime,!el.paused&&!el.seeking&&el.readyState>=3,el.playbackRate,performance.now());};
    const sample=setInterval(tick,1000),flush=setInterval(()=>void tracking.flush(),10000);
    const online=()=>void tracking.flush();window.addEventListener('online',online);
    return()=>{clearInterval(sample);clearInterval(flush);window.removeEventListener('online',online);void tracking.flush().finally(()=>tracking.close());tracker.current=null;};
  },[lesson.id,playbackMedia]);
  useEffect(() => { live.current = true; return () => { live.current = false; xhr.current?.abort(); }; }, []);
  useEffect(() => { setPlayback(null); }, [lesson.active_media_id]);
  async function complete(mediaId: string) {
    const { error } = await session.api.POST('/api/v1/lessons/{id}/upload-complete', { params: { path: { id: lesson.id } }, body: { media_id: mediaId } });
    if (error) throw new Error(error.message);
    if (live.current) { setMessage('Đã nhận video. Hệ thống đang kiểm tra để sẵn sàng phát.'); await refresh(); }
  }
  async function action(task: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await task(); } catch (error) { if (live.current) setMessage(errorText(error)); }
    finally { if (live.current) setBusy(false); }
  }
  async function upload(file: File) {
    if (!/\.mp4$/i.test(file.name) || file.size <= 0 || file.size > 524288000) { setMessage('Chọn video MP4 không rỗng, tối đa 500 MiB.'); return; }
    await action(async () => {
      setPlayback(null); setProgress(0);
      const { data, error } = await session.api.POST('/api/v1/lessons/{id}/upload-url', { params: { path: { id: lesson.id } }, body: { size_bytes: file.size } });
      if (!data) throw new Error(error?.message ?? 'Không lấy được URL upload.');
      if (!live.current) return;
      try {
        await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest(); xhr.current = request;
          request.open('PUT', data.upload_url); request.timeout = 15 * 60 * 1000;
          request.setRequestHeader('Content-Type', 'video/mp4');
          request.upload.onprogress = event => { if (live.current && event.lengthComputable) setProgress(Math.round(event.loaded * 100 / event.total)); };
          request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Tải video chưa thành công. Hãy chọn tệp và thử lại.'));
          request.onerror = () => reject(new Error('Kết nối tải video bị gián đoạn. Hãy thử lại.'));
          request.ontimeout = () => reject(new Error('Upload quá thời gian chờ. Hãy thử lại.'));
          request.onabort = () => reject(new Error('Đã dừng upload. Bạn có thể chọn lại tệp.'));
          request.send(file);
        });
        if (live.current) await complete(data.media_id);
      } finally { xhr.current = null; if (live.current) { setProgress(null); await refresh(); } }
    });
    if (live.current) setProgress(null);
  }
  async function preview(recover = false) {
    await action(async () => {
      if (recover && video.current) resume.current = { position: video.current.currentTime, playing: !video.current.paused };
      const { data, error } = await session.api.GET('/api/v1/lessons/{id}/playback', { params: { path: { id: lesson.id } } });
      if (!data) throw new Error(error?.message ?? 'Chưa thể phát video.');
      if (live.current) { setPlayback(data); if (!recover) recovery.current = false; }
    });
  }
  return <article className="lesson-card" id={`lesson-${lesson.id}`}>
    <div className="row">
      <div className="lesson-heading">
        <div>
          <h4>{lesson.title}</h4>
          <small>{lesson.required ? 'Bài học bắt buộc' : 'Bài học bổ sung'}</small>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className={`badge ${lesson.media_status === 'READY' ? 'ready' : ''}`}>{stateNames[lesson.media_status ?? ''] ?? 'Chưa có video'}</span>
        {editable && onDelete && (
          <button
            type="button"
            className="text-button danger"
            style={{ fontSize: '12px', padding: '2px 6px' }}
            disabled={busy}
            onClick={() => void onDelete()}
            title="Xóa bài học này"
          >
            Xóa bài học
          </button>
        )}
      </div>
    </div>
    {editable && <div className="upload-zone"><label className="file-label">{lesson.active_media_id ? 'Chọn video thay thế' : 'Chọn video bài giảng'}<input aria-label={`Video cho ${lesson.title}`} type="file" accept="video/mp4,.mp4" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></label><small>MP4 · H.264/AAC · tối đa 500 MiB, 60 phút, 1080p</small></div>}
    {progress !== null && <div className="upload-progress" role="status"><progress max={100} value={progress} /><span>{progress}% · {progress === 100 ? 'Đang xác nhận' : 'Đang tải video'}</span><button className="text-button" onClick={() => xhr.current?.abort()} disabled={!xhr.current}>Dừng tải</button></div>}
    <div className="lesson-actions">
      {lesson.media_status === 'READY' && <button className="secondary" disabled={busy} onClick={() => void preview()}>Xem video</button>}
      {editable && lesson.media_status === 'UPLOADING' && lesson.active_media_id && <button className="text-button" disabled={busy} onClick={() => void action(() => complete(lesson.active_media_id!))}>Xác nhận tệp đã tải</button>}
      {owner && lesson.media_status === 'FAILED' && lesson.retryable && lesson.job_id && <button className="secondary" disabled={busy} onClick={() => void action(async () => { const { error } = await session.api.POST('/api/v1/jobs/{id}/retry', { params: { path: { id: lesson.job_id! } } }); if (error) throw new Error(error.message); await refresh(); })}>Thử xử lý lại</button>}
    </div>
    {lesson.media_status === 'FAILED' && <p className="notice">Video chưa xử lý được. {lesson.retryable ? 'Bạn có thể thử xử lý lại.' : 'Hãy tải tệp MP4 đúng định dạng, có cả hình và âm thanh.'}</p>}
    {message && <p role="status" className="inline-message">{message}</p>}
    {playback && <div className="preview"><video ref={video} controls preload="metadata" src={playback.url} onSeeking={()=>tracker.current?.reset()} onPause={()=>{tracker.current?.reset();void tracker.current?.flush();}} onLoadedMetadata={() => { if (resume.current && video.current) { video.current.currentTime = resume.current.position; if (resume.current.playing) void video.current.play().catch(() => {}); resume.current = null; } }} onError={() => { if (!recovery.current) { recovery.current = true; void preview(true); } else setMessage('Chưa phát được video. Kiểm tra kết nối rồi bấm Xem video để thử lại.'); }} /><p role="status">{progressText||'Tiến độ được lưu khi bạn xem video.'}</p><LearningPanel lessonId={lesson.id} mediaId={playback.media_version} owner={owner} seek={seconds=>{tracker.current?.reset();if(video.current){video.current.currentTime=seconds;void video.current.play().catch(()=>{});video.current.scrollIntoView({behavior:'smooth',block:'center'});}}}/></div>}
    <LessonQuizSection courseId={courseId} lessonId={lesson.id} editable={editable} owner={owner} />
  </article>;
}

export function CourseEditor({ initial, onBack, onChange, isInstructorMode }: { initial: Course; onBack: () => void; onChange: () => Promise<void>; isInstructorMode?: boolean }) {
  const [course, setCourse] = useState(initial);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
  const [editTitle, setEditTitle] = useState(initial.title);
  const [editDescription, setEditDescription] = useState(initial.description || '');
  const [editTag, setEditTag] = useState<CourseTag>((initial.tag as CourseTag) || 'CNTT & Phần mềm');
  const [editThumbnailUrl, setEditThumbnailUrl] = useState(initial.thumbnail_url || '');
  const [editAccessMode, setEditAccessMode] = useState<'PUBLIC' | 'LINK' | 'RESTRICTED'>((initial.access_mode as 'PUBLIC' | 'LINK' | 'RESTRICTED') || 'PUBLIC');
  const [editAllowedEmailsText, setEditAllowedEmailsText] = useState(Array.isArray(initial.allowed_emails) ? initial.allowed_emails.join('\n') : '');
  const [copiedLink, setCopiedLink] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const flight = useRef(false);

  // Trạng thái bị Quản trị viên khóa
  const isLocked = Boolean(course.is_locked);
  // Admin không chỉnh sửa khóa học hay can thiệp quản lý trực tiếp
  const isAdmin = Boolean(session.user?.roles.includes('ADMIN'));
  // Chỉ khi đang ở chế độ Giảng viên mới có quyền chỉnh sửa khóa học của bản thân
  const isOwner = Boolean(isInstructorMode && session.user?.id === course.owner_id && session.user.roles.includes('INSTRUCTOR'));
  // Khi khóa học bị Quản trị viên khóa, chủ khóa cũng KHÔNG thể chỉnh sửa hay tương tác quản lý
  const canManage = isOwner && !isLocked;
  // Cho phép chỉnh sửa, thêm/xóa bài học hoặc chương kể cả khi khóa học đang xuất bản (trừ khi đang bị khóa)
  const editable = isOwner && !isLocked;

  const [actionModal, setActionModal] = useState<{
    type: 'PUBLISH' | 'ARCHIVE' | 'DELETE';
    title: string;
    description: string;
    confirmLabel: string;
    confirmClass?: string;
  } | null>(null);
  const [applyMode, setApplyMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduleDateTime, setScheduleDateTime] = useState<string>('');

  // Khiếu nại khóa học dành cho học viên gửi về admin
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [complaintReason, setComplaintReason] = useState('Nội dung sai lệch hoặc vi phạm tiêu chuẩn cộng đồng');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [complaintBusy, setComplaintBusy] = useState(false);
  const [complaintSuccess, setComplaintSuccess] = useState('');

  async function submitComplaint(e: FormEvent) {
    e.preventDefault();
    if (!complaintDescription.trim()) return;
    setComplaintBusy(true);
    setComplaintSuccess('');
    try {
      const res = await session.api.POST('/api/v1/courses/{id}/complaints', {
        params: { path: { id: course.id } },
        body: {
          reason: complaintReason,
          description: complaintDescription.trim(),
        },
      });
      if (res.error) throw new Error(res.error.message ?? 'Không thể gửi khiếu nại.');
      setComplaintSuccess('Khiếu nại của bạn đã được gửi thành công đến Quản trị viên hệ thống để xem xét xử lý.');
      setComplaintDescription('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi gửi khiếu nại.');
    } finally {
      setComplaintBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (flight.current) return; flight.current = true;
    try {
      const { data: latestCourse } = await session.api.GET('/api/v1/courses/{id}', { params: { path: { id: initial.id } } });
      if (live.current && latestCourse) setCourse(latestCourse);
      if (latestCourse?.is_locked && !isAdmin) {
        if (live.current) { setModules([]); setLessons([]); setCanRead(false); }
        return;
      }
      const hasAccess = Boolean(canManage || isAdmin || latestCourse?.user_enrolled);
      if (!hasAccess) {
        if (live.current) {
          setModules([]);
          setLessons([]);
          setCanRead(false);
        }
        return;
      }
      const allModules: Module[] = [], allLessons: Lesson[] = [];
      for (let offset = 0; offset <= 10000; offset += 100) {
        const { data, error } = await session.api.GET('/api/v1/courses/{id}/modules', { params: { path: { id: initial.id }, query: { limit: 100, offset } } });
        if (!data) throw new Error(error?.message ?? 'Chưa tải được nội dung khóa học.'); allModules.push(...data); if (data.length < 100) break;
      }
      for (let offset = 0; offset <= 10000; offset += 100) {
        const { data } = await session.api.GET('/api/v1/courses/{id}/lessons', { params: { path: { id: initial.id }, query: { limit: 100, offset } } });
        if (data) allLessons.push(...data);
        if (!data || data.length < 100) break;
      }
      if (live.current) {
        setModules(allModules);
        setLessons(allLessons);
        setCanRead(true);
      }
    } catch (error) { if (live.current) setMessage(errorText(error)); }
    finally { flight.current = false; if (live.current) setLoaded(true); }
  }, [initial.id, canManage, isAdmin]);
  useEffect(() => { live.current = true; void load(); const timer = setInterval(() => void load(), 3000); return () => { live.current = false; clearInterval(timer); }; }, [load]);
  async function act(task: () => Promise<void>) { setBusy(true); setMessage(''); try { await task(); await load(); } catch (error) { if (live.current) setMessage(errorText(error)); } finally { if (live.current) setBusy(false); } }
  function addModule(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const title = String(new FormData(form).get('title')).trim(); void act(async () => {
    const { error } = await session.api.POST('/api/v1/courses/{id}/modules', { params: { path: { id: course.id } }, body: { title, position: modules.length ? Math.max(...modules.map(m => m.position)) + 1 : 0 } }); if (error) throw new Error(error.message); form.reset();
  }); }
  function addLesson(event: FormEvent<HTMLFormElement>, module: Module) { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void act(async () => {
    const current = lessons.filter(l => l.module_id === module.id);
    const { error } = await session.api.POST('/api/v1/modules/{id}/lessons', { params: { path: { id: module.id } }, body: { title: String(values.get('title')).trim(), position: current.length ? Math.max(...current.map(l => l.position)) + 1 : 0, required: values.get('required') === 'on' } }); if (error) throw new Error(error.message); form.reset();
  }); }

  async function deleteModule(moduleId: string, title: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa chương "${title}" cùng toàn bộ bài học bên trong?`)) return;
    await act(async () => {
      let res = await session.api.DELETE('/api/v1/modules/{id}', { params: { path: { id: moduleId } } });
      if (res.error) {
        res = await session.api.POST('/api/v1/modules/{id}/delete', { params: { path: { id: moduleId } } });
      }
      if (res.error) throw new Error(res.error.message ?? 'Chưa thể xóa chương học.');
      setMessage(`Đã xóa chương "${title}".`);
      setActiveChapterIndex(i => Math.max(0, Math.min(i, modules.length - 2)));
    });
  }

  async function deleteLesson(lessonId: string, title: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa bài học "${title}"? Video và dữ liệu liên quan sẽ bị xóa.`)) return;
    await act(async () => {
      let res = await session.api.DELETE('/api/v1/lessons/{id}', { params: { path: { id: lessonId } } });
      if (res.error) {
        res = await session.api.POST('/api/v1/lessons/{id}/delete', { params: { path: { id: lessonId } } });
      }
      if (res.error) throw new Error(res.error.message ?? 'Chưa thể xóa bài học.');
      setMessage(`Đã xóa bài học "${title}".`);
    });
  }

  async function cancelSchedule() {
    if (!window.confirm('Bạn có chắc muốn hủy lịch hẹn thao tác này?')) return;
    await act(async () => {
      const { data, error } = await session.api.POST('/api/v1/courses/{id}/cancel-schedule', {
        params: { path: { id: course.id } },
      });
      if (error) throw new Error(error?.message ?? 'Chưa thể hủy lịch hẹn.');
      if (data) setCourse(data);
      setMessage('Đã hủy lịch hẹn thao tác thành công.');
      await onChange();
    });
  }

  function requestPublish() {
    setActionModal({
      type: 'PUBLISH',
      title: 'Xuất bản khóa học',
      description: 'Xuất bản sẽ khóa cấu trúc chương và bài giảng để học viên có thể đăng ký học.',
      confirmLabel: 'Xác nhận Xuất bản',
      confirmClass: 'primary',
    });
    setApplyMode('immediate');
  }

  function requestArchive() {
    setActionModal({
      type: 'ARCHIVE',
      title: 'Ngưng xuất bản / Lưu trữ khóa học',
      description: 'Khóa học sẽ chuyển sang trạng thái Lưu trữ và ngừng nhận học viên mới. Học viên đã đăng ký vẫn tiếp tục học bình thường.',
      confirmLabel: 'Xác nhận Lưu trữ',
      confirmClass: 'warning',
    });
    setApplyMode('immediate');
  }

  function requestDelete() {
    setActionModal({
      type: 'DELETE',
      title: 'Xóa vĩnh viễn khóa học',
      description: `Bạn có chắc muốn xóa vĩnh viễn khóa học "${course.title}"? Toàn bộ chương, bài học, video và kết quả sẽ bị xóa và không thể khôi phục.`,
      confirmLabel: 'Xác nhận Xóa',
      confirmClass: 'danger',
    });
    setApplyMode('immediate');
  }

  async function handleConfirmActionModal() {
    if (!actionModal) return;
    const isScheduled = applyMode === 'scheduled';
    const scheduledIso = isScheduled && scheduleDateTime ? new Date(scheduleDateTime).toISOString() : undefined;
    const bodyPayload = scheduledIso ? { scheduled_at: scheduledIso } : {};

    await act(async () => {
      if (actionModal.type === 'PUBLISH') {
        const { data, error } = await session.api.POST('/api/v1/courses/{id}/publish', {
          params: { path: { id: course.id } },
          body: bodyPayload,
        });
        if (error) throw new Error(error?.message ?? 'Chưa thể xuất bản khóa học.');
        if (data) setCourse(data);
        setMessage(isScheduled ? `Đã lên lịch xuất bản khóa học vào ${new Date(scheduleDateTime).toLocaleString('vi-VN')}.` : 'Đã xuất bản khóa học thành công!');
        await onChange();
      } else if (actionModal.type === 'ARCHIVE') {
        const { data, error } = await session.api.POST('/api/v1/courses/{id}/archive', {
          params: { path: { id: course.id } },
          body: bodyPayload,
        });
        if (error) throw new Error(error?.message ?? 'Chưa thể lưu trữ khóa học.');
        if (data) setCourse(data);
        setMessage(isScheduled ? `Đã lên lịch lưu trữ khóa học vào ${new Date(scheduleDateTime).toLocaleString('vi-VN')}.` : 'Đã chuyển khóa học sang trạng thái lưu trữ.');
        await onChange();
      } else if (actionModal.type === 'DELETE') {
        let res = await session.api.DELETE('/api/v1/courses/{id}', {
          params: { path: { id: course.id } },
          body: bodyPayload,
        });
        if (res.error) {
          res = await session.api.POST('/api/v1/courses/{id}/delete', {
            params: { path: { id: course.id } },
            body: bodyPayload,
          });
        }
        if (res.error) throw new Error(res.error.message ?? 'Chưa thể xóa khóa học.');
        if (isScheduled) {
          setMessage(`Đã lên lịch xóa khóa học vào ${new Date(scheduleDateTime).toLocaleString('vi-VN')}.`);
          await load();
        } else {
          await onChange();
          onBack();
          return;
        }
      }
      setActionModal(null);
    });
  }
  async function saveCourseInfo(e: FormEvent) {
    e.preventDefault();
    if (!editTitle.trim()) {
      setMessage('Tên khóa học không được để trống.');
      return;
    }
    const parsedEmails = editAllowedEmailsText
      .split(/[\n,;]+/)
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => e.length > 0);

    if (editAccessMode === 'RESTRICTED' && parsedEmails.length === 0) {
      setMessage('Vui lòng nhập ít nhất một email học viên được cấp quyền tham gia khóa học.');
      return;
    }

    await act(async () => {
      const { data, error } = await session.api.PATCH('/api/v1/courses/{id}', {
        params: { path: { id: course.id } },
        body: {
          title: editTitle.trim(),
          description: editDescription.trim(),
          tag: editTag,
          thumbnail_url: editThumbnailUrl || undefined,
          access_mode: editAccessMode,
          allowed_emails: editAccessMode === 'RESTRICTED' ? parsedEmails : [],
        },
      });
      if (error) throw new Error(error?.message ?? 'Chưa thể cập nhật thông tin khóa học.');
      if (data) {
        setCourse(data);
        setEditTitle(data.title);
        setEditDescription(data.description || '');
        setEditTag((data.tag as CourseTag) || 'CNTT & Phần mềm');
        setEditThumbnailUrl(data.thumbnail_url || '');
        setEditAccessMode((data.access_mode as 'PUBLIC' | 'LINK' | 'RESTRICTED') || 'PUBLIC');
        setEditAllowedEmailsText(Array.isArray(data.allowed_emails) ? data.allowed_emails.join('\n') : '');
      }
      setIsEditingInfo(false);
      setMessage('Đã cập nhật thông tin khóa học thành công!');
      await onChange();
    });
  }
  const ready = lessons.filter(l => l.media_status === 'READY').length;
  return <section className="editor"><button className="text-button" onClick={onBack}>Quay lại danh sách khóa học</button>
    <div className="editor-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <p className="eyebrow">{canManage ? 'KHÔNG GIAN SOẠN GIẢNG & QUẢN LÝ' : 'NỘI DUNG KHÓA HỌC'}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '4px 0 8px' }}>
          <h2 style={{ margin: 0 }}>{course.title}</h2>
          <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-text)', border: '1px solid var(--border-color)', fontWeight: 600 }}>
            {course.tag || 'CNTT & Phần mềm'}
          </span>
          {isLocked ? (
            <span className="badge" style={{ background: 'rgba(220, 38, 38, 0.15)', color: '#dc2626', border: '1px solid #ef4444', fontWeight: 700 }}>
              Đang bị khóa
            </span>
          ) : (
            <span className={`badge ${course.status === 'PUBLISHED' ? 'ready' : ''}`}>
              {course.status === 'DRAFT' ? 'Bản nháp' : course.status === 'PUBLISHED' ? 'Đã xuất bản' : 'Lưu trữ'}
            </span>
          )}
          {/* Access mode badge */}
          {(course.access_mode === 'LINK' || course.access_mode === 'RESTRICTED') && (
            <span
              className="badge"
              style={{
                background: course.access_mode === 'LINK' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)',
                color: course.access_mode === 'LINK' ? '#2563eb' : '#9333ea',
                border: `1px solid ${course.access_mode === 'LINK' ? '#93c5fd' : '#d8b4fe'}`,
                fontWeight: 600,
              }}
            >
              {course.access_mode === 'LINK' ? 'Chia sẻ liên kết' : 'Chỉ định học viên'}
            </span>
          )}

          {/* Copy link button if access_mode is LINK */}
          {course.access_mode === 'LINK' && (
            <button
              type="button"
              className="secondary"
              style={{ padding: '3px 12px', fontSize: '12px', borderRadius: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              onClick={() => {
                const url = `${window.location.origin}/?course=${course.id}`;
                void navigator.clipboard.writeText(url);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2500);
              }}
              title="Sao chép liên kết khóa học để gửi cho học viên"
            >
              <span>{copiedLink ? 'Đã sao chép link' : 'Sao chép link khóa học'}</span>
            </button>
          )}

          {canManage && !isEditingInfo && (
            <button
              type="button"
              className="secondary"
              style={{ padding: '3px 12px', fontSize: '12px', borderRadius: '14px' }}
              onClick={() => {
                setEditTitle(course.title);
                setEditDescription(course.description || '');
                setEditTag((course.tag as CourseTag) || 'CNTT & Phần mềm');
                setEditThumbnailUrl(course.thumbnail_url || '');
                setEditAccessMode((course.access_mode as 'PUBLIC' | 'LINK' | 'RESTRICTED') || 'PUBLIC');
                setEditAllowedEmailsText(Array.isArray(course.allowed_emails) ? course.allowed_emails.join('\n') : '');
                setIsEditingInfo(true);
              }}
            >
              Chỉnh sửa thông tin
            </button>
          )}
          {!canManage && !isAdmin && course.user_enrolled && !isLocked && (
            <button
              type="button"
              className="secondary complaint-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 12px',
                fontSize: '12px',
                borderRadius: '14px',
                color: '#dc2626',
                borderColor: '#fca5a5',
              }}
              onClick={() => {
                setShowComplaintModal(true);
                setComplaintSuccess('');
                setComplaintDescription('');
              }}
              title="Gửi khiếu nại về khóa học này đến Quản trị viên"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
              Khiếu nại khóa học
            </button>
          )}
        </div>
        <p style={{ margin: '8px 0 0', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {course.description || 'Từng bài học nhỏ, mở ra những kiến thức mới.'}
        </p>
      </div>
      {course.thumbnail_url ? (
        <div style={{ width: '220px', height: '124px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-elevated)' }}>
          <img src={course.thumbnail_url} alt={course.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      ) : (
        <div style={{ width: '160px', height: '90px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: '10px', textAlign: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chưa có ảnh bìa</span>
        </div>
      )}
    </div>
    {isLocked && (
      <div style={{ marginTop: '16px', padding: '16px 20px', background: 'rgba(220, 38, 38, 0.08)', border: '2px solid #ef4444', borderRadius: '12px' }}>
        <strong style={{ color: '#dc2626', fontSize: '15px', display: 'block', marginBottom: '6px' }}>
          [KHÓA HỌC ĐANG BỊ KHÓA] Khóa học này đã bị Quản trị viên tạm khóa
        </strong>
        <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          {course.locked_reason ? `Lý do khóa: ${course.locked_reason}. ` : 'Khóa học đang trong diện xem xét kiểm duyệt bởi Quản trị viên. '}
          {course.scheduled_until
            ? `Thời hạn mở khóa dự kiến: ${new Date(course.scheduled_until).toLocaleString('vi-VN')}. `
            : 'Thời hạn khóa: Vô thời hạn (cho đến khi Quản trị viên mở khóa). '}
          Mọi thao tác học tập, xem video, làm bài kiểm tra, chỉnh sửa nội dung và đăng ký mới đều bị vô hiệu hóa trong thời gian khóa.
        </p>
      </div>
    )}
    {canManage && isEditingInfo && (
      <form className="course-edit-panel" onSubmit={saveCourseInfo}>
        <h3 style={{ margin: '0 0 14px' }}>Chỉnh sửa thông tin khóa học</h3>
        <div style={{ display: 'grid', gap: '12px' }}>
          <label>
            Tên khóa học
            <input
              name="title"
              required
              maxLength={200}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Ví dụ: Lập trình Python cơ bản"
            />
          </label>
          <label>
            Chủ đề / Phân loại
            <select
              value={editTag}
              onChange={(e) => setEditTag(e.target.value as CourseTag)}
            >
              {COURSE_TAGS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          {/* Quyền riêng tư & Chế độ truy cập */}
          <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Trạng thái & Chế độ truy cập khóa học
            </span>
            <div style={{ display: 'grid', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="edit_access_mode"
                  value="PUBLIC"
                  checked={editAccessMode === 'PUBLIC'}
                  onChange={() => setEditAccessMode('PUBLIC')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '13px', display: 'block' }}>Công khai (Public)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Khóa học hiển thị trên danh mục chung, bất kỳ học viên nào cũng có thể tìm kiếm và đăng ký tham gia.
                  </span>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="edit_access_mode"
                  value="LINK"
                  checked={editAccessMode === 'LINK'}
                  onChange={() => setEditAccessMode('LINK')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '13px', display: 'block' }}>Chia sẻ qua liên kết (Share Link)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Khóa học không xuất hiện ở danh mục tìm kiếm chung. Chỉ người có liên kết mới có thể xem và tham gia.
                  </span>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="edit_access_mode"
                  value="RESTRICTED"
                  checked={editAccessMode === 'RESTRICTED'}
                  onChange={() => setEditAccessMode('RESTRICTED')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '13px', display: 'block' }}>Chỉ định học viên cụ thể (Restricted)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Chỉ các học viên có email trong danh sách bên dưới mới được phép truy cập và đăng ký học.
                  </span>
                </div>
              </label>
            </div>

            {editAccessMode === 'RESTRICTED' && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Danh sách email học viên được cấp quyền (ngăn cách bằng dấu phẩy, chấm phẩy hoặc xuống dòng):
                  </span>
                  <textarea
                    required={editAccessMode === 'RESTRICTED'}
                    rows={3}
                    placeholder="student1@example.com&#10;student2@example.com&#10;student3@example.com"
                    value={editAllowedEmailsText}
                    onChange={(e) => setEditAllowedEmailsText(e.target.value)}
                    style={{ fontSize: '13px', width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                  />
                </label>
              </div>
            )}
          </div>

          <label>
            Mô tả khóa học
            <textarea
              rows={4}
              maxLength={5000}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Mô tả mục tiêu, đối tượng và nội dung mà học viên sẽ nhận được từ khóa học này..."
            />
          </label>

          {/* Upload ảnh bìa khóa học */}
          <div>
            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Ảnh bìa khóa học (Thumbnail)
            </span>
            {editThumbnailUrl ? (
              <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)', maxHeight: '200px', background: 'var(--bg-elevated)' }}>
                <img src={editThumbnailUrl} alt="Xem trước ảnh bìa" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxHeight: '200px' }} />
                <div style={{ position: 'absolute', bottom: '8px', right: '8px', display: 'flex', gap: '6px' }}>
                  <button type="button" className="secondary" style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', border: 'none', padding: '5px 12px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer' }} onClick={() => thumbnailInputRef.current?.click()}>
                    Đổi ảnh khác
                  </button>
                  <button type="button" style={{ background: 'rgba(220,38,38,0.85)', color: '#fff', border: 'none', padding: '5px 12px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setEditThumbnailUrl('')}>
                    Xóa ảnh
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{ border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-elevated)', transition: 'border-color 0.2s' }}
                onClick={() => thumbnailInputRef.current?.click()}
              >
                <strong style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: 'var(--text-primary)' }}>Nhấp để tải lên ảnh bìa</strong>
                <p className="small" style={{ margin: 0, color: 'var(--text-muted)' }}>PNG, JPG, WebP — Tối đa 20MB</p>
              </div>
            )}
            <input
              ref={thumbnailInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const dataUrl = await processImageFile(file);
                  setEditThumbnailUrl(dataUrl);
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Lỗi khi tải ảnh bìa.');
                }
                if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
              }}
            />
          </div>
        </div>
        <div className="course-edit-actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu cập nhật'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setIsEditingInfo(false)}
          >
            Hủy bỏ
          </button>
        </div>
      </form>
    )}
    {message && <p role="alert" className="notice">{message}</p>}
    {course.scheduled_action && (
      <div className="notice" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', borderLeft: '4px solid var(--accent-color)', marginBottom: '16px' }}>
        <div>
          <strong>Lịch hẹn tự động đang chờ: </strong>
          <span>
            {course.scheduled_action === 'PUBLISH' && 'Xuất bản khóa học'}
            {course.scheduled_action === 'ARCHIVE' && 'Ngưng xuất bản / Lưu trữ khóa học'}
            {course.scheduled_action === 'DELETE' && 'Xóa vĩnh viễn khóa học'}
            {' vào '}
            {course.scheduled_at ? new Date(course.scheduled_at).toLocaleString('vi-VN') : 'thời gian quy định'}
          </span>
        </div>
        {canManage && (
          <button
            type="button"
            className="secondary"
            style={{ fontSize: '13px', padding: '4px 12px' }}
            disabled={busy}
            onClick={() => void cancelSchedule()}
          >
            Hủy lịch hẹn
          </button>
        )}
      </div>
    )}
    {!loaded ? <p role="status">Đang tải nội dung…</p> : <>
      {!canRead && (
        <div style={{ maxWidth: '640px', margin: '30px auto', padding: '36px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '14px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }}>
          <h3 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 10px', color: 'var(--text-primary)' }}>Bắt đầu lộ trình học tập ngay</h3>
          <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.6 }}>
            Đăng ký khóa học để mở khóa toàn bộ bài giảng video, phụ đề transcript đồng bộ, trợ lý hỏi đáp AI RAG và các bài kiểm tra đánh giá năng lực.
          </p>
          <button
            type="button"
            className="primary"
            style={{ fontSize: '15px', padding: '12px 32px', minWidth: '180px', borderRadius: '8px' }}
            disabled={busy || course.status !== 'PUBLISHED' || isLocked}
            onClick={() => void act(async () => {
              const { error } = await session.api.POST('/api/v1/courses/{id}/enrollments', { params: { path: { id: course.id } } });
              if (error) throw new Error(error.message);
              await load();
            })}
          >
            {isLocked
              ? 'Khóa học đang tạm khóa'
              : course.status !== 'PUBLISHED'
              ? 'Khóa học chưa xuất bản'
              : 'Đăng ký học ngay'}
          </button>
          <div style={{ marginTop: '30px', textAlign: 'left', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <CourseFeedback courseId={course.id} isOwner={false} />
          </div>
        </div>
      )}
      {canRead && <div className="editor-grid"><div>
        {canManage && course.status === 'PUBLISHED' && (
          <div className="published-notice-banner" style={{ padding: '12px 16px', background: 'rgba(33, 99, 79, 0.08)', borderRadius: '8px', border: '1px solid var(--green)', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <strong style={{ color: 'var(--green)', fontSize: '13px' }}>Khóa học đang được xuất bản</strong>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Bạn có toàn quyền cập nhật thông tin chung, thêm mới hoặc xóa sửa bài học và chương bất kỳ lúc nào.
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '12px', padding: '4px 12px' }}
              onClick={() => {
                setEditTitle(course.title);
                setEditDescription(course.description || '');
                setEditTag((course.tag as CourseTag) || 'CNTT & Phần mềm');
                setEditThumbnailUrl(course.thumbnail_url || '');
                setIsEditingInfo(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Chỉnh sửa thông tin
            </button>
          </div>
        )}
        {modules.length === 0 && (
          <div className="empty">
            <h3>{isLocked ? 'Nội dung khóa học đang tạm đóng' : 'Bắt đầu từ chương đầu tiên'}</h3>
            <p>{isLocked ? 'Khóa học này đang bị Quản trị viên tạm khóa nên toàn bộ bài giảng và bài kiểm tra không thể truy cập.' : 'Thêm một chương, tạo bài học và tải video của bạn lên.'}</p>
          </div>
        )}

        {/* Thanh stepper chương */}
        {modules.length > 0 && (
          <div className="chapter-stepper">
            <div className="stepper-indicators">
              {modules.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  className={`stepper-dot ${i === activeChapterIndex ? 'active' : ''} ${i < activeChapterIndex ? 'done' : ''}`}
                  onClick={() => setActiveChapterIndex(i)}
                  title={`Chương ${i + 1}: ${m.title}`}
                >
                  <span className="stepper-num">{i + 1}</span>
                </button>
              ))}
            </div>
            <p className="stepper-label">
              Chương {activeChapterIndex + 1} / {modules.length}
            </p>
          </div>
        )}

        {/* Chỉ hiển thị 1 chương tại một thời điểm */}
        {modules.length > 0 && (() => {
          const index = Math.min(activeChapterIndex, modules.length - 1);
          const module = modules[index];
          return (
            <section key={module.id} className="module" style={{ animation: 'fadeIn 0.25s ease' }}>
              <div className="module-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{module.title}</h3>
                </div>
                {editable && (
                  <button
                    type="button"
                    className="text-button danger"
                    style={{ fontSize: '13px', marginLeft: 'auto' }}
                    disabled={busy}
                    onClick={() => void deleteModule(module.id, module.title)}
                    title="Xóa chương này"
                  >
                    Xóa chương
                  </button>
                )}
              </div>
              {lessons.filter(l => l.module_id === module.id).map(l => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  courseId={course.id}
                  owner={Boolean(canManage)}
                  editable={editable}
                  refresh={load}
                  onDelete={() => deleteLesson(l.id, l.title)}
                />
              ))}
              {editable && <form className="inline-form" onSubmit={event => addLesson(event, module)}><label>Tên bài học<input name="title" required maxLength={200} placeholder="Ví dụ: Làm quen với Python" /></label><label className="checkbox"><input type="checkbox" name="required" defaultChecked /> Bắt buộc</label><button className="secondary" disabled={busy}>Thêm bài học</button></form>}
              <ChapterQuizSection
                courseId={course.id}
                moduleId={module.id}
                editable={editable}
                owner={Boolean(canManage)}
              />
            </section>
          );
        })()}

        {/* Nút Chương trước / Chương sau */}
        {modules.length > 0 && (
          <div className="chapter-nav-buttons">
            <button
              type="button"
              className="secondary"
              disabled={activeChapterIndex <= 0}
              onClick={() => { setActiveChapterIndex(i => Math.max(0, i - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              Chương trước
            </button>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
              Chương {activeChapterIndex + 1} / {modules.length}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={activeChapterIndex >= modules.length - 1}
              onClick={() => { setActiveChapterIndex(i => Math.min(modules.length - 1, i + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              Chương sau
            </button>
          </div>
        )}

        {editable && <form className="panel inline-form" onSubmit={addModule}><label>Tên chương mới<input name="title" required maxLength={200} placeholder="Ví dụ: Kiến thức nền tảng" /></label><button disabled={busy}>Thêm chương</button></form>}
        {canRead&&<CourseLearning courseId={course.id} owner={Boolean(canManage)}/>}
        <CourseFeedback courseId={course.id} isOwner={Boolean(isOwner)} />
      </div><aside className="course-guide"><p className="eyebrow">TỔNG QUAN KHÓA HỌC</p><div className="guide-number">{ready}<span> / {lessons.length}</span></div><p>video sẵn sàng để học</p><progress value={ready} max={Math.max(1, lessons.length)} /><hr /><h3>{editable ? 'Chuẩn bị bài giảng' : 'Học theo từng bước'}</h3>{canManage?<ol><li>Tạo chương và bài học</li><li>Tải video và chuẩn bị nguồn AI</li><li>Thêm quiz, xem thử và xuất bản</li></ol>:<ol><li>Xem video theo lộ trình</li><li>Ôn lại bằng transcript và hỏi AI</li><li>Làm bài kiểm tra kiến thức</li></ol>}
        {/* Sidebar: Danh mục chương — nhấn để chuyển chương nhanh */}
        {/* Sidebar: Danh mục chương — mũi tên ẩn hiện và bấm vào bài học để chuyển tới */}
        {modules.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <hr />
            <h3>Danh mục chương</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {modules.map((m, i) => {
                const isExpanded = expandedChapters[m.id] ?? (i === activeChapterIndex);
                const chapterLessons = lessons.filter(l => l.module_id === m.id);
                return (
                  <div key={m.id} style={{ borderRadius: '6px', overflow: 'hidden' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        background: i === activeChapterIndex ? 'rgba(33,99,79,0.1)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <button
                        type="button"
                        className={`text-button ${i === activeChapterIndex ? 'chapter-sidebar-active' : ''}`}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          padding: '4px 6px',
                          fontSize: '13px',
                          fontWeight: i === activeChapterIndex ? 700 : 500,
                          color: i === activeChapterIndex ? 'var(--green)' : 'var(--text-primary)',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        onClick={() => {
                          setActiveChapterIndex(i);
                          setExpandedChapters(prev => ({ ...prev, [m.id]: true }));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        title={`Chuyển sang Chương ${i + 1}: ${m.title}`}
                      >
                        {String(i + 1).padStart(2, '0')}. {m.title}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedChapters(prev => ({ ...prev, [m.id]: !isExpanded }));
                        }}
                        aria-label={isExpanded ? 'Thu gọn bài học' : 'Mở rộng bài học'}
                        title={isExpanded ? 'Thu gọn bài học' : 'Mở rộng bài học'}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: '4px',
                          cursor: 'pointer',
                          color: i === activeChapterIndex ? 'var(--green)' : 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 0.2s ease',
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{ paddingLeft: '16px', marginTop: '2px', marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {chapterLessons.map(l => (
                          <button
                            key={l.id}
                            type="button"
                            className="sidebar-lesson-btn"
                            onClick={() => {
                              setActiveChapterIndex(i);
                              setTimeout(() => {
                                const el = document.getElementById(`lesson-${l.id}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  el.classList.add('highlight-target');
                                  setTimeout(() => el.classList.remove('highlight-target'), 2000);
                                }
                              }, 120);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              textAlign: 'left',
                              padding: '5px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              width: '100%',
                              transition: 'all 0.15s ease',
                            }}
                            title={`Nhấn để tới bài học: ${l.title}`}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: l.media_status === 'READY' ? 'var(--green)' : 'var(--border-color)',
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {l.title}
                            </span>
                          </button>
                        ))}
                        {chapterLessons.length === 0 && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 8px' }}>
                            Chưa có bài học
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {canManage && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <hr />
            <h3>Thao tác khóa học</h3>
            <button
              type="button"
              className="full secondary"
              style={{ fontWeight: 600, borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => {
                setEditTitle(course.title);
                setEditDescription(course.description || '');
                setEditTag((course.tag as CourseTag) || 'CNTT & Phần mềm');
                setEditThumbnailUrl(course.thumbnail_url || '');
                setIsEditingInfo(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Chỉnh sửa thông tin khóa học
            </button>
            {course.status === 'DRAFT' && (
              <>
                <div className="publish-checklist" style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border-color)', margin: '8px 0' }}>
                  <strong style={{ fontSize: '13px', display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>
                    Điều kiện xuất bản khóa học:
                  </strong>
                  <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: lessons.some(l => l.required) ? 'var(--green)' : 'var(--text-muted)' }}>
                      <span style={{ fontWeight: 700 }}>{lessons.some(l => l.required) ? '[Đạt]' : '[Chưa]'}</span>
                      <span>Có ít nhất 1 bài học bắt buộc ({lessons.filter(l => l.required).length} bài)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: (lessons.length > 0 && ready === lessons.length) ? 'var(--green)' : 'var(--text-muted)' }}>
                      <span style={{ fontWeight: 700 }}>{(lessons.length > 0 && ready === lessons.length) ? '[Đạt]' : '[Chưa]'}</span>
                      <span>Mọi video bài giảng đã sẵn sàng ({ready}/{lessons.length} video READY)</span>
                    </div>
                  </div>
                  {!(lessons.some(l => l.required) && ready === lessons.length && lessons.length > 0) && (
                    <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(217, 119, 6, 0.1)', borderRadius: '6px', fontSize: '11px', color: '#b45309' }}>
                      Lưu ý: {lessons.length === 0
                        ? 'Cần thêm ít nhất 1 bài học và tải video MP4.'
                        : ready < lessons.length
                        ? `Còn ${lessons.length - ready} bài học chưa tải video hoặc đang kiểm tra. Khi worker xử lý xong, nút Xuất bản sẽ tự mở.`
                        : 'Cần ít nhất 1 bài đánh dấu bắt buộc.'}
                    </div>
                  )}
                </div>
                <p className="small">Xuất bản sẽ khóa cấu trúc và video của khóa học để giữ nguyên lộ trình học.</p>
                <button
                  className="full"
                  disabled={busy || !lessons.some(l => l.required) || ready !== lessons.length || lessons.length === 0}
                  onClick={requestPublish}
                  title={ready !== lessons.length || !lessons.some(l => l.required) ? 'Cần hoàn thành các điều kiện trên' : 'Xuất bản khóa học'}
                >
                  Xuất bản khóa học
                </button>
                <button className="full warning" disabled={busy} onClick={requestArchive}>
                  Lưu trữ khóa học
                </button>
              </>
            )}
            {course.status === 'PUBLISHED' && (
              <>
                <p className="small">Khóa học đang xuất bản. Bạn có thể ngưng xuất bản để dừng nhận thêm học viên mới.</p>
                <button className="full warning" disabled={busy} onClick={requestArchive}>
                  Ngưng xuất bản (Lưu trữ)
                </button>
              </>
            )}
            {course.status === 'ARCHIVED' && (
              <>
                <p className="small">Khóa học đang ở trạng thái Lưu trữ. Bạn có thể xuất bản lại bất cứ lúc nào.</p>
                <button className="full" disabled={busy} onClick={requestPublish}>
                  Xuất bản lại khóa học
                </button>
              </>
            )}
            <button className="full danger" disabled={busy} onClick={requestDelete}>
              Xóa vĩnh viễn khóa học
            </button>
          </div>
        )}
        {!canManage && <p className="small">Chọn Xem video ở bài học để bắt đầu.</p>}
        <div className="ai-note"><strong>Hiểu bài cùng trợ giảng AI</strong><p>Mở video để đọc transcript, xem tóm tắt và đặt câu hỏi có nguồn từ bài giảng.</p></div>
      </aside></div>}
    </>}
    {actionModal && (
      <div className="modal-backdrop" style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: '20px'
      }}>
        <div className="modal-content panel" style={{
          maxWidth: '480px', width: '100%', background: 'var(--bg-surface)',
          borderRadius: '12px', border: '1px solid var(--border-color)',
          padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)'
        }}>
          <h3 style={{ margin: '0 0 8px' }}>{actionModal.title}</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            {actionModal.description}
          </p>

          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: applyMode === 'immediate' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Áp dụng ngay lập tức</span>
              <input
                type="radio"
                name="applyMode"
                value="immediate"
                checked={applyMode === 'immediate'}
                onChange={() => setApplyMode('immediate')}
                style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
              />
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: applyMode === 'scheduled' ? 'rgba(33, 99, 79, 0.08)' : 'var(--bg-elevated)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Lên lịch theo ngày giờ</span>
              <input
                type="radio"
                name="applyMode"
                value="scheduled"
                checked={applyMode === 'scheduled'}
                onChange={() => {
                  setApplyMode('scheduled');
                  if (!scheduleDateTime) {
                    const d = new Date(Date.now() + 3600 * 1000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setScheduleDateTime(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }
                }}
                style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer' }}
              />
            </label>

            {applyMode === 'scheduled' && (
              <div style={{ paddingLeft: '24px' }}>
                <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>
                  Chọn thời gian áp dụng:
                </label>
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px 12px' }}
                />
                <small style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  Hệ thống sẽ tự động thực hiện thao tác khi đến thời gian đã chọn.
                </small>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setActionModal(null)}
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              className={actionModal.confirmClass || ''}
              disabled={busy || (applyMode === 'scheduled' && !scheduleDateTime)}
              onClick={() => void handleConfirmActionModal()}
            >
              {busy ? 'Đang xử lý…' : actionModal.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal Khiếu nại khóa học dành cho học viên gửi về admin */}
    {showComplaintModal && (
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
            maxWidth: '560px',
            width: '100%',
            background: 'var(--bg-surface)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            padding: '24px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: '#dc2626' }}>
                Khiếu nại khóa học đến Quản trị viên
              </h3>
              <p className="small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                Khóa học: <strong>{course.title}</strong>
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => {
                setShowComplaintModal(false);
                setComplaintSuccess('');
              }}
            >
              Đóng
            </button>
          </div>

          {complaintSuccess ? (
            <div style={{ padding: '16px', background: 'rgba(33, 99, 79, 0.1)', borderRadius: '8px', border: '1px solid var(--green)', marginBottom: '16px' }}>
              <strong style={{ color: 'var(--green)', display: 'block', marginBottom: '4px' }}>Gửi khiếu nại thành công!</strong>
              <p style={{ margin: 0, fontSize: '13px' }}>{complaintSuccess}</p>
              <div style={{ marginTop: '14px', textAlign: 'right' }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setShowComplaintModal(false)}
                >
                  Hoàn tất
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitComplaint}>
              <div style={{ display: 'grid', gap: '14px' }}>
                <label style={{ fontSize: '13px', display: 'block' }}>
                  Lý do khiếu nại:
                  <select
                    value={complaintReason}
                    onChange={(e) => setComplaintReason(e.target.value)}
                    style={{ width: '100%', marginTop: '6px', padding: '8px 10px', borderRadius: '6px' }}
                  >
                    <option value="Nội dung sai lệch hoặc vi phạm tiêu chuẩn cộng đồng">Nội dung sai lệch hoặc vi phạm tiêu chuẩn cộng đồng</option>
                    <option value="Video bị lỗi, không phát được hoặc không đúng mô tả">Video bị lỗi, không phát được hoặc không đúng mô tả</option>
                    <option value="Giảng viên có hành vi gian lận hoặc thiếu trách nhiệm">Giảng viên có hành vi gian lận hoặc thiếu trách nhiệm</option>
                    <option value="Vi phạm bản quyền tài liệu / sở hữu trí tuệ">Vi phạm bản quyền tài liệu / sở hữu trí tuệ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </label>

                <label style={{ fontSize: '13px', display: 'block' }}>
                  Chi tiết nội dung khiếu nại:
                  <textarea
                    required
                    rows={4}
                    value={complaintDescription}
                    onChange={(e) => setComplaintDescription(e.target.value)}
                    placeholder="Mô tả cụ thể vấn đề bạn gặp phải để Quản trị viên kiểm tra và đưa ra quyết định đóng khóa học hoặc xử lý phù hợp..."
                    style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: '6px' }}
                  />
                </label>

                <p className="small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Khiếu nại của bạn sẽ được gửi ẩn danh với giảng viên và trực tiếp tới bảng điều khiển của Quản trị viên hệ thống.
                </p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={complaintBusy}
                    onClick={() => setShowComplaintModal(false)}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    style={{ background: '#dc2626', borderColor: '#dc2626' }}
                    disabled={complaintBusy || !complaintDescription.trim()}
                  >
                    {complaintBusy ? 'Đang gửi…' : 'Gửi khiếu nại ngay'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    )}
  </section>;
}
