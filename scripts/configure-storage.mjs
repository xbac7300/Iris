import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ObjectStorage, storageConfigSchema } = require('../packages/media-core/dist');
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.S3_ENDPOINT).hostname)) throw new Error('Script chỉ cấu hình storage local.');
const storage = new ObjectStorage(storageConfigSchema.parse(process.env));
try { await storage.configureBrowser(process.env.WEB_ORIGIN); console.log('Đã cấu hình CORS bucket cho WEB_ORIGIN.'); }
finally { storage.close(); }
