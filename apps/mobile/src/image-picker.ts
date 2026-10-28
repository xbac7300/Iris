import * as DocumentPicker from 'expo-document-picker';

/**
 * Mở trình chọn ảnh từ thiết bị điện thoại và chuyển đổi thành chuỗi Data URL (base64)
 * để lưu trực tiếp làm ảnh bìa khóa học giống như trên Web.
 */
export async function pickCourseThumbnailImage(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.size && asset.size > 12 * 1024 * 1024) {
    throw new Error('Dung lượng ảnh quá lớn (tối đa 12MB). Vui lòng chọn ảnh nhẹ hơn.');
  }

  const response = await fetch(asset.uri);
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
        resolve(reader.result);
      } else {
        reject(new Error('Không thể đọc dữ liệu tệp ảnh đã chọn.'));
      }
    };
    reader.onerror = () => reject(new Error('Lỗi khi đọc tệp ảnh từ thiết bị.'));
    reader.readAsDataURL(blob);
  });
}

