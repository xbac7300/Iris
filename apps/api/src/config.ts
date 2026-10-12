import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().refine(value => /^postgres(ql)?:/.test(value)),
  JWT_SECRET: z.string().min(48),
  WEB_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});
export type Config = z.infer<typeof configSchema>;
export const CONFIG = Symbol('CONFIG');
export function readConfig(): Config {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Cấu hình không hợp lệ: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const config = parsed.data;
  const origin = new URL(config.WEB_ORIGIN);
  if (origin.origin !== config.WEB_ORIGIN || (config.NODE_ENV === 'production' && origin.protocol !== 'https:')) {
    throw new Error('WEB_ORIGIN phải là origin chính xác; production bắt buộc HTTPS.');
  }
  return config;
}
