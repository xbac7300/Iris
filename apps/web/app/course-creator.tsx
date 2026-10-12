'use client';

import { useState, useRef, FormEvent } from 'react';
import type { components } from '@lms/api-client';
import { COURSE_TAGS } from '@lms/api-client';
import { session } from './session';
import { processImageFile } from './image-utils';

type Course = components['schemas']['CourseDto'];

export function CourseCreator({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (course: Course) => void;
}) {
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<string>('CNTT & Phần mềm');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'LINK' | 'RESTRICTED'>('PUBLIC');
  const [allowedEmailsText, setAllowedEmailsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setBusy(true);
      setMessage('');
      const dataUrl = await processImageFile(file);
      setThumbnailUrl(dataUrl);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi tải ảnh bìa.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setMessage('Vui lòng nhập tên khóa học.');
      return;
    }

    const parsedEmails = allowedEmailsText
      .split(/[\n,;]+/)
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => e.length > 0);

    if (accessMode === 'RESTRICTED' && parsedEmails.length === 0) {
      setMessage('Vui lòng nhập ít nhất một email học viên được phép tham gia khóa học.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await session.api.POST('/api/v1/courses', {
        body: {
          title: title.trim(),
          tag,
          description: description.trim() || undefined,
          thumbnail_url: thumbnailUrl || undefined,
          access_mode: accessMode,
          allowed_emails: accessMode === 'RESTRICTED' ? parsedEmails : [],
        } as any,
      });

      if (error || !data) {
        throw new Error(error?.message ?? 'Không thể tạo khóa học mới.');
      }

      onCreated(data as Course);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Đã có lỗi xảy ra.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="course-creator-page">
      <div style={{ marginBottom: '16px' }}>
        <button type="button" className="text-button" onClick={onBack}>
          Quay lại danh sách khóa học
        </button>
      </div>

      <div className="panel course-creator-card" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px' }}>
        <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '24px' }}>
          <p className="eyebrow" style={{ margin: '0 0 6px 0' }}>BƯỚC 1: THIẾT LẬP THÔNG TIN CƠ BẢN</p>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Tạo khóa học mới</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
            Nhập tiêu đề, chọn chủ đề, mô tả, quyền truy cập và tải ảnh bìa cho khóa học của bạn trước khi bước vào soạn nội dung bài giảng.
          </p>
        </div>

        {message && <p role="alert" className="notice" style={{ marginBottom: '20px' }}>{message}</p>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <label>
            Tên khóa học <span style={{ color: 'var(--accent-color)' }}>*</span>
            <input
              required
              maxLength={200}
              placeholder="Ví dụ: Lập trình Python từ cơ bản đến nâng cao"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ fontSize: '15px', padding: '12px 14px' }}
            />
          </label>

          <label>
            Chủ đề / Phân loại
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              style={{ fontSize: '14px', padding: '10px 14px', height: '44px' }}
            >
              {COURSE_TAGS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          {/* Quyền riêng tư & Chế độ truy cập */}
          <div style={{ background: 'var(--bg-elevated)', padding: '18px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Trạng thái & Chế độ truy cập khóa học
            </span>
            <div style={{ display: 'grid', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="access_mode"
                  value="PUBLIC"
                  checked={accessMode === 'PUBLIC'}
                  onChange={() => setAccessMode('PUBLIC')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>Công khai (Public)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Khóa học hiển thị trên danh mục chung, bất kỳ học viên nào cũng có thể tìm kiếm và đăng ký tham gia.
                  </span>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="access_mode"
                  value="LINK"
                  checked={accessMode === 'LINK'}
                  onChange={() => setAccessMode('LINK')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>Chia sẻ qua liên kết (Share Link)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Khóa học không xuất hiện ở danh mục tìm kiếm chung. Chỉ những ai có đường dẫn liên kết trực tiếp mới có thể xem và tham gia.
                  </span>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="access_mode"
                  value="RESTRICTED"
                  checked={accessMode === 'RESTRICTED'}
                  onChange={() => setAccessMode('RESTRICTED')}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>Chỉ định học viên cụ thể (Restricted)</strong>
                  <span className="small" style={{ color: 'var(--text-muted)' }}>
                    Chỉ các học viên có email nằm trong danh sách được chỉ định bên dưới mới được phép truy cập và đăng ký học.
                  </span>
                </div>
              </label>
            </div>

            {accessMode === 'RESTRICTED' && (
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed var(--border-color)' }}>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Danh sách email học viên được cấp quyền (ngăn cách bằng dấu phẩy, chấm phẩy hoặc xuống dòng):
                  </span>
                  <textarea
                    required={accessMode === 'RESTRICTED'}
                    rows={3}
                    placeholder="student1@example.com&#10;student2@example.com&#10;student3@example.com"
                    value={allowedEmailsText}
                    onChange={(e) => setAllowedEmailsText(e.target.value)}
                    style={{ fontSize: '13px', width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
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
              placeholder="Giới thiệu mục tiêu, đối tượng và nội dung mà học viên sẽ đạt được sau khóa học này..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ fontSize: '14px', padding: '12px 14px', lineHeight: 1.6 }}
            />
          </label>

          <div className="thumbnail-upload-section">
            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Ảnh bìa khóa học (Thumbnail)
            </span>

            {thumbnailUrl ? (
              <div className="thumbnail-preview-container" style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)', maxHeight: '240px', background: 'var(--bg-elevated)' }}>
                <img
                  src={thumbnailUrl}
                  alt="Xem trước ảnh bìa"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxHeight: '240px' }}
                />
                <div style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{ background: 'rgba(0, 0, 0, 0.75)', color: '#fff', border: 'none', padding: '6px 14px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Đổi ảnh khác
                  </button>
                  <button
                    type="button"
                    style={{ background: 'rgba(220, 38, 38, 0.85)', color: '#fff', border: 'none', padding: '6px 14px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer' }}
                    onClick={() => setThumbnailUrl('')}
                  >
                    Xóa ảnh
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="thumbnail-dropzone"
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '12px',
                  padding: '32px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--bg-elevated)',
                  transition: 'border-color 0.2s ease',
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <strong style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: 'var(--text-primary)' }}>
                  Nhấp để tải lên ảnh bìa khóa học
                </strong>
                <p className="small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Hỗ trợ định dạng PNG, JPG, WebP. Tối đa 20MB.
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <button type="button" className="secondary" disabled={busy} onClick={onBack}>
              Hủy bỏ
            </button>
            <button type="submit" disabled={busy || !title.trim()} style={{ padding: '0 24px' }}>
              {busy ? 'Đang tạo…' : 'Tiếp tục sang soạn khóa học'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

