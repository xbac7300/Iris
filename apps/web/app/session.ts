import { SessionClient } from '@lms/api-client';
export const session = new SessionClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', kind: 'web' });
