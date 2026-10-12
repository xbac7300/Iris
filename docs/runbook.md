# Vận hành nền tảng

Các lệnh cài đặt/migration/seed/chạy client nằm trong README. Mỗi môi trường có `.env` riêng; không copy secret sang client. `scripts/init-local.mjs` chỉ dành cho local và không ghi đè file.

## Khởi động và chẩn đoán

1. Chạy Compose rồi chờ postgres/redis healthy; kiểm tra storage log. Không dùng `down -v` khi cần giữ dữ liệu.
2. Build API, chạy `db:migrate`, chạy `db:seed` nếu là dev. Production từ chối seed.
3. Khởi động API; `GET /api/v1/health` phải trả 200. Swagger chỉ mở ngoài production.
4. Chạy web/app với API URL phù hợp. Nếu web refresh 403, kiểm tra Origin chính xác và custom header; nếu 401 sau concurrent refresh, kiểm tra client có dùng SessionClient chung.
5. Error response có request_id. API không ghi body/token vào log. Không gửi file `.env` để hỗ trợ lỗi.

Worker đã chạy nền: `pnpm --filter @lms/worker dev`, cần build media-core/API/worker, venv Python và cấu hình `.env`. Chạy `pnpm test:storage` để khởi tạo/kiểm tra bucket local. `GET /jobs/{id}` cho chủ khóa xem trạng thái; lỗi tạm thời retry tối đa 3 lần sau lượt đầu, file hỏng không retry. `POST /jobs/{id}/retry` chỉ áp dụng lỗi tạm thời đã FAILED. Dừng bằng Ctrl+C để chờ job đang chạy. Sau restart, outbox và reconcile khôi phục job pending từ DB; không xóa Redis/volume để xử lý lỗi thông thường.

Media chỉ READY khi giải mã thành công và copy sang object playback riêng; URL upload cũ không sửa được object này. ASR/RAG chưa tích hợp, ai_status vẫn NOT_STARTED. Chạy `pnpm storage:configure` một lần (và khi đổi WEB_ORIGIN) để cấu hình browser CORS. `pnpm dev:all` chạy API/web/worker. Nếu PUT lỗi, kiểm tra Docker, origin và S3 endpoint; nếu đang kiểm tra lâu, kiểm tra worker và Python path. URL playback local dùng localhost; Android vẫn cần endpoint/port LAN trong mạng thử nghiệm.

## Session

Refresh tối đa bảy ngày từ lúc login, không gia hạn khi rotate. Reuse token cũ thu hồi phiên. Khóa user có hiệu lực ở request tiếp theo; mở lại user không khôi phục phiên đã thu hồi. Web cookie Secure cần localhost hoặc HTTPS. Local LAN qua HTTP chỉ dành cho app thử nghiệm; deployment dùng HTTPS và cấu hình origin chính xác.

Logout luôn xóa state client; nếu mạng lỗi UI nói rõ chưa xác nhận revoke server. Có thể đăng nhập lại để tạo phiên mới. Job cleanup session/token hết hạn chưa triển khai; thêm retention job trước môi trường lâu dài.

## Backup và phát hành

Chưa thử backup/restore, chưa tạo image ứng dụng hoặc APK, chưa có production config được nghiệm thu. Trước triển khai: backup DB và object metadata, restore vào DB/bucket biệt lập, kiểm tra ownership/version, chạy migrations theo lịch sử và smoke E2E. Không coi việc có Compose/CI YAML là đã triển khai hoặc CI đã chạy.

GitHub Actions đã cấu hình nhưng chưa đẩy repository, nên chưa có run CI remote. CI dùng dependency/action đã pin; kết quả local được ghi trong progress. Khi tạo artifact, bổ sung commit SHA, checksum và cấu hình môi trường không chứa secret.
