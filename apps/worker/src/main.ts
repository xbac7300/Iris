import { workerConfigSchema } from './config';
import { MediaRuntime } from './runtime';
import { AiRuntime } from './ai-runtime';
import { aiConfigSchema } from '@lms/ai-core';

async function main(): Promise<void> {
  const parsed = workerConfigSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Thiếu cấu hình worker: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const runtime = new MediaRuntime(parsed.data);
  const ai = process.env.AI_ENABLED === 'true' ? new AiRuntime(parsed.data, aiConfigSchema.parse(process.env), process.env.ASR_MODEL_PATH ?? '.local/models/faster-whisper-small') : null;
  try { await runtime.start(); } catch (error) { await runtime.close(); throw error; }
  if (ai) { try { await ai.start(); } catch { console.error('AI chưa sẵn sàng; worker media vẫn chạy. Khởi động lại worker sau khi kiểm tra model.'); await ai.close(); } }
  process.once('SIGINT', () => { void runtime.close(); void ai?.close(); });
  process.once('SIGTERM', () => { void runtime.close(); void ai?.close(); });
  console.log('Worker media và bộ quét outbox đã sẵn sàng.');
}
void main().catch(() => { console.error('Worker khởi động thất bại; kiểm tra cấu hình và hạ tầng.'); process.exitCode = 1; });
