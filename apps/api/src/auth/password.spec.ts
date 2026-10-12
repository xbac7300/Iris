import { hashPassword, verifyPassword } from './password';
describe('Băm mật khẩu', () => {
  it('salt riêng; chấp nhận đúng và từ chối sai', async () => {
    const first = await hashPassword('Mật-khẩu-kiểm-thử');
    expect(first).not.toBe(await hashPassword('Mật-khẩu-kiểm-thử'));
    expect(await verifyPassword('Mật-khẩu-kiểm-thử', first)).toBe(true);
    expect(await verifyPassword('Sai-mật-khẩu', first)).toBe(false);
  });
  it('từ chối định dạng hỏng', async () => {
    expect(await verifyPassword('password', 'invalid')).toBe(false);
    expect(await verifyPassword('password', 'scrypt:salt:xx')).toBe(false);
  });
});
