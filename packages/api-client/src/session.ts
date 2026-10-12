import createClient from 'openapi-fetch';
import type { paths, components } from './schema';

type AuthResult = components['schemas']['AuthResultDto'];
type User = components['schemas']['UserDto'];
type Credentials = Pick<components['schemas']['LoginDto'], 'email' | 'password'>;
export interface TokenStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export class SessionClient {
  private accessToken: string | null = null;
  private epoch = 0;
  private refreshFlight: Promise<void> | null = null;
  private storageFlight = Promise.resolve();
  private readonly raw;
  readonly api;
  user: User | null = null;
  private readonly clearListeners = new Set<() => void>();
  onClear(listener: () => void): () => void { this.clearListeners.add(listener); return () => { this.clearListeners.delete(listener); }; }

  constructor(private readonly options: {
    baseUrl: string; kind: 'web' | 'mobile'; storage?: TokenStorage;
    fetch?: typeof fetch; onClear?: () => void;
  }) {
    if (options.kind === 'mobile' && !options.storage) throw new Error('Mobile cần SecureStore adapter.');
    const settings = { baseUrl: options.baseUrl, credentials: options.kind === 'web' ? 'include' as const : 'omit' as const,
      headers: options.kind === 'web' ? { 'X-CSRF-Protection': '1' } : undefined };
    this.raw = createClient<paths>({ ...settings, fetch: options.fetch });
    this.api = createClient<paths>({ ...settings, fetch: request => this.authorizedFetch(request) });
  }

  private mutateStorage(action: () => Promise<void>): Promise<void> {
    const pending = this.storageFlight.then(action);
    this.storageFlight = pending.catch(() => {});
    return pending;
  }

  private async accept(result: AuthResult, epoch: number): Promise<void> {
    if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
    if (this.options.storage && result.refresh_token) {
      await this.mutateStorage(() => this.options.storage!.set(result.refresh_token!));
    }
    if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
    this.accessToken = result.access_token; this.user = result.user;
  }

  async login(credentials: Credentials): Promise<void> {
    await this.clear();
    const epoch = this.epoch;
    const { data, error } = await this.raw.POST('/api/v1/auth/login', { body: { ...credentials, client_type: this.options.kind } });
    if (!data) throw new Error(error?.message ?? 'Không thể đăng nhập.');
    await this.accept(data, epoch);
  }

  async register(input: Credentials & { display_name: string; role?: 'STUDENT' | 'INSTRUCTOR' }): Promise<void> {
    await this.clear();
    const epoch = this.epoch;
    const { data, error } = await this.raw.POST('/api/v1/auth/register', { body: { ...input, client_type: this.options.kind } as any });
    if (!data) throw new Error(error?.message ?? 'Không thể đăng ký.');
    await this.accept(data, epoch);
  }

  async restore(): Promise<void> { await this.refresh(); }

  private refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    const epoch = this.epoch;
    const pending = (async () => {
      await this.storageFlight;
      const token = await this.options.storage?.get();
      if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
      const { data, error } = await this.raw.POST('/api/v1/auth/refresh', { body: {
        client_type: this.options.kind, ...(token ? { refresh_token: token } : {}),
      } });
      if (!data) throw new Error(error?.message ?? 'Phiên đã hết hạn.');
      await this.accept(data, epoch);
    })().catch(async error => {
      if (epoch === this.epoch) await this.clear();
      throw error;
    });
    this.refreshFlight = pending;
    void pending.finally(() => { if (this.refreshFlight === pending) this.refreshFlight = null; }).catch(() => {});
    return pending;
  }

  private async authorizedFetch(request: Request): Promise<Response> {
    const epoch = this.epoch;
    const previousToken = this.accessToken;
    const send = () => {
      const clone = request.clone();
      if (this.accessToken) clone.headers.set('Authorization', `Bearer ${this.accessToken}`);
      return (this.options.fetch ?? fetch)(clone);
    };
    let response = await send();
    if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
    if (response.status === 401) {
      // Request chậm có thể nhận 401 sau khi request khác đã hoàn tất refresh.
      if (previousToken === this.accessToken) await this.refresh();
      if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
      response = await send();
    }
    if (epoch !== this.epoch) throw new Error('Phiên đã thay đổi.');
    return response;
  }

  async logout(): Promise<void> {
    try {
      const { error } = await this.api.POST('/api/v1/auth/logout');
      if (error) throw new Error(error.message);
    } finally { await this.clear(); }
  }

  async clear(): Promise<void> {
    this.epoch++; this.accessToken = null; this.user = null; this.refreshFlight = null;
    this.options.onClear?.();
    for (const listener of this.clearListeners) listener();
    if (this.options.storage) await this.mutateStorage(() => this.options.storage!.remove());
  }
}
