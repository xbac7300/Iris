export type EvidenceStatus = 'SUPPORTED' | 'INSUFFICIENT';
export interface Citation {
  lesson_id: string;
  media_version: string;
  transcript_version: string;
  chunk_id: string;
  start_sec: number;
  end_sec: number;
  excerpt: string;
}
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}
export interface GenerationProvider {
  readonly modelId: string;
  generate(input: { question: string; evidence: readonly { chunk_id: string; text: string }[] }): Promise<{
    answer: string; evidence_status: EvidenceStatus; chunk_ids: string[];
  }>;
}

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
