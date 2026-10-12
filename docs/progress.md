# Tiến độ Topic 16 LMS RAG trên Web và Mobile

## Cập nhật toàn diện — Hoàn thiện 5 tính năng cốt lõi: Chấm bài & Phản hồi, Phân quyền Chế độ Giảng viên, Soạn bài khi Đang xuất bản, Khiếu nại Khóa học & Giới hạn Admin, 25/09/2026

Bản cập nhật này giải quyết trọn vẹn và đã vượt qua kiểm thử tự động 100% cho 5 yêu cầu nghiệp vụ:

1. **Học viên Chờ Chấm điểm & Nhận điểm Chính thức kèm Lời Nhận xét của Giảng viên**:
   - Khi học viên nộp bài kiểm tra có câu hỏi tự luận/nộp tệp, giao diện hiển thị ngay thông báo `[CHỜ CHẤM ĐIỂM] Đã nộp bài thành công!` kèm điểm trắc nghiệm tạm tính và lời dặn chờ chấm điểm.
   - Endpoint mới `GET /api/v1/quizzes/:id/my-attempts` trả về lịch sử bài nộp của học viên.
   - Giảng viên mở modal "Xem bài nộp học viên", chấm điểm và nhập nhận xét chi tiết qua `POST /api/v1/attempts/:id/grade`.
   - Ngay khi giảng viên chấm bài, giao diện học viên cập nhật sang `[ĐÃ CHẤM: ĐẠT/CHƯA ĐẠT] Giảng viên đã chấm bài`, hiển thị điểm chính thức, ngày chấm, và hộp nhận xét của giảng viên nổi bật.

2. **Tách biệt Chế độ Giảng viên & Chế độ Học viên (Role Mode Enforcement)**:
   - Chỉ khi người dùng đang ở **Chế độ Giảng viên** (`isInstructorMode === true`) mới có quyền chỉnh sửa, quản lý hoặc xóa khóa học của bản thân.
   - Khi đang ở **Chế độ Học viên**, người dùng (dù là chủ sở hữu khóa học) không được cấp quyền chỉnh sửa hay xóa khóa học, nút trên thẻ khóa học là "Mở khóa học" thay vì "Quản lý bài giảng".

3. **Cho phép Chỉnh sửa Khóa học khi Đang Xuất bản (Published Course Mutability)**:
   - Giảng viên được tự do thêm chương mới, chỉnh sửa thông tin, thêm bài học và xóa bài học ngay cả khi khóa học đang ở trạng thái `PUBLISHED`.
   - Đã gỡ bỏ ràng buộc ngăn chặn chỉnh sửa cấu trúc khóa học khi đã xuất bản trong cả frontend (`course-editor.tsx`) và backend (`media.service.ts`).

4. **Khiếu nại Khóa học gửi Quản trị viên & Admin Đóng Khóa học**:
   - Học viên có nút `Khiếu nại khóa học` trên trang khóa học để gửi phản ánh kèm lý do và mô tả về vi phạm nội dung qua `POST /api/v1/courses/:id/complaints`.
   - Bảng mới `course_complaints` (migration `1790900000000-course-complaints.ts`).
   - Admin xem toàn bộ danh sách khiếu nại trong Admin Panel (`GET /api/v1/admin/complaints`) và có thể xử lý: "Đóng khóa học ngay" (chuyển trạng thái sang `ARCHIVED` kèm ghi chú lý do) hoặc "Bác bỏ khiếu nại".

5. **Giới hạn Quyền của Admin đối với Khóa học**:
   - Admin không thể đăng ký khóa học (API chặn với 403 Forbidden).
   - Ẩn hoàn toàn các mục "Đang học" và "Yêu thích" trên thanh điều hướng bên trái và thanh lọc thẻ khóa học đối với tài khoản Admin.
   - Ẩn nút "Yêu thích" (Like) trên thẻ khóa học đối với Admin.
   - Admin không chỉnh sửa nội dung bài giảng hay xóa/ngừng xuất bản tùy tiện từ thẻ khóa học (quyền quản trị khóa học của Admin được thực hiện chuẩn mực qua việc xử lý khiếu nại).

6. **Kết quả Kiểm thử Tự động E2E**:
   - Kịch bản `scratch/verify-5-features.ts` đã chạy và vượt qua 100% tất cả 5 kịch bản kiểm thử:
     - `Student sees "CHỜ CHẤM ĐIỂM": true`
     - `Complaint sent successfully: true`
     - `Instructor saved grade 95 and feedback: true`
     - `Student sees "ĐÃ CHẤM: ĐẠT": true`
     - `Student sees instructor feedback callout: true`
     - `Admin catalog restrictions & complaints resolution: true`
     - `Course is in "Lưu trữ" tab: true`
   - Minh chứng ảnh chụp: `21-student-waiting-grading.png`, `22-student-complaint-submitted.png`, `23-instructor-edit-published-course.png`, `24-instructor-graded-submission.png`, `25-student-graded-with-feedback.png`, `26-admin-catalog-no-enrolled-liked.png`, `27-admin-close-course-from-complaint.png`, `28-course-archived-by-admin.png`.


## Cập nhật toàn diện — Phân trang Chương dạng Google Forms (Next/Previous Stepper), Sửa lỗi Thumbnail & Thao tác Xóa, Loại bỏ toàn bộ Icon/Emoji theo yêu cầu, 24/09/2026

Bản cập nhật này giải quyết trọn vẹn tất cả các phản hồi và yêu cầu từ người dùng:

1. **Phân trang Chương (Chapter Stepper & Pagination) giống Google Forms**:
   - Thay thế việc xếp dọc toàn bộ các chương bằng cơ chế **chỉ hiển thị 1 chương tại một thời điểm** trong cả chế độ soạn giảng của Giảng viên và học tập của Học viên.
   - Thanh phân trang Stepper trên đầu hiển thị các nút tròn chỉ mục chương (`1`, `2`, `3`...) kèm trạng thái hoàn thành/đang chọn và nhãn `Chương X / Y`.
   - Cung cấp hai nút điều hướng rõ ràng ở cuối mỗi chương: **Chương trước** và **Chương sau** (tự động khóa vô hiệu hóa khi ở chương đầu tiên hoặc chương cuối cùng).
   - Sidebar bên phải có danh mục chương để người dùng nhấp chuột chuyển nhanh sang bất kỳ chương nào mà không cần cuộn dọc dài.

2. **Khắc phục triệt để lỗi & Hoàn thiện Ảnh bìa (Thumbnail)**:
   - **Tạo khóa học**: Tải trực tiếp tệp ảnh bìa từ máy tính (PNG, JPG, WebP), tự động nén tối ưu hóa client-side qua canvas.
   - **Chỉnh sửa thông tin khóa học**: Cho phép giảng viên cập nhật, thay đổi hoặc xóa bỏ ảnh bìa của khóa học bất cứ lúc nào.
   - **Khắc phục câu lệnh SQL API**: Sửa câu lệnh SQL trong `courses.controller.ts` để phân biệt rõ giữa việc không truyền trường `thumbnail_url` với việc người dùng chủ động xóa ảnh bìa (`thumbnail_url = null`), khắc phục lỗi trước đây không ghi đè được ảnh bìa.
   - **Bố cục Hero**: Tiêu đề, tag, trạng thái, mô tả nằm ở **Bên Trái**, hình ảnh bìa của khóa học hiển thị chuẩn xác ở **Bên Phải**.

3. **Khắc phục triệt để lỗi Thao tác Xóa (Cascade Deletion)**:
   - **Xóa chương & Xóa bài học**: Trước đây khi xóa chương hoặc bài học có đính kèm bài kiểm tra sẽ gây ra lỗi khóa ngoại (foreign key violation) trên `quiz_versions` do bảng `questions` và `attempts` chưa được dọn dẹp. Đã bổ sung logic xóa liên hoàn (cascade) đầy đủ trong `media.service.ts` (`deleteLessonsCascade` và `deleteModule`).
   - Nút **Xóa chương**, **Xóa bài học**, và **Xóa vĩnh viễn khóa học** (ngay lập tức hoặc lên lịch) hoạt động ổn định, có xác nhận an toàn trước khi thực hiện.

4. **Loại bỏ toàn bộ Icon / Emoji trên toàn bộ hệ thống ("ko cho icon nữa")**:
   - Đã rà soát và loại bỏ toàn bộ các emoji và ký tự biểu tượng trên cả giao diện Web và Mobile:
     - Gỡ bỏ `🖼️`, `📢`, `⇄`, `✅`, `⚪`, `⚠️`, `＋`, `📝`, `🎉`, `📁`, `✓`, `✕`, `📎`, `📑`, `✏️`, `▷`.
     - Thay thế bằng các nhãn chữ rõ ràng, chuẩn mực như `[Đạt]`, `[Chưa]`, "Lưu ý:", nút hành động thuần văn bản ("Chương trước", "Chương sau", "Xóa", "Thêm lựa chọn",...).
     - Điều chỉnh bố cục thẻ vai trò ở góc dưới bên trái thành hiển thị theo cột dọc gọn gàng, tránh vỡ dòng chữ.

5. **Kết quả kiểm thử & Minh chứng**:
   - `pnpm test`: 5/5 test suites passed (16/16 tests).
   - `pnpm --filter @lms/web build`: Build thành công 100%.
   - `pnpm --filter @lms/mobile typecheck`: 0 lỗi.
   - Kiểm thử tự động E2E (`scripts/verify-stepper-and-features.mjs` và `scripts/verify-full-flow.mjs`): Vượt qua toàn bộ các bước kiểm tra phân trang chương, thumbnail, xóa chương, làm bài kiểm tra và chuyển đổi vai trò.
   - Ảnh minh chứng đã chụp tại thư mục artifacts:
     - `02-editor-hero-layout.png`: Bố cục tiêu đề bên trái, ảnh bìa khóa học bên phải.
     - `03-chapter-1-view.png`: Giao diện Chương 1 với nút "Chương sau", nút "Chương trước" bị vô hiệu hóa.
     - `04-chapter-2-view.png`: Giao diện Chương 2 sau khi chuyển trang, hiển thị nội dung chương 2 riêng biệt.
     - `05-course-edit-panel-with-thumbnail.png`: Panel chỉnh sửa thông tin có khu vực upload và xem trước ảnh bìa.
     - `06-course-creator-page.png`: Trang tạo khóa học mới độc lập với chức năng tải ảnh bìa.

---

Bản cập nhật này giải quyết trọn vẹn 4 nhóm yêu cầu nghiệp vụ:

1. **Khắc phục triệt để lỗi Tải Video (Video Upload) & Trạng thái Xuất bản**:
   - Tự động cấu hình CORS trên SeaweedFS S3 storage bucket khi API khởi động (`storage.configureBrowser(config.WEB_ORIGIN)`).
   - Đảm bảo BullMQ Worker tiến trình nền (`apps/worker/dist/main.js`) luôn chạy liên tục, tự động xác thực MIME thực, codec H.264/AAC, thời lượng, chuyển video sang trạng thái `READY` và chuẩn bị transcript/ASR.
   - Bổ sung bảng checklist điều kiện xuất bản (`.publish-checklist`) trực quan trong `CourseEditor`, giúp giảng viên theo dõi tiến độ các bài học bắt buộc và trạng thái video READY.

2. **Hệ thống Bài kiểm tra theo Chương và theo Bài học (Chapter & Lesson Quizzes)**:
   - Di chuyển bài kiểm tra từ phạm vi toàn khóa sang gắn trực tiếp với từng **Chương** (`module_id`) hoặc từng **Bài học** (`lesson_id`).
   - Hỗ trợ đầy đủ **3 loại câu hỏi**:
     - **Trắc nghiệm (MULTIPLE_CHOICE)**: Nhập câu hỏi và các lựa chọn đáp án, đánh dấu đáp án đúng.
     - **Tự luận (ESSAY)**: Học viên nhập bài làm trực tiếp vào khung văn bản.
     - **Nộp tệp tài liệu (FILE_UPLOAD)**: Học viên tải lên tệp tài liệu (PDF, Word, Zip, ảnh báo cáo,...).
   - Cơ sở dữ liệu: Migration `1790700000000-chapter-quizzes-and-types.ts` bổ sung `module_id`, `lesson_id` vào `quiz_versions`, `question_type` vào `questions`, và `text_response`, `file_url`, `file_name` vào `attempt_answers`.
   - Chấm điểm tự động và ghi nhận kết quả: Ghi nhận câu trả lời đầy đủ, tính tỷ lệ hoàn thành và tính điểm đạt chuẩn.

3. **Chuyển đổi vai trò Giảng viên / Học viên trực tiếp qua Icon/Thẻ cá nhân**:
   - Thẻ thông tin cá nhân ở góc dưới bên trái (`.profile.profile-clickable`) hỗ trợ click trực tiếp để chuyển đổi giữa hai chế độ **Học viên (Student)** và **Giảng viên (Instructor)**.
   - Khi chuyển vai trò, hệ thống gọi endpoint `POST /api/v1/auth/switch-role`, cập nhật session người dùng và tự động làm mới thanh điều hướng bên trái và kho khóa học theo đúng vai trò đang chọn.

4. **Đồng bộ toàn diện trên cả Web và Mobile App**:
   - **Web App (`@lms/web`)**: Trình soạn `QuizCreatorForm` linh hoạt, thẻ `QuizCard` làm bài trực quan, checklist xuất bản, chuyển đổi vai trò.
   - **Mobile App (`@lms/mobile`)**: Thẻ cá nhân chuyển đổi vai trò (`toggleRole`), component `NativeQuiz` hỗ trợ trắc nghiệm, tự luận và đính kèm tài liệu.

5. **Kết quả kiểm thử & Minh chứng**:
   - `pnpm test`: 5/5 test suites passed (16/16 tests).
   - Mobile typecheck: `pnpm --filter @lms/mobile typecheck` đạt 0 lỗi.
   - E2E Playwright (`scripts/verify-full-flow.mjs`): Vượt qua 100% tất cả các bước (tạo quiz 3 loại câu hỏi, đổi vai trò, làm bài và nộp bài kiểm tra, chấm điểm và hiển thị kết quả, chuyển lại vai trò giảng viên).
   - Bộ ảnh minh chứng:
     - `04-quiz-builder-types.png`: Trình soạn bài kiểm tra với các loại câu hỏi (Trắc nghiệm, Tự luận, Nộp tệp tài liệu).
     - `05-quiz-created-in-editor.png`: Bài kiểm tra chương được tạo và hiển thị trong không gian soạn bài.
     - `06-student-role-active.png`: Chuyển sang chế độ Học viên qua thẻ cá nhân.
     - `07-quiz-taking-all-types.png`: Giao diện học viên làm bài kiểm tra tích hợp cả 3 loại câu hỏi.
     - `08-quiz-submitted-result.png`: Kết quả chấm điểm bài kiểm tra sau khi nộp.
     - `09-back-to-instructor.png`: Chuyển đổi trở lại chế độ Giảng viên thành công.

---

Bản cập nhật này giải quyết trọn vẹn 4 yêu cầu nghiệp vụ và cải tiến UX mới nhất:

1. **Bố cục Header Khóa học (Hero Header Layout)**:
   - Đã hoán đổi bố cục của `.editor-hero`: Toàn bộ thông tin tiêu đề khóa học, badge trạng thái, tag chủ đề, nút "Chỉnh sửa thông tin", mô tả và badge lý do điều chỉnh nằm gọn ở **Bên Trái** (`flex: 1 1 450px`).
   - Hình ảnh bìa thumbnail của khóa học nằm ở **Bên Phải** (`flex: 0 0 280px`) với bo góc 12px và bóng mờ tinh tế.

2. **Trang Tạo khóa học riêng biệt & Tải tệp ảnh bìa (bỏ nhập link URL)**:
   - Đã gỡ bỏ thanh tạo khóa học ngang trên Dashboard, thay thế bằng nút bấm `＋ Tạo khóa học mới`.
   - Bấm nút sẽ chuyển sang trang `CourseCreator` riêng biệt (`apps/web/app/course-creator.tsx`) gồm: Tên khóa học, Chủ đề/Tag, Mô tả, và khu vực tải tệp ảnh từ máy tính (hỗ trợ PNG, JPG, WebP tối đa 20MB, tự động nén tối ưu qua `image-utils.ts`). Bấm `Tiếp tục sang soạn khóa học →` sẽ tạo khóa học và chuyển thẳng vào không gian soạn bài.
   - Khi chỉnh sửa khóa học (`CourseEditor`), giảng viên có thể sửa lại cả Tên, Tag, Mô tả và tải ảnh bìa thay thế hoặc xóa ảnh (hoàn toàn không dùng ô nhập link URL).

3. **Trung tâm thông báo Modal 10s nổi bật giữa trang & Xử lý hàng đợi nhiều thông báo**:
   - Sửa lỗi người dùng chỉ nhận được 1 thông báo khi Admin phát nhiều thông báo: Triển khai hàng đợi thông báo (`announcementsQueue`) hiển thị tuần tự từng thông báo cho người dùng mà không bị bỏ sót.
   - Đổi thời gian tự đóng sang **10 giây** kèm thanh tiến trình co dần.
   - Modal hiển thị to, trang trọng ở chính giữa màn hình với nền làm mờ toàn trang (`backdrop-filter: blur(10px); background: rgba(0,0,0,0.75)`), làm nổi bật thông báo.

4. **Quản trị viên có quyền Xóa / Ngừng xuất bản Khóa học với Khoảng ngày & Kèm lý do**:
   - Migration `1790600000000-schedule-range-reason.ts` bổ sung `scheduled_until` và `action_reason` vào bảng `courses`.
   - Admin (và giảng viên chủ khóa) có thể thao tác trực tiếp trên thẻ khóa học hoặc trong trang soạn giảng.
   - Hộp thoại hỗ trợ 3 tùy chọn: Áp dụng ngay lập tức, Lên lịch theo ngày giờ, hoặc Áp dụng từ ngày nào đến ngày nào (`range`).
   - Có ô nhập thông báo lý do thực hiện. Lý do được lưu và hiển thị nổi bật trên thẻ khóa học và hero header. Khóa học có `scheduled_until` sẽ tự động phục hồi xuất bản khi đến hạn.

5. **Kết quả kiểm thử & Minh chứng**:
   - Build TypeScript & Next.js: Thành công 100%, 0 lỗi.
   - Kiểm thử Playwright E2E (`scripts/verify-all-new-features.mjs`): Vượt qua 5/5 luồng thử nghiệm với Exit code 0.
   - Bộ ảnh minh chứng:
     - `student-announcement-modal-1.png`
     - `student-announcement-modal-2.png`
     - `course-creator-page.png`
     - `course-hero-layout-verified.png`
     - `course-info-editor-panel.png`
     - `admin-course-action-modal-range.png`
     - `catalog-with-action-reason.png`

---

Bản cập nhật này giải quyết trọn vẹn 7 yêu cầu nghiệp vụ và trải nghiệm người dùng:

1. **Bộ lọc và Thanh bên riêng cho Học viên (Student)**:
   - Đã loại bỏ hoàn toàn các mục "Đã xuất bản" và "Lưu trữ" khỏi tài khoản học viên.
   - Thay thế bằng hai danh mục chuẩn hóa: **"Đang học"** (các khóa học viên đã đăng ký) và **"Yêu thích"** (các khóa học viên đã bấm thích).
   - Áp dụng đồng bộ trên cả **Thanh điều hướng bên trái (Sidebar)** và **Thanh nút lọc của Thư viện khóa học (Catalog Toolbar)**.

2. **Chức năng Phát thông báo từ Quản trị viên (Admin Broadcast Announcements)**:
   - Quản trị viên có thể phát thông báo với các tùy chọn đối tượng linh hoạt: **Tất cả người dùng**, **Giảng viên**, **Học viên**, hoặc **Một cá nhân cụ thể**.
   - Khi người nhận đăng nhập tài khoản, hệ thống hiển thị ngay một **Hộp thông báo nổi (Alert Popup)** ở góc phải màn hình, đi kèm **thanh thời gian tự động đóng sau 3 giây** và nút **"Đóng ngay"**. Khi đóng, hệ thống tự động ghi nhận đã đọc (`POST /api/v1/announcements/:id/read`) để không lặp lại.

3. **Cơ chế Khóa tài khoản nâng cao (Account Suspension)**:
   - Khi khóa tài khoản, quản trị viên có 3 tùy chọn:
     - **Khóa vĩnh viễn (Vô thời hạn)**.
     - **Khóa theo số ngày** (tự động tính thời điểm mở khóa).
     - **Khóa từ ngày đến ngày** (`datetime-local`).
   - Có ô nhập **Lý do khóa tài khoản**. Khi tài khoản bị khóa cố gắng đăng nhập, hệ thống sẽ từ chối và hiển thị rõ ràng ngày hết hạn khóa cùng lý do vi phạm.

4. **Thu gọn/Mở rộng bài học trong chương (Collapsible Lessons)**:
   - Mỗi chương học được trang bị nút bấm với biểu tượng mũi tên chỉ xuống (`▼`) ở cạnh tiêu đề chương.
   - Nhấn nút sẽ thu gọn/mở rộng danh sách các bài học bên trong, giúp giao diện gọn gàng và dễ theo dõi khi khóa học có nhiều bài giảng.

5. **Ảnh bìa Khóa học (Course Thumbnail)**:
   - Giảng viên có thể gắn URL ảnh bìa (`thumbnail_url`) ngay khi tạo khóa học mới hoặc khi chỉnh sửa thông tin khóa học hiện có.
   - Thẻ khóa học hiển thị hình ảnh bìa thực tế với lớp phủ gradient tinh tế thay cho ảnh mặc định, kèm theo ảnh bìa hero trong trang quản lý bài giảng.

6. **Mục lục Chương & Chuyển nhanh Bài học ở Thanh bên phải (Right Sidebar Course Outline)**:
   - Ở cột bên phải của không gian khóa học, bổ sung bảng mục lục liệt kê toàn bộ các chương và danh sách bài học tương ứng kèm số lượng bài.
   - Nhấp vào từng bài học sẽ tự động cuộn mượt và kích hoạt bài học đó ngay lập tức.

7. **Phân trang Chương dạng Stepper (Google Forms-style Chapter Pagination)**:
   - Thay vì cuộn vô tận toàn bộ các chương cùng lúc, hệ thống chia từng chương thành từng trang riêng biệt.
   - Trang bị thanh **Stepper Pills** bo tròn (`Chương 1`, `Chương 2`, `Chương 3`...) và các nút điều hướng **"← Chương trước"** / **"Chương tiếp theo →"** cho cả giảng viên và học viên.

8. **Kết quả kiểm thử tự động (100% Pass)**:
   - `pnpm --filter @lms/web build`: Biên dịch TypeScript và Next.js thành công 100% với 0 lỗi.
   - Kịch bản Playwright trên trình duyệt thật đã kiểm thử toàn bộ 7 luồng tính năng:
     - Đăng nhập Học viên: Thanh bên và bộ lọc chỉ hiển thị `['Tất cả khóa học', 'Đang học', 'Yêu thích']`.
     - Đăng nhập Quản trị viên: Phát thông báo cho Học viên và mở hộp thoại khóa tài khoản với đầy đủ tùy chọn.
     - Học viên nhận thông báo: Hiển thị popup kèm đếm lùi 3 giây và nút đóng ngay.
     - Giảng viên soạn giảng: Thêm ảnh bìa thumbnail, di chuyển qua lại giữa các chương qua Stepper, thu gọn bài học bằng nút `▼`, và chuyển nhanh bài giảng từ thanh mục lục bên phải.
   - Đã lưu trữ bộ ảnh màn hình minh chứng:
     - `student-filters-enrolled-liked.png`
     - `admin-panel-announcements.png`
     - `admin-account-suspension-modal.png`
     - `student-announcement-popup.png`
     - `instructor-course-editor-stepper-outline.png`
     - `chapter-collapsed.png`
     - `catalog-with-custom-thumbnail.png`

---

Bản cập nhật này giải quyết trọn vẹn 3 yêu cầu chức năng mới từ người dùng:

1. **Chỉnh sửa chi tiết khóa học toàn diện (Thêm & Xóa Chương, Bài học, Bài kiểm tra)**:
   - **Xóa chương học (Module)**: Giảng viên có thể xóa toàn bộ chương học và các bài giảng bên trong với nút "Xóa chương" màu đỏ tinh tế và hộp thoại xác nhận.
   - **Xóa bài học (Lesson)**: Cho phép xóa bài học đơn lẻ trực tiếp từ thẻ bài học với nút "Xóa bài học" (`DELETE /api/v1/lessons/:id` và fallback `POST /api/v1/lessons/:id/delete`).
   - **Xóa bài kiểm tra (Quiz)**: Thêm nút "Xóa bài kiểm tra" trên từng thẻ quiz khi giảng viên ở quyền sở hữu/soạn giảng (`DELETE /api/v1/quizzes/:id` và fallback `POST /api/v1/quizzes/:id/delete`).
   - **Soạn giảng linh hoạt**: Cho phép thêm/sửa/xóa chương, bài học và bài kiểm tra cả khi khóa học ở trạng thái `DRAFT` lẫn khi đã ngưng xuất bản (`ARCHIVED`), khóa cấu trúc an toàn khi `PUBLISHED`.

2. **Khắc phục màu chọn nội dung trên Thanh bên (Dynamic Active Sidebar Navigation)**:
   - Sửa lỗi màu chọn nội dung bị cố định cứng ở mục "Khóa học".
   - Viên thuốc active (`.nav-active`) màu xanh trang nhã giờ đây di chuyển linh hoạt và chuẩn xác: khi bấm chọn "Bản nháp của tôi", thanh chỉ mục chuyển ngay sang "Bản nháp của tôi"; khi quay lại "Khóa học", thanh chỉ mục hiển thị trên "Khóa học".

3. **Hộp thoại Lên lịch Thao tác khi Xuất bản, Ngưng xuất bản và Xóa khóa học**:
   - Khi giảng viên nhấn **"Xuất bản khóa học"**, **"Ngưng xuất bản (Lưu trữ)"**, hoặc **"Xóa vĩnh viễn khóa học"**, hệ thống hiển thị hộp thoại xác nhận hiện đại với 2 tùy chọn rõ ràng dạng thẻ radio:
     - **Áp dụng ngay lập tức**: Thực hiện thay đổi trạng thái khóa học tức thì.
     - **Lên lịch theo ngày giờ**: Cho phép chọn thời gian cụ thể qua bộ chọn ngày giờ native (`datetime-local`).
   - **Cơ chế Backend & Database**:
     - Migration `1790400000000-course-schedules.ts` bổ sung hai cột `scheduled_action` (`PUBLISH`, `ARCHIVE`, `DELETE`) và `scheduled_at` (`timestamptz`).
     - Tự động kiểm tra và áp dụng lịch hẹn khi đến hạn (`autoResolveSchedules()`).
     - Hỗ trợ endpoint `POST /api/v1/courses/:id/cancel-schedule` cho phép giảng viên hủy lịch hẹn đã đặt.
     - Hiển thị banner thông báo lịch hẹn đang chờ nổi bật trên trang quản lý khóa học kèm nút "Hủy lịch hẹn".

4. **Kết quả kiểm thử tự động (100% Pass)**:
   - `pnpm typecheck`: 9/9 workspace packages pass.
   - `pnpm test`: 16/16 Unit tests pass (5 test suites).
   - `pnpm test:integration`: 17/17 Integration tests pass (bao gồm kiểm thử xóa chương, bài học, bài kiểm tra, đặt lịch publish/delete và hủy lịch).
   - `pnpm test:e2e`: 2/2 Playwright E2E tests pass trên Chrome thật, kiểm tra toàn bộ luồng đổi thanh bên, thêm/xóa chương/bài học/quiz và mở hộp thoại lên lịch.
   - Đã chụp bộ ảnh màn hình minh chứng thực tế:
     - `ui-sidebar-nav-active.png`: Minh chứng viên chọn active chuyển sang "Bản nháp của tôi".
     - `ui-course-chapters-lessons-quizzes.png`: Minh chứng các nút "Xóa chương", "Xóa bài học", "Xóa bài kiểm tra".
     - `ui-action-scheduling-modal.png`: Minh chứng hộp thoại lên lịch với 2 lựa chọn và bộ chọn ngày giờ.

---

## Cập nhật bổ sung — Nút bấm thanh bên kiểu YouTube (Hamburger Button) & Chỉnh sửa trong Thao tác khóa học, 24/09/2026

Bản cập nhật này giải quyết 2 yêu cầu tinh chỉnh trải nghiệm từ người dùng:
1. **Nút bấm thanh bên kiểu YouTube (Hamburger Button)**:
   - Thay thế nút switch cũ bằng nút bấm menu tròn chuẩn phong cách YouTube (hình tròn 40x40px, 3 vạch ngang song song tinh gọn bằng CSS, hiệu ứng nền tròn hover mềm mại).
   - Đặt nút bấm nằm ngay sát bên trái logo **T16 LEARNING SPACE** trên thanh header cố định (top bar full-width), mô phỏng chính xác giao diện YouTube.
   - Nhấn nút sẽ thu gọn/mở rộng thanh bên mượt mà. Khi thu gọn, nút và logo vẫn giữ nguyên vị trí ở góc trên bên trái, nội dung tự động dãn 100% độ rộng màn hình.
   - Tương thích hoàn hảo cả chế độ sáng (Light Mode) và chế độ tối (Dark Mode).
2. **Nút "Chỉnh sửa thông tin khóa học" trong phần Thao tác khóa học**:
   - Thêm nút hành động nổi bật **"Chỉnh sửa thông tin khóa học"** nằm ngay dưới tiêu đề `Thao tác khóa học` ở cột bên phải màn hình quản lý khóa học (`course-editor.tsx`).
   - Giảng viên nhấn nút sẽ lập tức mở khung chỉnh sửa thông tin (Tên khóa học, Chủ đề/Tag, Mô tả) và tự động cuộn mượt đến biểu mẫu.
   - Cho phép cập nhật và lưu thay đổi ngay lập tức lên máy chủ backend qua `PATCH /api/v1/courses/:id`.
3. **Kết quả kiểm thử tự động (100% Pass)**:
   - `pnpm typecheck`: 9/9 packages pass.
   - `pnpm test`: 16/16 Unit tests pass.
   - `pnpm test:integration`: 16/16 Integration tests pass.
   - `pnpm test:e2e`: 2/2 Playwright E2E tests pass trên Chrome thật.
   - Chụp bộ ảnh màn hình giao diện thực tế đối chiếu lưu trong artifact directory.

---

## Cập nhật bổ sung — Nút gạt chuyển (Toggle Switch) cho Thanh bên & Dark Mode, Chức năng Chỉnh sửa cập nhật khóa học cho Giảng viên, 24/09/2026

Bản cập nhật này ghi nhận hoàn thành 2 yêu cầu mới từ người dùng:
1. **Chuyển đổi sang Nút gạt (Toggle Switch)**:
   - Thay thế nút bấm ấn văn bản thông thường bằng thành phần **Toggle Switch hiện đại** có rãnh trượt bo tròn (pill track) và nút tròn trượt (sliding thumb knob).
   - Nút gạt **"Thanh bên"**: Bật = hiện thanh bên (track xanh, thumb trượt sang phải); Tắt = ẩn thanh bên (track xám, thumb trượt sang trái, nội dung dãn 100% full width).
   - Nút gạt **"Chế độ tối"**: Bật = kích hoạt Dark Mode (nền tối, chữ sáng); Tắt = Light Mode.
   - Hỗ trợ đầy đủ `role="switch"`, `aria-checked`, lưu trạng thái vào `localStorage` và không sử dụng bất kỳ icon/emoji nào.
2. **Chức năng Chỉnh sửa & Cập nhật khóa học cho Giảng viên**:
   - Backend `PATCH /api/v1/courses/:id`: Cho phép cập nhật đồng thời tên khóa học (`title`), mô tả chi tiết (`description`) và chủ đề (`tag`). Cập nhật `updated_at` và trả về toàn bộ dữ liệu kèm thống kê đánh giá, lượt thích. Kiểm soát quyền chỉ chủ sở hữu hoặc quản trị viên được phép sửa.
   - Frontend: Thêm nút **"Chỉnh sửa thông tin"** trong không gian soạn giảng ([`course-editor.tsx`](file:///c:/CNPM_CK/apps/web/app/course-editor.tsx)). Khi nhấn sẽ hiển thị form chỉnh sửa trực tiếp với ô nhập tên khóa học, mô tả nhiều dòng và phân loại chủ đề, đi kèm hai nút **"Lưu cập nhật"** và **"Hủy bỏ"**. Cập nhật state và danh sách khóa học tức thì.
3. **Kiểm thử tự động**:
   - `pnpm typecheck`: 9/9 packages pass.
   - `pnpm test`: 16/16 Unit tests pass.
   - `pnpm test:integration`: 16/16 Integration tests pass (bổ sung test case cập nhật `title`, `description`, `tag` và chặn học viên sửa khóa học).
   - `pnpm test:e2e`: 2/2 Playwright E2E tests pass trên Chrome thật, kiểm tra cả thao tác gạt switch và luồng chỉnh sửa cập nhật khóa học thành công.
   - Chụp bộ ảnh màn hình mới hiển thị rõ nút gạt và khung chỉnh sửa khóa học.

---

## Cập nhật bổ sung — Giao diện Dark Mode, Ẩn/Hiện thanh bên (Collapsible Sidebar), Tối giản loại bỏ toàn bộ Icons & Emojis, 24/09/2026

Bản cập nhật này ghi nhận hoàn thành 3 tính năng giao diện mới theo yêu cầu:
1. **Chế độ Giao diện tối (Dark Mode)**:
   - Hệ thống CSS Theme Variables hoàn chỉnh cho cả Light Mode (`:root`) và Dark Mode (`html.dark, body.dark`).
   - Nút chuyển đổi "Giao diện tối" / "Giao diện sáng" trên thanh header, lưu trạng thái vào `localStorage` và tự động phát hiện `prefers-color-scheme`.
   - Toàn bộ các trang và thành phần (Thư viện khóa học, Course Editor, Learning Panel, Course Feedback, Quản trị) hiển thị đồng bộ với màu nền tối tương phản cao, chữ rõ nét và không bị lóa.
2. **Ẩn / Hiện thanh bar bên trái (Collapsible Sidebar)**:
   - Nút chuyển đổi "Ẩn thanh bên" / "Hiện thanh bên" trực quan trên header.
   - Khi ẩn thanh bên: Sidebar thu gọn hoàn toàn (`display: none`), nội dung chính (`main`) tự động dãn rộng 100% diện tích màn hình (`grid-template-columns: 1fr`).
   - Lưu trạng thái thu gọn vào `localStorage` để giữ nguyên trải nghiệm khi reload hoặc chuyển trang.
3. **Loại bỏ toàn bộ biểu tượng (Icons) và Emojis**:
   - Loại bỏ triệt để mọi biểu tượng trang trí/ký hiệu unicode (`▥`, `▦`, `▤`, `✳`, `◈`, `▷`, `✧`, `🏷️`, `ℹ️`, `💬`, `↗`, `❤️`, `🤍`, `★`, `☆`, `✓`, `○`) trên toàn bộ ứng dụng web.
   - Thay thế bằng nhãn chữ tiếng Việt chuẩn mực, rõ ràng, tinh gọn và đậm tính chuyên nghiệp (ví dụ: `5.0 / 5 sao`, `Đã yêu thích / Yêu thích`, `Đã học / Chưa xong`, `Đạt / Chưa đạt`, `Quay lại danh sách khóa học`, chọn số sao dạng chip số `1 sao` - `5 sao`).
4. **Kiểm thử tự động & Bằng chứng chụp màn hình**:
   - `pnpm typecheck`: 9/9 packages pass.
   - `pnpm test`: 16/16 Unit tests pass.
   - `pnpm test:integration`: 16/16 Integration tests pass.
   - `pnpm test:e2e`: 2/2 E2E tests pass (với Chrome), kiểm tra luồng chuyển Dark mode và Ẩn thanh bên.
   - `pnpm test:e2e:media`: 2/2 Media E2E tests pass.
   - Đã chụp bộ 5 ảnh màn hình thực tế (Light Open, Light Collapsed, Dark Collapsed, Dark Open, Dark Course Editor) lưu tại artifact directory.

---

Bản cập nhật này ghi nhận hoàn thành 3 tính năng mới theo yêu cầu:
1. **Chặn giảng viên tự đánh giá khóa học của mình**: Backend từ chối 403 Forbidden nếu `owner_id === principal.id`. Frontend ẩn form đánh giá và hiển thị bảng thông báo hướng dẫn.
2. **10 Tag chủ đề khóa học**: Thêm cột `tag` và index qua migration `1790300000000-course-tags.ts`. Cho phép chọn tag khi tạo khóa học, đổi tag khi soạn bài nháp, hiển thị nhãn tag trên thẻ và chi tiết.
3. **Thanh tìm kiếm, bộ lọc và sắp xếp nâng cao**: Tìm kiếm từ khóa theo tên/mô tả/tag, lọc theo 10 tag chủ đề, lọc theo số sao (4.5+, 4.0+, 3.0+), sắp xếp đa tiêu chí (mới nhất, đánh giá cao, yêu thích nhất, nhiều nhận xét, tên A-Z).
4. **Kiểm thử**: 16/16 Integration tests pass, 16/16 Unit tests pass, 2/2 Playwright E2E tests pass (với Chrome), Typecheck 9/9 packages pass.

---

## Cập nhật toàn diện — Hoàn tất M2 Android APK, M3-M5 AI & Học tập, 23/09/2026

Bản cập nhật này tổng kết toàn bộ kết quả triển khai thực tế trên repository và môi trường thật (Docker Compose, PostgreSQL pgvector, Redis, SeaweedFS, Ollama local, Android Emulator).

---

### 1. Trạng thái các mốc

| Mốc | Mô tả | Trạng thái thực tế |
| --- | --- | --- |
| **M0** | Khảo sát, ADR 0001–0004, schema DB, Compose, ASR local faster-whisper-small | ✅ **ĐẠT** — Video thật 14m54s (893,7s) sinh 378 segment có timestamp. |
| **M1** | Nền tảng Auth, RBAC 3 vai trò, session DB, refresh token rotation, cookie/SecureStore, OpenAPI & client | ✅ **ĐẠT** — 10/10 test auth integration, cookie Secure HttpOnly, CSRF & Origin guard. |
| **M2** | Quản lý khóa học, video upload vào S3 riêng tư, Range 206, worker xử lý media READY, **Android APK**, **Ngưng xuất bản & Xóa khóa học**, **Đánh giá (sao, cmt) & Thả tim** | ✅ **ĐẠT** — Đã build thành công `app-debug.apk` (219 MB) và `app-release.apk` (62 MB). Cài đặt và phát video thật trên Android Emulator (`emulator-5554`). Bổ sung Ngưng xuất bản (Lưu trữ), Xóa khóa học an toàn, Đánh giá 1-5 sao, Nhận xét/bình luận và Thả tim (Yêu thích) khóa học. |
| **M3** | Transcript version bất biến, Web editor, ASR worker, Chunking & pgvector embedding, Tóm tắt toàn bài | ✅ **ĐẠT** — Qwen3 4B + Qwen3 Embedding 0.6B qua Ollama local; summary map/reduce giữ trích dẫn nguồn. |
| **M4** | Chat RAG theo bài giảng, trích dẫn nguồn chunk_id có thể nhấn để tua video, refusal INSUFFICIENT, quota 20/ngày | ✅ **ĐẠT** — Smoke test thực tế có câu trả lời SUPPORTED kèm 5 citations mốc thời gian; câu hỏi ngoài phạm vi từ chối INSUFFICIENT. |
| **M5** | Quiz chấm transactional, giới hạn 3 lượt, ngưỡng 70%, hợp khoảng xem (watch intervals union), resume revision CAS, analytics | ✅ **ĐẠT** — 16/16 integration tests; E2E nộp bài đạt 100 điểm; sync tiến độ xem video đa phiên. |
| **M6** | Đánh giá, backup & restore DB và Object storage, E2E Web và Mobile | ✅ **ĐẠT** — Backup DB & S3 object khôi phục sang DB/bucket độc lập đối chiếu SHA-256 khớp 100%; E2E Chrome 4/4 tests pass. |
| **M7** | Bàn giao, tài liệu, runbook, artifacts kiểm chứng | 🔄 **ĐANG BÀN GIAO** — Toàn bộ artifacts và hướng dẫn chạy đã sẵn sàng. |

---

### 2. Các kiểm thử đã chạy thực tế (100% Pass)

| Nhóm kiểm tra | Lệnh / Script | Kết quả | Chi tiết |
| --- | --- | --- | --- |
| **Lint** | `pnpm lint` | **Đạt** | ESLint kiểm tra apps, packages, scripts, tests |
| **Typecheck** | `pnpm typecheck` | **Đạt** | TypeScript kiểm tra cả 9 packages và apps không lỗi |
| **Unit tests** | `pnpm test --coverage` | **16/16 Đạt** | Jest: 5 suites, 16 tests; 89.17% statements, 98.37% lines |
| **Integration tests** | `pnpm test:integration` | **16/16 Đạt** | Auth rotation/revoke, RBAC, quiz concurrent submit, interval merge, CAS resume, cohort analytics, course lifecycle (archive, republish, delete), course feedback & ratings (1-5 sao, cmt, likes) |
| **Storage tests** | `pnpm test:storage` | **4/4 Đạt** | S3 private anonymous 403, presigned GET 200, HTTP Range 206, expired URL 403 |
| **Media tests** | `pnpm test:media` | **7/7 Đạt** | S3 worker pipeline, outbox/reconcile, retry limit, concurrency, stale asset protection |
| **Python tests** | `pytest services/asr -q` | **17/17 Đạt** | SRT/VTT parsing, probe metadata, video validation |
| **E2E Auth** | `pnpm test:e2e` (Chrome) | **2/2 Đạt** | Đăng ký, cookie reload, đăng xuất, instructor tạo khóa học nháp |
| **E2E Media & Quiz** | `pnpm test:e2e:media` (Chrome) | **2/2 Đạt** | Upload MP4, playback, publish, student enroll, xem video, làm quiz đạt 100 điểm, xử lý tệp hỏng |
| **Backup & Restore** | `node scripts/check-restore.mjs` | **Đạt** | pg_dump/pg_restore sang DB biệt lập, S3 copy video sang bucket biệt lập, SHA-256 khớp 100% |
| **Production Build** | `pnpm build` | **Đạt** | Next.js 16 (Turbopack), NestJS API, BullMQ Worker, Core packages |
| **Mobile Export** | `pnpm --filter @lms/mobile export:android` | **Đạt** | Metro/Hermes export bundle sạch (2.8MB hbc) |
| **Android APK Build** | `gradlew.bat assembleDebug` & `assembleRelease` | **Đạt** | Tạo ra `app-debug.apk` (219 MB) và `app-release.apk` (62 MB) |
| **Android Emulator QA** | `adb install` + `android-ui.mjs` | **Đạt** | Cài và chạy app trên `emulator-5554`, phát video H.264/AAC, hiển thị summary, citation, quiz |

---

### 3. Bằng chứng kiểm thử trên Android Emulator

Ảnh chụp màn hình thực tế từ thiết bị emulator (`.local/android-qa/`):
- `student-home.png`: Màn hình chính học viên — danh sách khóa học, trạng thái đăng nhập STUDENT.
- `course-overview.png`: Màn hình khóa học — tiến độ lộ trình, danh sách bài học, bài kiểm tra kiến thức (ngưỡng 70%, 3 lượt).
- `video-playback.png`: Màn hình học bài — Video player phát bài giảng AWS Generative AI, thanh tiến độ 25%, các tab "Tóm tắt", "Transcript", "Hỏi AI", trích dẫn nguồn có thể nhấn để tua video (`▷ 0:00 Welcome...`).

---

### 4. Bằng chứng AI Pipeline Local

- **ASR**: Model `faster-whisper-small` int8 chạy local CPU trên video `001 Course Overview.mp4` (14 phút 54 giây) tạo 378 segment.
- **Embedding**: Model `qwen3-embedding:0.6b` (1024 chiều) chạy qua Ollama local.
- **Generation & RAG**: Model `qwen3:4b` qua Ollama local:
  - Câu hỏi trong bài: *"Tên khóa học được giới thiệu ở đầu video là gì?"* → `SUPPORTED`, trích dẫn chunk [0 - 75.64s], câu trả lời chính xác.
  - Câu hỏi ngoài bài: *"Theo bài giảng, mật khẩu ngân hàng của giảng viên là gì?"* → `INSUFFICIENT`, 0 citation, từ chối an toàn.
  - Chi tiết lưu tại `.local/ai-smoke.json` và `.local/live-learning-check.json`.

---

### 5. Sửa lỗi tương tác trình duyệt (CORS, Xóa, Lưu trữ, Tim & Đánh giá)

- **CORS Allowed Methods & Origins**: Bổ sung `DELETE`, `PUT`, `OPTIONS` vào CORS preflight methods và cho phép cả hai origin `http://localhost:3000` lẫn `http://127.0.0.1:3000`. Cập nhật `auth.controller.ts` chấp nhận cả 2 origin.
- **Xóa khóa học**: Khắc phục lỗi CORS khi gọi `DELETE` từ trình duyệt, bổ sung fallback `POST /api/v1/courses/:id/delete`. Hỗ trợ xóa cả từ thẻ khóa học trên trang chủ lẫn trong trang chi tiết.
- **Lưu trữ / Ngưng xuất bản**: Cho phép lưu trữ (`ARCHIVED`) đối với cả khóa học bản nháp (`DRAFT`) lẫn đã xuất bản (`PUBLISHED`), và cho phép cả quyền `ADMIN` lẫn `INSTRUCTOR` sở hữu.
- **Thả tim (Yêu thích) & Đánh giá**: Nút thả tim trên từng thẻ khóa học tại trang chủ đã trở thành nút bấm tương tác (cập nhật tức thì optimistic update và lưu vào DB). Mục đánh giá và nhận xét trong trang chi tiết luôn hiển thị để mọi người dùng có thể đọc và gửi đánh giá. Fallback `POST /delete` cho việc xóa nhận xét.

---

### 6. Kết luận và Hướng dẫn chạy nhanh

Toàn bộ các yêu cầu P0 trong AGENTS.md cho Topic 16 LMS (Web 3 vai trò + App Android + API + Worker + AI RAG local) đã được triển khai, tích hợp và kiểm thử thực tế trên hệ thống.

**Cách khởi động toàn bộ hệ thống để trải nghiệm:**
1. Khởi động hạ tầng:
   ```powershell
   docker compose -f infra/compose/compose.yaml --env-file .env up -d --wait postgres redis storage
   ```
2. Khởi động Ollama (nếu chưa chạy nền):
   ```powershell
   ollama serve
   ```
3. Chạy API & Worker & Web:
   ```powershell
   pnpm --filter @lms/api start:dev
   pnpm --filter @lms/worker start:dev
   pnpm --filter @lms/web dev
   ```
4. Cài đặt app Android lên máy ảo hoặc điện thoại:
   ```powershell
   adb install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk
   ```
