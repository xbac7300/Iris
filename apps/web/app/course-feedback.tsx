'use client';
import { FormEvent, useEffect, useState } from 'react';
import type { components } from '@lms/api-client';
import { session } from './session';

type FeedbackSummary = components['schemas']['CourseFeedbackSummaryDto'];
type FeedbackItem = components['schemas']['FeedbackItemDto'];

export function CourseFeedback({ courseId, isOwner = false }: { courseId: string; isOwner?: boolean }) {
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [liking, setLiking] = useState(false);
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState('');

  async function load() {
    try {
      const res = await session.api.GET('/api/v1/courses/{id}/feedback', {
        params: { path: { id: courseId } },
      });
      if (res.data) {
        setData(res.data);
        if (res.data.user_review) {
          setRating(res.data.user_review.rating);
          setComment(res.data.user_review.comment || '');
        }
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [courseId]);

  async function toggleLike() {
    if (liking) return;
    setLiking(true);
    const prev = data;
    if (data) {
      const nextLiked = !data.user_liked;
      const nextTotal = nextLiked ? data.total_likes + 1 : Math.max(0, data.total_likes - 1);
      setData({ ...data, user_liked: nextLiked, total_likes: nextTotal });
    }
    try {
      const res = await session.api.POST('/api/v1/courses/{id}/like', {
        params: { path: { id: courseId } },
      });
      if (res.error) {
        if (prev) setData(prev);
        setMessage((res.error as { message?: string })?.message ?? 'Không thể cập nhật lượt thích.');
      } else if (res.data) {
        setData(cur => cur ? {
          ...cur,
          user_liked: res.data!.liked,
          total_likes: res.data!.total_likes,
        } : null);
      }
    } catch (err) {
      if (prev) setData(prev);
      setMessage(err instanceof Error ? err.message : 'Không thể cập nhật lượt thích.');
    } finally {
      setLiking(false);
    }
  }

  async function submitReview(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const res = await session.api.POST('/api/v1/courses/{id}/feedback', {
        params: { path: { id: courseId } },
        body: { rating, comment: comment.trim() },
      });
      if (res.error) throw new Error((res.error as { message?: string })?.message ?? 'Không thể gửi đánh giá.');
      setMessage(data?.user_review ? 'Đã cập nhật đánh giá thành công!' : 'Đã gửi đánh giá thành công!');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không thể gửi đánh giá.');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteReview() {
    if (!window.confirm('Bạn có chắc muốn xóa nhận xét của mình?')) return;
    setSubmitting(true);
    setMessage('');
    try {
      let res = await session.api.DELETE('/api/v1/courses/{id}/feedback', {
        params: { path: { id: courseId } },
      });
      if (res.error) {
        res = await session.api.POST('/api/v1/courses/{id}/feedback/delete', {
          params: { path: { id: courseId } },
        });
      }
      if (res.error) throw new Error((res.error as { message?: string })?.message ?? 'Không thể xóa nhận xét.');
      setComment('');
      setRating(5);
      setMessage('Đã xóa nhận xét của bạn.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không thể xóa nhận xét.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="panel" style={{ marginTop: '20px' }}><p>Đang tải nhận xét và đánh giá…</p></div>;
  }

  const avg = data?.avg_rating || 0;
  const totalReviews = data?.total_reviews || 0;
  const totalLikes = data?.total_likes || 0;
  const userLiked = data?.user_liked || false;
  const hasReviewed = Boolean(data?.user_review);

  return (
    <section className="panel course-feedback-section" style={{ marginTop: '24px' }}>
      <div className="feedback-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid var(--line)', paddingBottom: '18px', marginBottom: '20px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '20px' }}>Đánh giá & Nhận xét từ người học</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>Chia sẻ cảm nhận và động viên giảng viên cùng cộng đồng học tập.</p>
        </div>
        <button
          type="button"
          onClick={toggleLike}
          disabled={liking}
          className={`like-button ${userLiked ? 'liked' : ''}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '20px',
            fontSize: '13px',
            fontWeight: 600,
            background: userLiked ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            color: userLiked ? 'var(--accent-color)' : 'var(--text-secondary)',
            border: userLiked ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          title={userLiked ? 'Bỏ thích khóa học' : 'Yêu thích khóa học'}
        >
          <span>{userLiked ? 'Đã yêu thích' : 'Yêu thích'}</span>
          <strong style={{ background: userLiked ? 'var(--accent-color)' : 'var(--bg-subtle)', color: userLiked ? '#ffffff' : 'var(--text-secondary)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
            {totalLikes}
          </strong>
        </button>
      </div>

      {/* Overview Stats */}
      <div className="feedback-overview" style={{ display: 'flex', alignItems: 'center', gap: '28px', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px 24px', marginBottom: '24px' }}>
        <div style={{ textAlign: 'center', minWidth: '100px' }}>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--accent-color)', lineHeight: 1 }}>
            {avg > 0 ? avg.toFixed(1) : '5.0'}
          </div>
          <div style={{ color: '#f59e0b', fontSize: '16px', letterSpacing: '2px', margin: '6px 0 2px' }}>
            {'★'.repeat(Math.round(avg || 5))}
            <span style={{ color: 'var(--border-color)' }}>
              {'★'.repeat(5 - Math.min(5, Math.round(avg || 5)))}
            </span>
          </div>
          <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            {totalReviews > 0 ? `${totalReviews} lượt đánh giá` : 'Chưa có đánh giá'}
          </small>
        </div>
        <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', flex: 1 }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>
            <strong>{totalReviews}</strong> đánh giá · <strong>{totalLikes}</strong> lượt yêu thích khóa học.
          </p>
          <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
            Những chia sẻ tâm huyết từ các học viên giúp khóa học ngày càng hoàn thiện và bổ ích hơn.
          </small>
        </div>
      </div>

      {message && (
        <p role="status" className="notice" style={{ marginBottom: '18px' }}>
          {message}
        </p>
      )}

      {/* Review Form or Instructor Notice */}
      {isOwner ? (
        <div style={{ background: 'var(--bg-elevated)', border: '1px dashed var(--border-color)', borderRadius: '12px', padding: '16px 20px', marginBottom: '28px', color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
            Giảng viên không thể tự đánh giá khóa học của chính mình.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Bạn có thể đọc các nhận xét và đánh giá từ học viên bên dưới để cải thiện khóa học.
          </p>
        </div>
      ) : (
        <form onSubmit={submitReview} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', marginBottom: '28px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '15px' }}>
            {hasReviewed ? 'Chỉnh sửa nhận xét của bạn' : 'Viết đánh giá của bạn'}
          </h4>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>
              Đánh giá theo mức độ hài lòng:
            </label>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  style={{
                    background: 'transparent',
                    color: star <= rating ? '#f59e0b' : 'var(--border-color)',
                    border: 'none',
                    padding: '0 4px',
                    fontSize: '30px',
                    cursor: 'pointer',
                    lineHeight: 1,
                    transition: 'transform 0.1s ease',
                  }}
                  title={`${star} sao`}
                >
                  ★
                </button>
              ))}
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '10px', fontWeight: 600 }}>
                {rating === 5 && 'Xuất sắc'}
                {rating === 4 && 'Rất tốt'}
                {rating === 3 && 'Tốt / Bình thường'}
                {rating === 2 && 'Cần cải thiện'}
                {rating === 1 && 'Chưa hài lòng'}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label htmlFor="feedback-comment" style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>
              Nhận xét chi tiết (tùy chọn):
            </label>
            <textarea
              id="feedback-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Bạn thấy nội dung, bài giảng và trợ giảng AI như thế nào? Chia sẻ cùng mọi người nhé..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '14px' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button type="submit" disabled={submitting} style={{ padding: '10px 20px', fontSize: '14px' }}>
              {submitting ? 'Đang gửi…' : hasReviewed ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
            </button>
            {hasReviewed && (
              <button
                type="button"
                disabled={submitting}
                onClick={deleteReview}
                className="text-button"
                style={{ color: '#dc2626', fontSize: '13px', padding: '8px 12px' }}
              >
                Xóa đánh giá
              </button>
            )}
          </div>
        </form>
      )}

      {/* Reviews List */}
      <div className="reviews-list">
        <h4 style={{ margin: '0 0 16px', fontSize: '16px' }}>
          Tất cả nhận xét ({data?.reviews?.length || 0})
        </h4>

        {(!data?.reviews || data.reviews.length === 0) ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px dashed var(--border-color)' }}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
              Chưa có nhận xét nào. Hãy là người đầu tiên chia sẻ cảm nhận về khóa học này!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data.reviews.map((rev: FeedbackItem) => (
              <div
                key={rev.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  gap: '14px',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'var(--bg-subtle)',
                    color: 'var(--accent-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '14px',
                    flexShrink: 0,
                  }}
                >
                  {(rev.user_name || 'U').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{rev.user_name}</strong>
                      <span style={{ color: '#f59e0b', fontSize: '13px', letterSpacing: '2px' }}>
                        {'★'.repeat(rev.rating)}
                        <span style={{ color: 'var(--border-color)' }}>
                          {'★'.repeat(5 - Math.min(5, rev.rating))}
                        </span>
                      </span>
                    </div>
                    <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {new Date(rev.created_at).toLocaleDateString('vi-VN')}
                    </small>
                  </div>
                  {rev.comment ? (
                    <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {rev.comment}
                    </p>
                  ) : (
                    <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      (Người học đã xếp hạng {rev.rating} sao và không để lại bình luận)
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

