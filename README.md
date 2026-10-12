# TOPIC 16: HỆ THỐNG LMS TÍCH HỢP RAG AI TRÊN WEB VÀ ANDROID

Hệ thống quản lý học tập (LMS) hoàn chỉnh với website đa vai trò (Học viên, Giảng viên, Quản trị viên) và ứng dụng di động Android gốc (React Native / Expo), hỗ trợ bài giảng video, transcript đồng bộ, tóm tắt AI, hỏi đáp RAG AI có trích dẫn timestamp tua video, bài kiểm tra có giới hạn thời gian và theo dõi tiến độ đa nền tảng.

---

## 1. Kiến trúc và công nghệ

- **Web (`apps/web`)**: Next.js 15, React 19, TypeScript, trình phát video HTML5, giao diện chuyển đổi vai trò, dark mode, trung tâm thông báo, quản lý khóa học và bảng điều khiển quản trị viên.
- **Mobile (`apps/mobile`)**: React Native, Expo 57, Expo Router, `expo-video`, `expo-secure-store`, kết nối API động, lưu trữ bảo mật refresh token, hỗ trợ đầy đủ các tính năng học tập từ web.
- **Backend API (`apps/api`)**: NestJS 11, RESTful API `/api/v1`, OpenAPI (Swagger), TypeORM, PostgreSQL + pgvector, RBAC phân quyền chặt chẽ.
- **Worker xử lý nền (`apps/worker`)**: BullMQ, Redis, Node.js, subprocess FFmpeg và Python faster-whisper cho pipeline trích xuất âm thanh và nhận dạng phụ đề.
- **Storage**: Lưu trữ tệp tương thích S3 (MinIO / AWS S3) với Presigned URL bảo mật, hỗ trợ HTTP Range streaming video.
- **Thư viện dùng chung (`packages/`)**:
  - `@lms/api-client`: Client TypeScript sinh từ đặc tả OpenAPI với cơ chế tự động xoay vòng refresh token single-flight.
  - `@lms/contracts`: Định nghĩa kiểu và quy tắc nghiệp vụ dùng chung.
  - `@lms/design-tokens`: Màu sắc, spacing và typography.

---

## 2. Yêu cầu môi trường

- **Node.js**: v24.15.0 trở lên.
- **Package Manager**: pnpm v10.34.5 (sử dụng `pnpm.cmd` trên Windows PowerShell).
- **Docker Desktop**: Chạy PostgreSQL, pgvector, Redis, MinIO S3.
- **Python**: 3.12 (dành cho ASR whisper).
- **Android SDK & Thiết bị**: Điện thoại Android (Android 8.0 trở lên) hoặc Android Emulator để cài đặt file `app-release.apk`.

---

## 3. Hướng dẫn khởi chạy hệ thống (Web, API & Worker)

### Bước 1: Cài đặt thư viện dependencies
```powershell
pnpm.cmd install --frozen-lockfile
```

### Bước 2: Khởi tạo cấu hình và hạ tầng Docker
```powershell
# Tạo cấu hình môi trường bảo mật nếu chưa có
node scripts/init-local.mjs

# Khởi chạy Docker Compose (PostgreSQL, Redis, MinIO)
docker compose --env-file .env -f infra/compose/compose.yaml up -d
```

### Bước 3: Build các package và chạy migration cơ sở dữ liệu
```powershell
pnpm.cmd build
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd storage:configure
```

### Bước 4: Khởi chạy toàn bộ dịch vụ
```powershell
pnpm.cmd dev:all
```
Sau khi chạy:
- **Website LMS**: `http://localhost:3000`
- **Backend API**: `http://localhost:4000/api/v1`
- **Tài liệu Swagger / OpenAPI**: `http://localhost:4000/api/docs`

---

## 4. Tài khoản kiểm thử mặc định (Seed Data)

Mật khẩu của tất cả tài khoản seed được lưu tự động trong biến `SEED_PASSWORD` tại file `.env` cục bộ:
- **Học viên (Student)**: `student@lms.example`
- **Giảng viên (Instructor)**: `instructor@lms.example`
- **Quản trị viên (Admin)**: `admin@lms.example`

Ngoài ra, hệ thống cho phép người dùng tự đăng ký tài khoản mới trực tiếp trên Web và App, tự chọn vai trò (Học viên hoặc Giảng viên) và đăng ký thêm vai trò trong trang cá nhân.

---

## 5. Hướng dẫn cài đặt và kiểm thử Ứng dụng Android

### 5.1. File APK cài đặt
File APK phát hành chính thức nằm trực tiếp tại thư mục gốc dự án:
```text
C:\CNPM_CK\app-release.apk
```

### 5.2. Cách cài đặt lên điện thoại thật
**Cách 1 (Nhanh nhất):**
1. Sao chép tệp `app-release.apk` vào bộ nhớ điện thoại (qua dây cáp USB, Zalo, Google Drive hoặc thẻ nhớ).
2. Trên điện thoại Android, mở ứng dụng **Quản lý tệp (File Manager)**, tìm đến file `app-release.apk` và nhấn **Cài đặt**.
3. Nếu điện thoại yêu cầu, hãy bật cho phép **"Cài đặt ứng dụng từ nguồn không xác định"** cho trình quản lý tệp.

**Cách 2 (Sử dụng lệnh ADB):**
Bật chế độ **USB Debugging (Gỡ lỗi USB)** trên điện thoại và chạy lệnh:
```powershell
adb install -r C:\CNPM_CK\app-release.apk
```

### 5.3. Kết nối App với máy chủ API
1. Đảm bảo điện thoại và máy tính chạy server đang kết nối **cùng một mạng Wi-Fi (LAN)**.
2. Kiểm tra địa chỉ IP LAN của máy tính bằng lệnh `ipconfig` (ví dụ: `192.168.1.12`).
3. Mở ứng dụng **TOPIC 16 LMS** trên điện thoại:
   - Ứng dụng đã mặc định trỏ tới `http://192.168.1.12:4000`.
   - Nếu IP máy tính của bạn thay đổi, bạn có thể dễ dàng nhấn vào biểu tượng quả địa cầu 🌐 ở góc trên bên phải màn hình để nhập IP mới (ví dụ: `http://192.168.1.15:4000`) và nhấn **Lưu & Kết nối**.

### 5.4. Các tính năng nổi bật trên ứng dụng di động:
- **Đăng nhập & Đăng ký**: Hỗ trợ đăng nhập nhanh bằng tài khoản seed hoặc đăng ký tài khoản mới với vai trò Học viên / Giảng viên.
- **Quản lý tài khoản**: Đổi qua lại giữa chế độ Học viên và Giảng viên, đăng ký thêm vai trò.
- **Trung tâm thông báo (🔔)**: Xem thông báo hệ thống từ Admin, thông báo nộp bài và các hoạt động khóa học.
- **Khám phá khóa học**: Tìm kiếm thời gian thực, lọc theo danh mục chủ đề (CNTT, Kinh doanh, Đồ họa, Ngoại ngữ,...), lọc theo tab (Tất cả, Đang học, Yêu thích, Khóa của tôi).
- **Thẻ khóa học chi tiết**: Ảnh đại diện, chế độ truy cập (Công khai, Chia sẻ link, Chỉ định), đánh giá sao, số lượt thích (thả tim nhanh).
- **Lộ trình học tập**: Xem tiến độ hoàn thành khóa học dạng thanh phần trăm (% bài hoàn thành).
- **Danh mục chương & bài học**: Danh mục dạng accordion (mũi tên ▼ / ▲) thu gọn/mở rộng từng chương, nhấn vào bài học bất kỳ để phát video ngay lập tức.
- **Trình phát Video chuẩn Native**: Phát video mượt mà, ghi nhận tiến độ xem thực tế (ProgressTracker) chống tua gian lận.
- **Tóm tắt bài học AI**: Hiển thị tóm tắt nội dung bài học kèm các trích dẫn timestamp (▷ mm:ss); nhấn vào trích dẫn sẽ lập tức tua video đến đúng giây đó.
- **Transcript đồng bộ**: Phụ đề từng đoạn kèm timestamp; nhấn vào bất kỳ đoạn nào để tua video tới mốc thời gian tương ứng.
- **Hỏi đáp trợ lý AI RAG**: Đặt câu hỏi về bài giảng, nhận câu trả lời có kèm nguồn trích dẫn tua video.
- **Kiểm tra kiến thức (Quiz)**:
  - Hỗ trợ các câu hỏi: Trắc nghiệm (Multiple Choice), Tự luận (Essay), Nộp tệp/tài liệu (File Attachment).
  - Hỗ trợ đếm ngược thời gian (Timer) cho bài thi có giới hạn thời gian, tự động nộp bài khi hết giờ.
  - Xem điểm số, kết quả Đạt / Chưa đạt, xem lại lịch sử các lần làm bài trước đó.
  - **Chế độ chấm bài dành cho Giảng viên**: Giảng viên có thể xem danh sách bài nộp của học viên, xem bài tự luận, nhập điểm số, nhận xét và lưu kết quả chấm.
- **Đánh giá & Khiếu nại**: Học viên có thể đánh giá sao kèm nhận xét, hoặc gửi đơn khiếu nại khóa học trực tiếp về cho Quản trị viên xử lý.

---

## 6. Các lệnh kiểm thử chất lượng mã nguồn (Quality Assurance)

```powershell
# Kiểm tra linting
pnpm.cmd lint

# Kiểm tra kiểu dữ liệu TypeScript toàn bộ workspace
pnpm.cmd typecheck

# Chạy unit tests nghiệp vụ
pnpm.cmd test

# Chạy integration tests API & Database
pnpm.cmd test:integration
```
