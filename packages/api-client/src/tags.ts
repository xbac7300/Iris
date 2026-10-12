export const COURSE_TAGS = [
  'Phát triển',
  'Kinh doanh',
  'Tài chính & Kế toán',
  'CNTT & Phần mềm',
  'Năng suất văn phòng',
  'Phát triển cá nhân',
  'Thiết kế',
  'Marketing',
  'Sức khỏe & Thể dục',
  'Âm nhạc',
] as const;

export type CourseTag = (typeof COURSE_TAGS)[number];

