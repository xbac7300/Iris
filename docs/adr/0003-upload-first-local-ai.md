# ADR 0003: ưu tiên upload và AI local miễn phí

Ngày: 23/09/2026. Theo yêu cầu mới của người dùng: làm giao diện/upload trước, để dữ liệu đánh giá sau, ưu tiên AI miễn phí chạy local. Quyết định này thay thứ tự gate M0 trong AGENTS.md cho phạm vi UI/upload; không thay Definition of Done và không coi AI đã nghiệm thu.

## Giao diện và upload

Giữ Next.js/React, CSS tự viết để có giao diện giáo dục tông xanh lá–kem, responsive, không lấy template có license chưa rõ hoặc thêm framework không cần thiết. Chia thư viện khóa học, soạn chương/bài, upload tiến độ/hủy, trạng thái worker, video preview và xuất bản. Student đăng ký khóa và xem video. Không hiển thị số liệu analytics/AI giả.

Hai GET modules/lessons dùng OpenAPI/client sinh, bounded pagination và ACL. Lesson trả trạng thái media/job để reload không mất tiến độ xử lý. Upload PUT không gửi bearer/cookie cho storage, không lưu URL ký vào localStorage; logout/unmount hủy XHR và đóng player. CORS bucket chỉ cho WEB_ORIGIN. Upload gián đoạn có thể chọn lại tệp; complete timeout có thể xác nhận lại cùng media ID. Chưa có multipart resume sau đóng trình duyệt.

## Lựa chọn AI để thử ở mốc tiếp theo

Máy đã kiểm tra: AMD Ryzen 7 8845H, Radeon 780M, RAM 32 GB; ảnh người dùng có khoảng 10,6 GB RAM trống tại thời điểm chụp. Chọn ứng viên gọn, không giả định GPU/NPU tăng tốc.

- Generation: [qwen3:4b](https://ollama.com/library/qwen3:4b), Q4_K_M, artifact khoảng 2,5 GB, Apache 2.0; cấu hình thử context 4096, không thinking, concurrency 1. Chưa tải/chạy benchmark trong mốc upload.
- Embedding: [qwen3-embedding:0.6b](https://ollama.com/library/qwen3-embedding:0.6b), Q8_0 khoảng 639 MB; [model gốc](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) Apache 2.0, đa ngôn ngữ, dimension gốc 1024. Kiểm tra dimension thực và pin digest khi pull trước khi tạo index.
- Runtime dự kiến Ollama local, API chỉ bind loopback; không dùng cloud fallback hoặc provider trả phí. CPU là baseline; chỉ bật GPU khi kiểm tra hỗ trợ và đo thực tế. Chạy ASR/index/chat tuần tự để giảm RAM đỉnh; dung lượng file model không phải lượng RAM chạy thực tế.

Model mới chỉ là ứng viên cho proof-of-concept, chưa chốt model cuối theo tiêu chí tiếng Việt. Chưa có số đo chất lượng/latency. Không bắt người dùng chuẩn bị bộ eval ngay; bộ eval vẫn là công việc để nghiệm thu cuối.
