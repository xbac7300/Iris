# ADR 0004 — AI local và dữ liệu học tập

Ngày: 23/09/2026. Trạng thái: triển khai baseline, đang kiểm thử.

Theo yêu cầu dùng model miễn phí, nguồn chỉ xử lý local. Ollama 0.34.2 được pin digest trong Compose; Qwen3 4B dùng generation, Qwen3 Embedding 0.6B dùng embedding 1024 chiều, faster-whisper-small CPU int8 làm ASR. Adapter kiểm tra chiều vector thực, ID model được lưu cùng index; generation không được gọi tool hoặc tự tìm web. Tên model là tag có thể thay đổi nên bằng chứng thực nghiệm phải lưu digest trong `.local/ai-smoke.json`/kết quả eval.

Transcript và index bất biến theo phiên bản. Worker ghi task trong cùng transaction với nguồn; DB là nguồn trạng thái chuẩn, BullMQ nhận lại task pending hoặc lease hết hạn. Mỗi worker AI concurrency=1; vận hành local chỉ chạy một worker. INDEX và SUMMARY độc lập, lỗi summary không chặn retrieval. Thay transcript làm index cũ stale và dừng chat mới đến khi nguồn mới sẵn sàng.

PostgreSQL chính có pgvector. Vector lưu float8[] với CHECK cardinality và cast sang vector trong exact cosine retrieval đã scope lesson/index trước khi xếp hạng. Không có ANN index và không có vector DB riêng. Lý do biểu diễn array: test nền tảng bằng embedded PostgreSQL Windows không có binary extension; API AI thật vẫn bắt buộc pgvector và model thật. Thay model/dimension tạo index mới, không trộn embedding. Khi dữ liệu tăng cần đo rồi chuyển column/index native vector bằng migration riêng.

Chunk baseline cắt theo segment với ngân sách khoảng 1600 ký tự; overlap theo segment ngắn hoặc 100 ký tự ở segment rất dài. Đây là xấp xỉ 300–500 token cho tiếng Anh, **không bảo đảm token budget tiếng Việt**; cần tokenizer/eval trước chốt chất lượng. Các phần giữ segment IDs và timestamp gốc; không nội suy mốc thời gian khi tách text dài.

Quiz được kiểm tra và khóa ngay khi tạo; giảng viên chỉ thêm khi course DRAFT chưa enrollment. Lượt làm khóa threshold/max attempts, submit row lock và idempotency. Không gửi cờ đáp án đúng xuống student. Course structure hiện tạo bản mới bằng khóa mới; chưa có thao tác clone một chạm.

Progress giữ hợp khoảng xem và resume độc lập. Queue trong RAM của phiên client, scope user/media; logout xóa queue. Mất mạng ngắn có thể retry khi màn vẫn mở, chưa hứa giữ dữ liệu qua việc hệ điều hành đóng app hoặc reload tab. Server trả `session_current` để client sửa revision sau mất ACK mà không cho phiên cũ giành checkpoint của thiết bị mới.

Nguồn kỹ thuật: [Ollama API](https://docs.ollama.com/api), [quản lý model và concurrency](https://docs.ollama.com/faq), [pgvector](https://github.com/pgvector/pgvector), [Expo Video SDK](https://docs.expo.dev/versions/latest/sdk/video/). API Expo triển khai đối chiếu typings của expo-video 57.0.4 đã cài; không thay version theo tài liệu latest.
