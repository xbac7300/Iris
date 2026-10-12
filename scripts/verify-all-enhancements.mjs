import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/GenZ/.gemini/antigravity/brain/2240e41d-5d02-42e4-8e1c-35b9b6f52096';
const WEB_URL = 'http://localhost:3000';
const STUDENT_CRED = { email: 'student@lms.example', pass: '7758e6fabfaae9fb2896b7c03a45c98d9074' };
const INSTRUCTOR_CRED = { email: 'instructor@lms.example', pass: '7758e6fabfaae9fb2896b7c03a45c98d9074' };
const ADMIN_CRED = { email: 'admin@lms.example', pass: '7758e6fabfaae9fb2896b7c03a45c98d9074' };

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('--- 1. Testing Student Account View ---');
  await page.goto(WEB_URL);
  await page.fill('input[name="email"]', STUDENT_CRED.email);
  await page.fill('input[name="password"]', STUDENT_CRED.pass);
  await page.click('button:has-text("Đăng nhập")');
  await page.waitForSelector('.catalog', { timeout: 10000 });

  // Check Student Sidebar
  const sidebarButtons = await page.$$eval('.sidebar button span', spans => spans.map(s => s.textContent.trim()));
  console.log('Student Sidebar buttons:', sidebarButtons);
  const studentFilters = await page.$$eval('.filters button', btns => btns.map(b => b.textContent.trim()));
  console.log('Student Catalog filter buttons:', studentFilters);

  // Take screenshot of student home
  await page.screenshot({ path: `${ARTIFACT_DIR}/student-filters-enrolled-liked.png` });

  // Test clicking "Đang học" and "Yêu thích"
  await page.click('.filters button:has-text("Đang học")');
  await page.waitForTimeout(500);
  await page.click('.filters button:has-text("Yêu thích")');
  await page.waitForTimeout(500);
  await page.click('.filters button:has-text("Tất cả")');
  await page.waitForTimeout(500);

  // Logout student
  await page.click('button:has-text("Đăng xuất")');
  await page.waitForSelector('form input[name="email"]');

  console.log('--- 2. Testing Admin Broadcast Announcement & Account Lock ---');
  await page.fill('input[name="email"]', ADMIN_CRED.email);
  await page.fill('input[name="password"]', ADMIN_CRED.pass);
  await page.click('button:has-text("Đăng nhập")');
  await page.waitForSelector('button:has-text("Quản lý tài khoản và vận hành")');
  await page.click('button:has-text("Quản lý tài khoản và vận hành")');
  await page.waitForSelector('h3:has-text("Phát thông báo đến người dùng")', { timeout: 8000 });

  // Screenshot Admin Announcements & User Management
  await page.screenshot({ path: `${ARTIFACT_DIR}/admin-panel-announcements.png` });

  // Create an announcement for Students
  const testTitle = 'Thông báo quan trọng từ Ban Quản trị ' + Date.now();
  await page.fill('input[placeholder*="Lịch bảo trì"]', testTitle);
  await page.fill('textarea[placeholder*="Nhập nội dung thông báo"]', 'Hệ thống LMS được nâng cấp giao diện phân trang chương và bộ lọc mới.');
  await page.selectOption('label:has-text("Đối tượng nhận") select', 'STUDENT');
  await page.click('button:has-text("Phát thông báo ngay")');
  await page.waitForTimeout(1000);

  // Open suspension modal on a user to verify options
  const lockBtn = await page.$('.admin-users button:has-text("Khóa tài khoản"):not(:disabled)');
  if (lockBtn) {
    await lockBtn.click();
    await page.waitForSelector('.modal-content');
    await page.screenshot({ path: `${ARTIFACT_DIR}/admin-account-suspension-modal.png` });
    await page.click('.modal-content button:has-text("Hủy")');
  }

  // Logout admin
  await page.click('button:has-text("Đăng xuất")');
  await page.waitForSelector('form input[name="email"]');

  console.log('--- 3. Testing Student Receiving Announcement with 3s auto-close ---');
  await page.fill('input[name="email"]', STUDENT_CRED.email);
  await page.fill('input[name="password"]', STUDENT_CRED.pass);
  await page.click('button:has-text("Đăng nhập")');
  
  // Wait for announcement popup
  const announcement = await page.waitForSelector('.announcement-banner', { timeout: 5000 });
  const announcementText = await announcement.innerText();
  console.log('Announcement banner text:\n', announcementText);
  await page.screenshot({ path: `${ARTIFACT_DIR}/student-announcement-popup.png` });

  // Test close button
  await page.click('.announcement-banner button:has-text("Đóng ngay")');
  await page.waitForTimeout(500);

  // Logout student
  await page.click('button:has-text("Đăng xuất")');
  await page.waitForSelector('form input[name="email"]');

  console.log('--- 4. Testing Instructor Chapter Stepper, Collapse & Thumbnail ---');
  await page.fill('input[name="email"]', INSTRUCTOR_CRED.email);
  await page.fill('input[name="password"]', INSTRUCTOR_CRED.pass);
  await page.click('button:has-text("Đăng nhập")');
  await page.waitForSelector('.create-course');

  // Verify thumbnail input in create-course form
  const hasThumbInput = await page.$('label:has-text("Ảnh bìa") input') !== null;
  console.log('Course creation has thumbnail input:', hasThumbInput);

  // Find the card for "Xây dựng ứng dụng Next.js & AI RAG chuyên sâu"
  const courseCard = await page.locator('li:has-text("Xây dựng ứng dụng Next.js & AI RAG chuyên sâu")');
  await courseCard.locator('.course-open').click();
  await page.waitForSelector('.editor-hero', { timeout: 8000 });

  // Verify chapter stepper pills
  await page.waitForSelector('.step-pill', { timeout: 5000 });
  const stepperPills = await page.$$eval('.step-pill', pills => pills.map(p => p.textContent.trim()));
  console.log('Chapter Stepper Pills:', stepperPills);

  // Test switching to Chapter 2
  await page.click('.step-pill:has-text("Chương 2")');
  await page.waitForTimeout(500);
  const activeChapterTitle = await page.$eval('.module-title h3', el => el.textContent.trim());
  console.log('Active Chapter Title:', activeChapterTitle);

  // Test navigating back to Chapter 1 using "← Chương trước"
  const prevBtn = await page.$('button:has-text("← Chương trước")');
  if (prevBtn) {
    await prevBtn.click();
    await page.waitForTimeout(500);
    const chapter1Title = await page.$eval('.module-title h3', el => el.textContent.trim());
    console.log('After clicking Prev, Chapter Title:', chapter1Title);
  }

  // Verify collapsible button
  const chevron = await page.$('.collapse-chevron');
  console.log('Has collapse chevron:', chevron !== null);
  if (chevron) {
    await page.click('.collapse-toggle-btn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chapter-collapsed.png` });
    console.log('Collapsed chapter screenshot captured.');
    await page.click('.collapse-toggle-btn');
    await page.waitForTimeout(300);
  }

  // Verify right sidebar chapter outline
  const outlineItems = await page.$$eval('.outline-module-btn', btns => btns.map(b => b.textContent.trim()));
  console.log('Right sidebar course outline chapters:', outlineItems);

  // Test editing course thumbnail
  await page.click('button:has-text("Chỉnh sửa thông tin khóa học")');
  await page.waitForSelector('input[name="thumbnail_url"]');
  const sampleThumb = 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800';
  await page.fill('input[name="thumbnail_url"]', sampleThumb);
  await page.click('button:has-text("Lưu cập nhật")');
  await page.waitForTimeout(1000);

  // Screenshot course editor with stepper & outline
  await page.screenshot({ path: `${ARTIFACT_DIR}/instructor-course-editor-stepper-outline.png` });

  // Go back to course catalog and verify custom thumbnail card
  await page.click('button:has-text("Quay lại danh sách khóa học")');
  await page.waitForSelector('.catalog');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ARTIFACT_DIR}/catalog-with-custom-thumbnail.png` });

  console.log('--- All Playwright tests completed successfully! ---');
  await browser.close();
}

run().catch(err => {
  console.error('Playwright verification failed:', err);
  process.exit(1);
});

