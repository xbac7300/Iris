import { z } from 'zod';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const storageConfigSchema = z.object({
  S3_ENDPOINT: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)),
  S3_BUCKET: z.string().min(3), S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1), S3_SECRET_KEY: z.string().min(1),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(524288000).default(524288000),
  UPLOAD_MAX_DURATION_SEC: z.coerce.number().positive().max(3600).default(3600),
});
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export class ObjectStorage {
  readonly client: S3Client;
  constructor(readonly config: StorageConfig) {
    this.client = new S3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, forcePathStyle: true,
      // Presign PUT chưa có body; không gắn checksum của body rỗng vào URL upload.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 120000 } });
  }
  head(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
  uploadUrl(key: string, bytes: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key,
      ContentType: 'video/mp4', ContentLength: bytes }), { expiresIn: 900 });
  }
  playbackUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), { expiresIn: 300 });
  }
  close(): void { this.client.destroy(); }
  async configureBrowser(origin: string): Promise<void> {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Cần origin chính xác cho CORS.');
    await this.client.send(new PutBucketCorsCommand({ Bucket: this.config.S3_BUCKET, CORSConfiguration: { CORSRules: [{
      AllowedOrigins: [origin], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['content-type', 'range'],
      ExposeHeaders: ['ETag', 'Content-Range', 'Accept-Ranges'], MaxAgeSeconds: 300,
    }] } }));
  }
}
