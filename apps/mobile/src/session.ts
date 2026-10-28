import * as SecureStore from 'expo-secure-store';
import { SessionClient } from '@lms/api-client';

const STORAGE_KEY_REFRESH = 'topic16.refresh';
const STORAGE_KEY_API_URL = 'topic16.api_url';
const STORAGE_KEY_ROLE_MODE = 'topic16.role_mode';
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.142:4000';

let activeApiUrl: string = DEFAULT_API_URL;
let currentRoleMode: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' = 'STUDENT';
const globalClearListeners = new Set<(reason?: string) => void>();
let currentSession: SessionClient = createSessionClient(activeApiUrl);

export function getActiveRoleMode(): 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' {
  return currentRoleMode;
}

export function setActiveRoleMode(mode: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN'): void {
  currentRoleMode = mode;
  try {
    void SecureStore.setItemAsync(STORAGE_KEY_ROLE_MODE, mode);
  } catch {
    // ignore storage error
  }
}

export async function initRoleMode(): Promise<'STUDENT' | 'INSTRUCTOR' | 'ADMIN'> {
  try {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY_ROLE_MODE);
    if (saved === 'STUDENT' || saved === 'INSTRUCTOR' || saved === 'ADMIN') {
      currentRoleMode = saved;
      return currentRoleMode;
    }
  } catch {
    // ignore
  }
  return currentRoleMode;
}

function createSessionClient(baseUrl: string): SessionClient {
  return new SessionClient({
    baseUrl,
    kind: 'mobile',
    onClear: (reason?: string) => {
      for (const listener of globalClearListeners) listener(reason);
    },
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
    if (prop === 'onClear') {
      return (listener: (reason?: string) => void) => {
        globalClearListeners.add(listener);
        return () => { globalClearListeners.delete(listener); };
      };
    }
    const val = Reflect.get(currentSession, prop);
    return typeof val === 'function' ? val.bind(currentSession) : val;
  },
  set(_target, prop, value) {
    return Reflect.set(currentSession, prop, value);
  },
});

