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
  private readonly hostClients = new Map<string, S3Client>();
  constructor(readonly config: StorageConfig) {
    this.client = this.createClient(config.S3_ENDPOINT);
  }
  private createClient(endpoint: string): S3Client {
    return new S3Client({ endpoint, region: this.config.S3_REGION, forcePathStyle: true,
      // Presign PUT chưa có body; không gắn checksum của body rỗng vào URL upload.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: this.config.S3_ACCESS_KEY, secretAccessKey: this.config.S3_SECRET_KEY },
      maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 120000 } });
  }
  private clientForHost(requestHost?: string): S3Client {
    if (!requestHost) return this.client;
    const hostname = requestHost.split(':')[0]?.trim();
    if (!hostname || ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return this.client;
    const base = new URL(this.config.S3_ENDPOINT);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) return this.client;
    base.hostname = hostname;
    const endpoint = base.toString().replace(/\/$/, '');
    let cached = this.hostClients.get(endpoint);
    if (!cached) {
      cached = this.createClient(endpoint);
      this.hostClients.set(endpoint, cached);
    }
    return cached;
  }
  head(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
  uploadUrl(key: string, bytes: number, requestHost?: string): Promise<string> {
    return getSignedUrl(this.clientForHost(requestHost), new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key,
      ContentType: 'video/mp4', ContentLength: bytes }), { expiresIn: 900 });
  }
  playbackUrl(key: string, requestHost?: string): Promise<string> {
    return getSignedUrl(this.clientForHost(requestHost), new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), { expiresIn: 300 });
  }
  close(): void {
    this.client.destroy();
    for (const c of this.hostClients.values()) c.destroy();
    this.hostClients.clear();
  }
  async configureBrowser(origin: string): Promise<void> {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Cần origin chính xác cho CORS.');
    await this.client.send(new PutBucketCorsCommand({ Bucket: this.config.S3_BUCKET, CORSConfiguration: { CORSRules: [{
      AllowedOrigins: [origin, 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001', '*'],
      AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'Content-Range', 'Accept-Ranges'], MaxAgeSeconds: 300,
    }] } }));
  }
}
