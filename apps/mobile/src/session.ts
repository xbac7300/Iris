import * as SecureStore from 'expo-secure-store';
import { SessionClient } from '@lms/api-client';

const STORAGE_KEY_REFRESH = 'topic16.refresh';
const STORAGE_KEY_API_URL = 'topic16.api_url';
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.12:4000';

let activeApiUrl: string = DEFAULT_API_URL;
let currentSession: SessionClient = createSessionClient(activeApiUrl);

function createSessionClient(baseUrl: string): SessionClient {
  return new SessionClient({
    baseUrl,
    kind: 'mobile',
    storage: {
      get: () => SecureStore.getItemAsync(STORAGE_KEY_REFRESH),
      set: value => SecureStore.setItemAsync(STORAGE_KEY_REFRESH, value),
      remove: () => SecureStore.deleteItemAsync(STORAGE_KEY_REFRESH),
    },
  });
}

export async function initApiUrl(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY_API_URL);
    if (saved && saved.trim()) {
      activeApiUrl = saved.trim();
      currentSession = createSessionClient(activeApiUrl);
      return activeApiUrl;
    }
  } catch {
    // Không đọc được SecureStore, giữ mặc định
  }
  return activeApiUrl;
}

export async function setApiUrl(newUrl: string): Promise<void> {
  const trimmed = newUrl.trim().replace(/\/+$/, '');
  activeApiUrl = trimmed || DEFAULT_API_URL;
  currentSession = createSessionClient(activeApiUrl);
  try {
    await SecureStore.setItemAsync(STORAGE_KEY_API_URL, activeApiUrl);
  } catch {
    // Bỏ qua lỗi lưu
  }
}

export function getCurrentApiUrl(): string {
  return activeApiUrl;
}

export const session = new Proxy({} as SessionClient, {
  get(_target, prop) {
    const val = (currentSession as any)[prop];
    return typeof val === 'function' ? val.bind(currentSession) : val;
  },
  set(_target, prop, value) {
    (currentSession as any)[prop] = value;
    return true;
  },
});
