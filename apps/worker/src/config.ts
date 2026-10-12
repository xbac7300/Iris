import { z } from 'zod';
import { storageConfigSchema } from '@lms/media-core';
export const workerConfigSchema = storageConfigSchema.extend({
  DATABASE_URL: z.url(), REDIS_URL: z.url(), PYTHON_EXECUTABLE: z.string().min(1),
  MEDIA_PROBE_SCRIPT: z.string().min(1), MEDIA_TEMP_DIR: z.string().min(1),
  MEDIA_QUEUE_NAME: z.string().regex(/^[a-z0-9-]+$/).default('media'),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export function redisConnection(url: string) {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) throw new Error('REDIS_URL không hợp lệ.');
  return { host: parsed.hostname, port: Number(parsed.port || 6379), username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}) };
}
