# Kế hoạch kiểm thử

## Đã có test tự động

- Jest: scrypt/salt, mật khẩu sai/hỏng, refresh client single-flight, token storage cleanup, epoch chặn response cũ, web CSRF header. Coverage chỉ giới hạn các module được liệt kê trong jest.config.cjs.
- Integration HTTP trên PostgreSQL thật: migration blank/rerun, email unique/normalize, role escalation, sai login, hash refresh, logout/revoke, refresh đồng thời/replay, expiry không trượt, transport, Secure cookie/Origin/CSRF, ownership, pagination bounds, khóa user và audit.
- Playwright trên API/DB thật: Student register → reload khôi phục cookie → logout; Instructor login → tạo draft. Có thêm E2E media thật: tạo chương/bài → upload → reload → phát/tua → xuất bản → đổi account → enrollment/xem; thêm file hỏng và thay file. Chưa có RAG/quiz/analytics.
- Pytest: SRT/VTT, tiếng Việt, timestamp gốc, nội dung chỉ là dữ liệu, duration NaN/inf/0, bounds, cue rỗng/sai/thứ tự.
- Media integration trên Docker thật: owner/publication/enrollment đồng thời, complete idempotent, outbox reconcile sau mất queue, restart worker, Range, immutable playback, stale media, nguồn đổi ETag, file hỏng, retry tạm thời 4 lượt và manual retry đồng thời. DB test riêng giữ lại, chỉ dọn bucket/queue test.
- Pytest media: giải mã đủ 48 frame của fixture H.264/AAC tự tạo, size/duration bounds, file giả/rỗng. Fixture im lặng không dùng đánh giá AI.
- Storage smoke: anonymous GET/LIST 403, URL hợp lệ 200, Range 206, URL hết hạn/chữ ký sai 403. Compose đã chạy pgvector/Redis/S3 local.

## Gate tiếp theo

1. Bổ sung crash giữa từng bước outbox/worker/COMMIT, cleanup object bỏ dở, resource isolation Windows/container và luồng video Android. Restart có trật tự và mất queue đã có test, chưa đủ thay cho crash fault injection.
2. Mobile: cài APK mới trên thiết bị thật và emulator khác, ghi OS/model/build/network. Đăng nhập, restore SecureStore, logout/đổi account, app background/foreground, mất mạng; không xem export bundle là APK.
3. M3/M4: transcript version bất biến, job cũ không ghi đè, ACL trước retrieval/trước response, source thuộc retrieved set/version/timestamp, prompt injection, provider lỗi khác INSUFFICIENT, quota reservation.
4. M5: công thức 7/10=70%, threshold chưa làm tròn, option sai, submit transaction/idempotency/concurrency; union [0,120]∪[60,180] /600 = 30%, seek/pause/buffer không ghi; CAS resume, duplicate event, queue theo user.
5. M6: migration nâng cấp có dữ liệu, backup/restore thật, 10 user và ≥100 request/nhóm, p95 API <1s; đo video/AI riêng theo AGENTS.md. Không có số liệu tải ở phiên này.

## RAG tái lập

8–12 video được phép, 2–4 giờ; 60 câu chia trước dev 20 (14/3/3), test 40 (26/7/7). Ground truth segment/time độc lập chunk. Hai người chấm; lưu config/model/prompt/hash/latency/token/cost. Recall@5 ≥0.80, đúng/đủ ≥80%, hỗ trợ ≥90%, refusal ≥90% (7/7 test insufficient), summary coverage ≥80%, tất cả test quyền bị chặn. Các mục tiêu này **chưa được đo**.
