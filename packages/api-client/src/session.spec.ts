import { SessionClient, TokenStorage } from './session';

const user = { id: 'user1', email: 'user@example.com', display_name: 'Học viên', roles: ['STUDENT'] };
const tokens = (access = 'old') => ({ access_token: access, refresh_token: `refresh-${access}`, expires_in: 900, user });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function setup(handler: (request: Request) => Promise<Response>) {
  let saved: string | null = null;
  const storage: TokenStorage = { get: async () => saved, set: async value => { saved = value; }, remove: async () => { saved = null; } };
  const mock = jest.fn(handler);
  return { session: new SessionClient({ baseUrl: 'https://api.example', kind: 'mobile', storage, fetch: mock as typeof fetch }), mock, storage };
}

it('gộp refresh đồng thời, chỉ retry một lần và xóa SecureStore khi logout', async () => {
  let refreshCount = 0;
  const { session, storage } = setup(async request => {
    if (request.url.endsWith('/login')) return json(tokens());
    if (request.url.endsWith('/refresh')) { refreshCount++; await new Promise(resolve => setTimeout(resolve, 10)); return json(tokens('new')); }
    if (request.url.endsWith('/logout')) return new Response(null, { status: 204 });
    return request.headers.get('Authorization') === 'Bearer new' ? json([]) : json({ message: 'Hết hạn' }, 401);
  });
  await session.login({ email: user.email, password: 'password-example' });
  const result = await Promise.all([session.api.GET('/api/v1/courses'), session.api.GET('/api/v1/courses')]);
  expect(result.every(r => r.response.status === 200)).toBe(true);
  expect(refreshCount).toBe(1); expect(await storage.get()).toBe('refresh-new');
  await session.logout(); expect(session.user).toBeNull(); expect(await storage.get()).toBeNull();
});

it('không trả dữ liệu request cũ sau khi đổi phiên', async () => {
  let release!: (response: Response) => void;
  const { session } = setup(async request => request.url.endsWith('/login') ? json(tokens()) : new Promise(resolve => { release = resolve; }));
  await session.login({ email: user.email, password: 'password-example' });
  const request = session.api.GET('/api/v1/courses');
  await Promise.resolve();
  await session.clear(); release(json([{ id: 'old-user-course' }]));
  await expect(request).rejects.toThrow('Phiên đã thay đổi');
});

it('refresh thất bại xóa dữ liệu; không lặp retry vô hạn', async () => {
  const { session, mock, storage } = setup(async request => request.url.endsWith('/login') ? json(tokens()) : json({ message: 'Phiên bị thu hồi' }, 401));
  await session.login({ email: user.email, password: 'password-example' });
  await expect(session.api.GET('/api/v1/courses')).rejects.toThrow('Phiên bị thu hồi');
  expect(mock).toHaveBeenCalledTimes(3); expect(session.user).toBeNull(); expect(await storage.get()).toBeNull();
});

it('web không lưu refresh token trong JavaScript và gửi CSRF header', async () => {
  const mock = jest.fn(async (request: Request) => {
    expect(request.headers.get('X-CSRF-Protection')).toBe('1');
    return json({ access_token: 'web-token', expires_in: 900, user });
  });
  const session = new SessionClient({ baseUrl: 'https://api.example', kind: 'web', fetch: mock as typeof fetch });
  await session.register({ email: user.email, password: 'password-example', display_name: 'Học viên' });
  expect(session.user).toEqual(user);
  await session.restore();
});
