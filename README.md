# TOPIC 16: HỆ THỐNG QUẢN TRỊ HỌC TẬP LMS TÍCH HỢP TRỢ LÝ RAG AI (WEB & ANDROID)

> **Dự án Đề tài 16**: Xây dựng nền tảng học trực tuyến hiện đại (LMS) với ứng dụng Web đa vai trò và Ứng dụng Di động Android gốc (React Native Expo), tích hợp sâu công nghệ AI RAG (Retrieval-Augmented Generation), phụ đề transcript đồng bộ, tóm tắt bài giảng theo dòng thời gian, đề thi tự động và hệ thống quản trị - khiếu nại toàn diện.

---

## MỤC LỤC
1. [Giới thiệu & Tính năng nổi bật](#1-giới-thiệu--tính-năng-nổi-bật)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Cấu trúc thư mục & Ý nghĩa từng thành phần](#3-cấu-trúc-thư-mục--ý-nghĩa-từng-thành-phần)
4. [Tài khoản đăng nhập hệ thống](#4-tài-khoản-đăng-nhập-hệ-thống)
5. [Hướng dẫn cài đặt & Triển khai toàn bộ hệ thống](#5-hướng-dẫn-cài-đặt--triển-khai-toàn-bộ-hệ-thống)
6. [Hướng dẫn cài đặt & Sử dụng Ứng dụng Android](#6-hướng-dẫn-cài-đặt--sử-dụng-ứng-dụng-android)
7. [Các quy chuẩn chất lượng & Lệnh kiểm thử](#7-các-quy-chuẩn-chất-lượng--lệnh-kiểm-thử)
8. [Chính sách bảo mật & Xử lý lỗi](#8-chính-sách-bảo-mật--xử-lý-lỗi)

---

## 1. GIỚI THIỆU & TÍNH NĂNG NỔI BẬT

Hệ thống LMS Topic 16 được thiết kế theo mô hình **Modular Monolith** kết hợp **Worker xử lý nền**, phục vụ trọn vẹn 3 nhóm người dùng: **Học viên (Student)**, **Giảng viên (Instructor)** và **Quản trị viên (Admin)**.

### 1.1. Dành cho Học viên (Student)
- **Khám phá khóa học**: Tìm kiếm thời gian thực, lọc theo danh mục chủ đề (CNTT, Kinh doanh, Phát triển,...), chế độ xem dạng tab (Tất cả, Đang học, Yêu thích).
- **Học tập đa phương tiện**: Trình phát video chất lượng cao hỗ trợ HTTP Range streaming; ghi nhận thời gian học thực tế (chống tua gian lận).
- **Phụ đề transcript đồng bộ**: Hiển thị từng câu thoại bài giảng theo mốc thời gian (timestamp); nhấn vào câu thoại bất kỳ để tua video đến đúng giây đó.
- **Tóm tắt bài học AI**: Tóm tắt tổng quan bài giảng kèm các trích dẫn mốc thời gian; nhấn vào trích dẫn để nhảy đến phân đoạn video liên quan.
- **Trợ lý hỏi đáp RAG AI**: Trực tiếp hỏi đáp về nội dung bài giảng. Trợ lý AI chỉ trả lời dựa trên bằng chứng thực tế từ bài học, kèm nguồn trích dẫn cụ thể (start_sec, end_sec, trích đoạn).
- **Kiểm tra đánh giá (Quiz)**:
  - Làm bài thi trắc nghiệm (Multiple Choice), tự luận (Essay) và nộp tài liệu (File Upload).
  - Đồng hồ đếm ngược (Timer) với cơ chế tự động nộp bài khi hết giờ.
  - Xem kết quả điểm số, phản hồi chi tiết và lịch sử các lượt làm bài (tối đa 3 lượt).
- **Đánh giá & Khiếu nại**: Đánh giá số sao (1-5 sao) kèm nhận xét; gửi đơn khiếu nại trực tiếp đến Quản trị viên khi phát hiện nội dung sai lệch hoặc vi phạm.

### 1.2. Dành cho Giảng viên (Instructor)
- **Quản lý khóa học của tôi**: Quản lý các khóa học do chính tài khoản tạo, chuyển đổi linh hoạt giữa các trạng thái Bản nháp (DRAFT), Đã xuất bản (PUBLISHED) hoặc Lưu trữ (ARCHIVED).
- **Soạn thảo chương trình học**: Thêm/sửa/xóa chương học, tạo bài học video, tải ảnh bìa trực tiếp từ máy tính/điện thoại (không bắt buộc nhập URL).
- **Tải lên & Xử lý Video**: Tải video MP4 (dung lượng tối đa 500 MiB); hệ thống tự động kiểm tra định dạng và đưa vào hàng đợi xử lý nền.
- **Soạn thảo & Chấm điểm Đề thi**:
  - Soạn đề thi gắn theo từng chương học cụ thể hoặc toàn khóa.
  - Thiết lập ngưỡng điểm đạt (Pass threshold), số lượt làm bài và thời gian làm bài (phút).
  - Giao diện chấm bài chuyên dụng: Xem danh sách học viên nộp bài, đọc bài tự luận, nhập điểm số và gửi nhận xét cá nhân hóa cho học viên.
- **Lên lịch hành động**: Lên lịch xuất bản, tạm ẩn hoặc xóa khóa học kèm lý do thông báo cho học viên.

### 1.3. Dành cho Quản trị viên (Admin)
- **Phát thông báo hệ thống**: Gửi thông báo ưu tiên xuất hiện ngay chính giữa màn hình (Pop-up trung tâm có đếm ngược tự đóng và lưu trạng thái đã đọc).
- **Xử lý khiếu nại**: Tiếp nhận các báo cáo từ học viên, rà soát chi tiết và đưa ra quyết định: Đóng/khóa khóa học vi phạm hoặc Bác bỏ khiếu nại.
- **Khóa tài khoản & Khóa khóa học**:
  - Khóa vĩnh viễn hoặc khóa có thời hạn (theo số ngày hoặc khoảng thời gian từ ngày A đến ngày B).
  - Tự động mở khóa khi hết hạn và thu hồi phiên đăng nhập ngay lập tức khi tài khoản bị khóa.
- **Audit Logs**: Giám sát và ghi nhận toàn bộ hành động nhạy cảm trong hệ thống.

---

## 2. KIẾN TRÚC HỆ THỐNG

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPLICATIONS                           │
│   Web (Next.js 15 App Router)        Mobile App (React Native Expo)    │
│   - Student / Instructor / Admin     - Android Release APK             │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │ RESTful /api/v1                 │ RESTful /api/v1
                   ▼                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API (NestJS 11)                         │
│  - Modular Monolith: Auth, Courses, Learning, Media, Admin             │
│  - RBAC & Ownership Guards, Session Store, JWT Single-Flight           │
│  - OpenAPI / Swagger Documentation (/api/docs)                         │
└──────────────┬─────────────────────────────┬───────────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌───────────────────────────────────────┐
│     DATA LAYER & SEARCH      │ │        STORAGE & ASYNC WORKER         │
│  - PostgreSQL 16             │ │  - MinIO / AWS S3 (Presigned URLs)    │
│  - pgvector (Vector search)  │ │  - Redis (BullMQ Job Queues)          │
│  - TypeORM Controlled Migr.  │ │  - Worker: FFmpeg, Whisper ASR,       │
│  - Full SQL Constraints      │ │            Chunking, Embedding, Summ. │
└──────────────────────────────┘ └───────────────────────────────────────┘
```

---

## 3. CẤU TRÚC THƯ MỤC & Ý NGHĨA TỪNG THÀNH PHẦN

```text
CNPM_CK/
├── apps/
│   ├── web/                    # Ứng dụng Web Next.js (Dành cho 3 vai trò)
│   │   ├── app/
│   │   │   ├── page.tsx            # Trang chủ: Danh mục khóa học, đăng nhập/đăng ký, chuyển vai trò
│   │   │   ├── course-learning.tsx # Giao diện học tập: Video player, Transcript, AI RAG, Quiz
│   │   │   ├── course-editor.tsx   # Trình quản lý soạn thảo khóa học, bài học, tải video, chấm thi
│   │   │   ├── course-creator.tsx  # Modal tạo khóa học mới với tải ảnh bìa trực tiếp
│   │   │   ├── course-feedback.tsx # Giao diện đánh giá sao và gửi khiếu nại khóa học
│   │   │   ├── admin-panel.tsx     # Bảng quản trị: Khóa user, khóa course, duyệt khiếu nại, phát thông báo
│   │   │   ├── image-utils.ts      # Tiện ích nén và xử lý tệp ảnh trước khi lưu trữ
│   │   │   └── globals.css         # Hệ thống stylesheet Dark/Light mode chuẩn glassmorphism
│   │   └── package.json
│   ├── mobile/                 # Ứng dụng Di động React Native (Expo Router)
│   │   ├── app/
│   │   │   ├── _layout.tsx         # Root layout: ThemeProvider, Stack Navigation, StatusBar
│   │   │   ├── index.tsx           # Trang chủ di động: Drawer menu bên trái, chuyển vai trò, danh mục
│   │   │   ├── course/[id].tsx     # Màn hình học tập di động: Fixed header, Video Native, Transcript, RAG
│   │   │   └── course/edit/[id].tsx# Màn hình quản lý bài giảng di động dành cho Giảng viên
│   │   ├── src/
│   │   │   ├── theme.tsx           # Quản lý Dark/Light mode và bảng màu sắc
│   │   │   ├── session.ts          # Quản lý phiên, SecureStore token và chuyển đổi vai trò
│   │   │   ├── learning.tsx        # Component bài học, trích dẫn RAG, Quiz và chấm bài di động
│   │   │   └── image-picker.ts     # Tiện ích chọn ảnh từ thư viện máy Android (không dùng URL)
│   │   ├── android/                # Thư mục mã nguồn native Android (Gradle build)
│   │   └── package.json
│   ├── api/                    # Ứng dụng Backend API NestJS
│   │   ├── src/
│   │   │   ├── auth/               # Module Xác thực: Đăng nhập, đăng ký, JWT, refresh rotation, RBAC
│   │   │   ├── courses/            # Module Khóa học: CRUD, xuất bản, lưu trữ, xóa, lịch trình
│   │   │   ├── learning/           # Module Học tập: Tiến độ xem (Interval union), Quiz, RAG Chat, Tóm tắt
│   │   │   ├── media/              # Module Phương tiện: Presigned upload URL, complete, streaming
│   │   │   ├── admin/              # Module Quản trị: Khóa người dùng/khóa học, khiếu nại, thông báo
│   │   │   ├── db/
│   │   │   │   ├── migrations/     # Các tệp migration SQL TypeORM có kiểm soát phiên bản
│   │   │   │   └── database.module.ts
│   │   │   ├── app.ts & main.ts    # Khởi tạo NestJS application, validation pipe, swagger
│   │   └── package.json
│   └── worker/                 # Tiến trình xử lý nền (Background Worker)
│       ├── src/
│       │   ├── worker.ts           # BullMQ worker: Video validation, audio extraction, Whisper, RAG Index
│       │   └── processor.ts
│       └── package.json
├── packages/
│   ├── api-client/             # Client SDK TypeScript sinh tự động từ OpenAPI
│   ├── contracts/              # Kiểu dữ liệu và định nghĩa nghiệp vụ dùng chung
│   └── design-tokens/          # Màu sắc, typography, kích thước khoảng cách giao diện
├── services/
│   └── asr/                    # Kịch bản Python phục vụ nhận dạng giọng nói tự động (Whisper)
├── infra/
│   └── compose/
│       └── compose.yaml        # Cấu hình Docker Compose: PostgreSQL (pgvector), Redis, MinIO
├── docs/                       # Tài liệu thiết kế hệ thống, kiến trúc, OpenAPI, tiến độ
│   ├── openapi.json            # Đặc tả API theo chuẩn OpenAPI 3.0
│   ├── progress.md             # Nhật ký chi tiết tiến độ phát triển và các mốc hoàn thành
│   └── architecture.md
├── app-release.apk             # Tệp cài đặt chính thức cho điện thoại Android
├── package.json                # Cấu hình pnpm workspace gốc
├── pnpm-workspace.yaml
└── README.md                   # Tài liệu hướng dẫn tổng quan dự án
```

---

## 4. TÀI KHOẢN ĐĂNG NHẬP HỆ THỐNG

Cơ sở dữ liệu đã được tinh gọn và đồng bộ chuẩn xác với **3 tài khoản chính thức** đại diện cho 3 vai trò:

| Vai trò | Email đăng nhập | Mật khẩu mặc định | Quyền hạn và phạm vi sử dụng |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin@lms.example` | `ChangeMe123!` | Toàn quyền quản trị hệ thống, xử lý khiếu nại, khóa người dùng/khóa học, phát thông báo khẩn cấp, xem audit log. |
| **Giảng viên (Instructor)** | `instructor@lms.example` | `ChangeMe123!` | Tạo và biên tập khóa học, tải video bài giảng, soạn bài thi, xem bài nộp và thực hiện chấm bài tự luận. |
| **Học viên (Student)** | `student@lms.example` | `ChangeMe123!` | Đăng ký khóa học, học video, xem phụ đề transcript, hỏi đáp trợ lý AI RAG, làm bài kiểm tra và đánh giá khóa học. |

> **Lưu ý**: Ngoài 3 tài khoản chính, người dùng có thể tự bấm **Đăng ký tài khoản mới** trực tiếp trên Web hoặc Ứng dụng Di động để kiểm tra luồng đăng ký tài khoản tự động (mặc định nhận vai trò Học viên và có thể tự nâng cấp thành Giảng viên trong trang cá nhân).

---

## 5. HƯỚNG DẪN CÀI ĐẶT & TRIỂN KHAI TOÀN BỘ HỆ THỐNG

### 5.1. Yêu cầu môi trường
- **Hệ điều hành**: Windows 10/11, macOS hoặc Linux.
- **Node.js**: Phiên bản LTS `v20` đến `v24` (Đã kiểm thử tối ưu trên `v24.15.0`).
- **Trình quản lý gói**: `pnpm` (Khuyến nghị dùng lệnh `pnpm.cmd` trên Windows PowerShell).
- **Docker & Docker Compose**: Để chạy cơ sở dữ liệu PostgreSQL (pgvector), Redis và kho MinIO S3.
- **Android**: Thiết bị thật hoặc giả lập chạy Android 8.0 trở lên.

### 5.2. Các bước triển khai chi tiết

#### Bước 1: Cài đặt thư viện dependencies
Tại thư mục gốc dự án `c:\CNPM_CK`:
```powershell
pnpm.cmd install
```

#### Bước 2: Khởi tạo biến môi trường & Hạ tầng Docker
```powershell
# 1. Tạo tệp .env cấu hình nội bộ
node scripts/init-local.mjs

# 2. Khởi chạy PostgreSQL (pgvector), Redis và MinIO S3
docker compose --env-file .env -f infra/compose/compose.yaml up -d
```

#### Bước 3: Biên dịch thư viện và Thực thi Migration Cơ sở dữ liệu
```powershell
# Biên dịch các package dùng chung và API
pnpm.cmd build

# Chạy migration bảng dữ liệu
pnpm.cmd db:migrate

# Cấu hình bucket lưu trữ tệp trên MinIO S3
pnpm.cmd storage:configure
```

#### Bước 4: Khởi chạy toàn bộ hệ thống
Khởi chạy đồng thời Web, API và Worker chỉ với một câu lệnh:
```powershell
pnpm.cmd dev:all
```

Sau khi khởi chạy thành công:
- **Ứng dụng Web**: [http://localhost:3000](http://localhost:3000)
- **Cổng API Backend**: [http://localhost:4000/api/v1](http://localhost:4000/api/v1)
- **Tài liệu Swagger / OpenAPI**: [http://localhost:4000/api/docs](http://localhost:4000/api/docs)

---

## 6. HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG ỨNG DỤNG ANDROID

### 6.1. Tệp cài đặt APK độc lập
Bản phát hành chính thức đã được biên dịch sẵn và lưu ngay tại thư mục gốc:
- **Đường dẫn**: `C:\CNPM_CK\app-release.apk`
- **Mã băm kiểm tra (SHA-256)**: `5C10CA7708C2330BCCEF3C3836061893713B12ABEA110A5E4EC44D61EB4D6938`

### 6.2. Các bước cài đặt lên điện thoại Android thật
1. **Chuyển tệp APK vào điện thoại**:
   - Kết nối điện thoại với máy tính qua cáp USB và sao chép tệp `app-release.apk` vào thư mục `Download` của máy.
   - Hoặc gửi tệp qua Zalo / Google Drive / Email.
2. **Tiến hành cài đặt**:
   - Trên điện thoại, mở ứng dụng **Quản lý tệp (Files / File Manager)**, chọn `app-release.apk`.
   - Chọn **Cài đặt**. Nếu điện thoại hỏi quyền, hãy bật cho phép **"Cài đặt ứng dụng từ nguồn không xác định"**.
   - Mở ứng dụng **TOPIC 16 LMS**.

### 6.3. Kết nối Ứng dụng Di động với Máy chủ API
Để điện thoại giao tiếp được với API chạy trên máy tính:
1. Đảm bảo điện thoại và máy tính kết nối **chung một mạng Wi-Fi** (hoặc mạng LAN).
2. Kiểm tra địa chỉ IP nội bộ của máy tính: Mở Terminal gõ `ipconfig` (ví dụ: `192.168.1.12`).
3. Trong ứng dụng trên điện thoại:
   - Nhấn mở **Menu bên trái (Drawer ☰)** hoặc nhấn nút cấu hình IP.
   - Nhập URL máy chủ: `http://<IP_MÁY_TÍNH>:4000` (ví dụ: `http://192.168.1.12:4000`).
   - Nhấn **Lưu & Kiểm tra kết nối**. Ứng dụng sẽ tự động lưu địa chỉ này vào bộ nhớ an toàn (`SecureStore`) và kết nối ngay lập tức.

### 6.4. Cách tự biên dịch lại APK (Khi cần thay đổi mã nguồn)
Nếu bạn có chỉnh sửa mã nguồn di động và muốn tạo file APK mới:
```powershell
cd apps/mobile/android
.\gradlew.bat assembleRelease --no-daemon
```
Tệp APK mới tạo sẽ nằm tại: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

---

## 7. CÁC QUY CHUẨN CHẤT LƯỢNG & LỆNH KIỂM THỬ

Hệ thống tuân thủ nghiêm ngặt các tiêu chuẩn kiểm thử tự động, cam kết không sử dụng dữ liệu giả (mock data) trong các bài kiểm tra tích hợp:

```powershell
# 1. Kiểm tra quy chuẩn mã nguồn (Linting)
pnpm.cmd lint

# 2. Kiểm tra tính an toàn kiểu dữ liệu TypeScript (Toàn bộ 10 projects)
pnpm.cmd typecheck

# 3. Kiểm thử đơn vị nghiệp vụ (Unit tests: Tính điểm, gộp khoảng thời gian xem, thuật toán)
pnpm.cmd test

# 4. Kiểm thử tích hợp toàn diện với cơ sở dữ liệu thật (17/17 Integration Tests)
pnpm.cmd test:integration
```

---

## 8. CHÍNH SÁCH BẢO MẬT & XỬ LÝ LỖI

- **Bảo mật phiên đăng nhập (JWT & Refresh Token Rotation)**:
  - Access Token có thời hạn 15 phút, lưu trong bộ nhớ an toàn.
  - Refresh Token lưu dạng băm (`SHA-256`), thời hạn tối đa 7 ngày, cơ chế xoay vòng liên tục và tự động thu hồi toàn bộ phiên nếu phát hiện dấu hiệu tái sử dụng token cũ.
  - Client di động áp dụng cơ chế **Single-Flight Refresh** chống tình trạng race-condition khi nhiều yêu cầu API được gửi đồng thời lúc token vừa hết hạn.
- **Kiểm soát quyền truy cập tài nguyên (RBAC & Ownership)**:
  - Giảng viên chỉ được phép biên tập khóa học do chính mình tạo ra (`owner_id === user.id`).
  - Học viên chỉ được xem bài học, phụ đề và chat AI trên các khóa học mà mình đã đăng ký hợp lệ.
  - Quản trị viên quản lý toàn bộ hệ thống qua các endpoint kiểm tra quyền nghiêm ngặt, có ghi nhận `audit_logs`.
- **Hệ thống AI RAG Có Trích Dẫn & Chống Prompt Injection**:
  - Toàn bộ nội dung phụ đề từ người dùng được xử lý như văn bản dữ liệu thuần túy (không thực thi lệnh ẩn).
  - Phản hồi từ mô hình AI bắt buộc đi kèm `evidence_status` (`SUPPORTED` hoặc `INSUFFICIENT`) và danh sách `citations` tương ứng với mốc giây thực tế của video bài giảng.

---
*Dự án hoàn thành đầy đủ các yêu cầu theo bản đặc tả đề tài Topic 16 LMS RAG.*
