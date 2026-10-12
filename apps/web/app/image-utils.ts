'use client';

/**
 * Đọc và xử lý tệp ảnh từ máy người dùng, tự động tối ưu hóa kích thước (max 1280x720)
 * để đảm bảo chất lượng sắc nét làm ảnh bìa thumbnail mà vẫn tải cực nhanh.
 */
export function processImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WebP, GIF).'));
    }
    // Giới hạn 20MB file gốc
    if (file.size > 20 * 1024 * 1024) {
      return reject(new Error('Kích thước tệp ảnh tối đa 20MB.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 720;
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(src);
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Xuất định dạng JPEG chất lượng cao 85%
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh. Vui lòng thử lại.'));
    reader.readAsDataURL(file);
  });
}

