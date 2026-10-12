# Phạm vi và backlog

Nguồn yêu cầu: `AGENTS.md`, `Bao_cao_Topic16_Web_App_RAG.docx` phiên bản 2.0. Những ngưỡng trong báo cáo là mục tiêu, không phải kết quả. Dự án khởi đầu từ thư mục chưa có code hoặc Git metadata ngày 22/09/2026.

## Phạm vi

P0: web Student/Instructor/Admin, Android Student, API chung, khóa/chương/bài, enrollment, media, transcript version, summary, RAG có timestamp, quiz, progress/sync, analytics, quản trị và artifact bàn giao. P1 và loại trừ giữ nguyên AGENTS.md. Mã iOS không được coi là đã build/test.

## Backlog theo gate

| Mốc | Công việc | Gate còn phải chứng minh |
| --- | --- | --- |
| M0 | Khảo sát, ADR, ERD; video → transcript → RAG; native player | Video có license và model thật, câu trả lời có nguồn, player trên Android |
| M1 | Workspace, migration, auth/session, RBAC, OpenAPI, login hai client | CI remote, đăng nhập Android thật; Compose đã chạy local |
| M2 | Course/module/lesson version, publication, enrollment; upload/private S3/outbox/worker | Upload/retry/restart không trùng; phát video hai client; APK preview |
| M3 | SRT/VTT/ASR, transcript bất biến, exact pgvector, summary toàn bài | Timestamp đầu/giữa/cuối; stale job không thay pointer; AI lỗi không chặn video |
| M4 | Chat có ACL trước/sau retrieval, citation xác minh, quota, lịch sử riêng | Model thật; prompt injection/cross-course; source seek web/Android |
| M5 | Quiz lock/idempotency, interval union/CAS, queue theo user, analytics | 7/10=70%; retry/concurrency; offline cũ; logout không lộ dữ liệu |
| M6 | E2E P0, tải, restore, migration nâng cấp và đánh giá AI | Số liệu thật có dữ liệu/cấu hình/phần cứng và lỗi |
| M7 | Runbook, artifact checksum, demo | Web URL và APK theo phạm vi triển khai được cho phép |

## Lát cắt hiện tại

Đăng ký chỉ Student; session JWT 15 phút, refresh 7 ngày tuyệt đối, hash và rotation; API kiểm tra DB trên request mới. Instructor quản lý metadata và cấu trúc khóa nháp thuộc sở hữu. Publish yêu cầu ít nhất một video bắt buộc và mọi video READY; khóa xuất bản không thay cấu trúc/media. Enrollment idempotent, archive chặn người mới và giữ học viên cũ. Upload/private playback/outbox/worker đã chạy local; Web đã có UI upload/player/xuất bản và đăng ký học; Android chưa có màn học tích hợp. Admin có endpoint khóa/mở tài khoản với audit. Chưa có chat/quiz/progress/analytics.

OpenAPI chỉ mô tả endpoint đã có. Những endpoint còn lại trong AGENTS.md phải được đặc tả request/response/error ở mốc triển khai trước khi nối client, không thêm endpoint giả trả thành công.
