import { expect, test } from '@playwright/test';

test('học viên đăng ký, khôi phục cookie sau reload và đăng xuất', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chưa có tài khoản? Đăng ký' }).click();
  await page.getByLabel('Họ và tên').fill('Học viên E2E');
  await page.getByLabel('Email').fill(`student-${Date.now()}@e2e.example`);
  await page.getByLabel('Mật khẩu').fill('E2E-only-password-123');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xin chào, Học viên E2E' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo bản nháp' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Xin chào, Học viên E2E' })).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage).filter(k => !['theme', 'sidebar_open'].includes(k)), session: Object.keys(sessionStorage), cookie: document.cookie })))
    .toEqual({ local: [], session: [], cookie: '' });
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
});

test('giảng viên đăng nhập, sử dụng nút gạt chuyển giao diện/thanh bên và chỉnh sửa cập nhật khóa học', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('instructor@e2e.example');
  await page.getByLabel('Mật khẩu').fill('E2E-only-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xin chào, Giảng viên thử nghiệm' })).toBeVisible();

  // Test Dark Mode toggle switch
  const darkSwitch = page.getByRole('switch', { name: 'Chế độ tối' });
  await expect(darkSwitch).toHaveAttribute('aria-checked', 'false');
  await darkSwitch.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(darkSwitch).toHaveAttribute('aria-checked', 'true');

  // Test Sidebar toggle hamburger button
  const sidebarBtn = page.getByRole('button', { name: 'Thanh bên' });
  await sidebarBtn.click();
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await page.screenshot({ path: 'test-results/web-dark-sidebar-collapsed.png', fullPage: true });

  // Re-open Sidebar using hamburger button
  await sidebarBtn.click();
  await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/);

  // Switch back to light mode
  await darkSwitch.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(darkSwitch).toHaveAttribute('aria-checked', 'false');

  await page.getByLabel('Tên khóa học mới').fill('Nhập môn Python');
  await page.getByLabel('Chủ đề / Tag').selectOption('Thiết kế');
  await page.getByRole('button', { name: 'Tạo bản nháp' }).click();
  await expect(page.getByRole('heading', { name: 'Nhập môn Python' })).toBeVisible();
  await expect(page.locator('.tag-badge', { hasText: 'Thiết kế' }).first()).toBeVisible();

  // Open course editor
  await page.getByRole('button', { name: 'Quản lý bài giảng' }).first().click();
  await expect(page.getByText('Giảng viên không thể tự đánh giá khóa học của chính mình.')).toBeVisible();

  // Test editing course information from Thao tác khóa học
  await expect(page.getByRole('button', { name: 'Chỉnh sửa thông tin khóa học' })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa thông tin khóa học' }).click();
  await expect(page.getByRole('heading', { name: 'Chỉnh sửa thông tin khóa học' })).toBeVisible();
  await page.getByLabel('Tên khóa học').fill('Nhập môn Python Nâng Cao');
  await page.getByLabel('Mô tả khóa học').fill('Khóa học chi tiết từ cơ bản đến chuyên sâu.');
  await page.getByRole('button', { name: 'Lưu cập nhật' }).click();
  await expect(page.getByText('Đã cập nhật thông tin khóa học thành công!')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nhập môn Python Nâng Cao' })).toBeVisible();
  await expect(page.getByText('Khóa học chi tiết từ cơ bản đến chuyên sâu.')).toBeVisible();
  await page.screenshot({ path: 'test-results/web-course-editor.png', fullPage: true });

  // Switch to Dark mode inside course editor using switch
  await darkSwitch.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'test-results/web-course-editor-dark.png', fullPage: true });
  await darkSwitch.click();

  // Go back to courses
  await page.getByRole('button', { name: 'Quay lại danh sách khóa học' }).click();
  await expect(page.getByTitle('Lọc theo tag chủ đề')).toBeVisible();
  await expect(page.getByTitle('Lọc theo số sao')).toBeVisible();
  await expect(page.getByTitle('Sắp xếp danh sách')).toBeVisible();

  // Test sidebar active indicator (.nav-active)
  const draftNavBtn = page.getByRole('button', { name: 'Bản nháp của tôi' });
  const allCoursesNavBtn = page.getByRole('button', { name: 'Khóa học' }).first();
  await expect(allCoursesNavBtn).toHaveClass(/nav-active/);
  await expect(draftNavBtn).not.toHaveClass(/nav-active/);

  // Click "Bản nháp của tôi" and verify active pill moves
  await draftNavBtn.click();
  await expect(draftNavBtn).toHaveClass(/nav-active/);
  await expect(allCoursesNavBtn).not.toHaveClass(/nav-active/);

  // Click back to "Khóa học"
  await allCoursesNavBtn.click();
  await expect(allCoursesNavBtn).toHaveClass(/nav-active/);
  await expect(draftNavBtn).not.toHaveClass(/nav-active/);

  // Verify updated title is in catalog
  await expect(page.getByRole('heading', { name: 'Nhập môn Python Nâng Cao' })).toBeVisible();

  // Re-enter course editor to test adding and deleting chapters, lessons, quizzes, and action scheduling modal
  await page.getByRole('button', { name: 'Quản lý bài giảng' }).first().click();

  // 1. Add chapter
  await page.getByLabel('Tên chương mới').fill('Chương 1: Kiến thức nền tảng');
  await page.getByRole('button', { name: 'Thêm chương' }).click();
  await expect(page.getByRole('heading', { name: 'Chương 1: Kiến thức nền tảng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa chương' })).toBeVisible();

  // 2. Add lesson
  await page.getByLabel('Tên bài học').fill('Bài 1: Cú pháp cơ bản');
  await page.getByRole('button', { name: 'Thêm bài học' }).click();
  await expect(page.getByRole('heading', { name: 'Bài 1: Cú pháp cơ bản' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa bài học' })).toBeVisible();

  // 3. Add quiz
  await page.getByRole('button', { name: 'Thêm bài kiểm tra' }).click();
  await page.getByLabel('Tên bài kiểm tra').fill('Kiểm tra chương 1');
  await page.getByLabel('Nội dung câu hỏi').fill('Python là gì?');
  await page.getByLabel('Câu 1, lựa chọn 1').fill('Ngôn ngữ lập trình');
  await page.getByRole('button', { name: 'Lưu bài kiểm tra' }).click();
  await expect(page.getByRole('heading', { name: 'Kiểm tra chương 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa bài kiểm tra' })).toBeVisible();

  // 4. Test action scheduling modal (e.g., Lưu trữ khóa học)
  await page.getByRole('button', { name: 'Lưu trữ khóa học' }).click();
  await expect(page.getByRole('heading', { name: 'Ngưng xuất bản / Lưu trữ khóa học' })).toBeVisible();
  await expect(page.getByLabel('Áp dụng ngay lập tức')).toBeVisible();
  await expect(page.getByLabel('Lên lịch theo ngày giờ')).toBeVisible();

  // Select "Lên lịch theo ngày giờ"
  await page.getByLabel('Lên lịch theo ngày giờ').check();
  await expect(page.getByLabel('Chọn thời gian áp dụng:')).toBeVisible();

  // Close modal via Hủy bỏ
  await page.getByRole('button', { name: 'Hủy bỏ' }).click();
  await expect(page.getByRole('heading', { name: 'Ngưng xuất bản / Lưu trữ khóa học' })).toHaveCount(0);

  // 5. Test deletion of quiz and lesson
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Xóa bài kiểm tra' }).click();
  await expect(page.getByText('Đã xóa bài kiểm tra "Kiểm tra chương 1".')).toBeVisible();

  await page.getByRole('button', { name: 'Xóa bài học' }).click();
  await expect(page.getByText('Đã xóa bài học "Bài 1: Cú pháp cơ bản".')).toBeVisible();

  await page.getByRole('button', { name: 'Xóa chương' }).click();
  await expect(page.getByText('Đã xóa chương "Chương 1: Kiến thức nền tảng".')).toBeVisible();

  await page.screenshot({ path: 'test-results/web-instructor.png', fullPage: true });
});
