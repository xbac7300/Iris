import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CONFIG, Config } from '../config';
import { hashPassword, verifyPassword } from './password';
import { LoginDto, RegisterDto, UserDto } from './dto';

export type Principal = UserDto & { session_id: string; client_type: 'web' | 'mobile' };
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly jwt: JwtService;
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(private readonly db: DataSource, @Inject(CONFIG) config: Config) {
    this.jwt = new JwtService({ secret: config.JWT_SECRET, signOptions: {
      algorithm: 'HS256', expiresIn: '15m', issuer: 'topic16-api', audience: 'topic16-clients',
    } });
  }

  async register(input: RegisterDto) {
    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.db.transaction(async tx => {
        await tx.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',
          [id, input.email, passwordHash, input.display_name.trim()]);
        await tx.query("INSERT INTO user_roles(user_id,role) VALUES($1,'STUDENT')", [id]);
        if (input.role === 'INSTRUCTOR') {
          await tx.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR')", [id]);
        }
        return this.issueSession(tx, id, input.client_type);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Email đã được sử dụng.');
      throw error;
    }
  }

  async login(input: LoginDto) {
    const [user] = await this.db.query('SELECT id,password_hash,disabled,disabled_until,disabled_reason FROM users WHERE email=$1', [input.email]);
    const valid = await verifyPassword(input.password, user?.password_hash ?? await this.dummyHash);
    if (!user || !valid) throw new UnauthorizedException('Thông tin đăng nhập không hợp lệ.');
    if (user.disabled) {
      if (user.disabled_until && new Date(user.disabled_until) <= new Date()) {
        await this.db.query('UPDATE users SET disabled=false, disabled_until=NULL, disabled_reason=NULL WHERE id=$1', [user.id]);
      } else {
        const untilText = user.disabled_until
          ? ` đến ${new Date(user.disabled_until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
          : ' vĩnh viễn';
        const reasonText = user.disabled_reason ? `. Lý do: ${user.disabled_reason}` : '';
        throw new UnauthorizedException(`Tài khoản của bạn đã bị khóa${untilText}${reasonText}.`);
      }
    }
    return this.db.transaction(async tx => {
      const [active] = await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      if (!active) throw new UnauthorizedException('Thông tin đăng nhập không hợp lệ.');
      return this.issueSession(tx, user.id, input.client_type);
    });
  }

  private async issueSession(tx: EntityManager, userId: string, clientType: string) {
    const sessionId = randomUUID();
    await tx.query("INSERT INTO sessions(id,user_id,client_type,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [sessionId, userId, clientType]);
    return this.issueTokens(tx, sessionId, userId);
  }

  private async issueTokens(tx: EntityManager, sessionId: string, userId: string) {
    const refreshToken = randomBytes(32).toString('hex');
    await tx.query('INSERT INTO refresh_tokens(token_hash,session_id) VALUES($1,$2)', [digest(refreshToken), sessionId]);
    const user = await this.user(tx, userId);
    return { access_token: await this.jwt.signAsync({ sub: userId, sid: sessionId }),
      expires_in: 900, refresh_token: refreshToken, user };
  }

  async refresh(token: string, clientType: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Phiên không hợp lệ.');
    const tokenHash = digest(token);
    const result = await this.db.transaction(async tx => {
      // Khóa phiên trước khi đọc trạng thái token để hai lần refresh không cùng thành công.
      const [session] = await tx.query(`SELECT s.* FROM sessions s JOIN refresh_tokens t ON t.session_id=s.id
        WHERE t.token_hash=$1 FOR UPDATE OF s`, [tokenHash]);
      if (!session || session.client_type !== clientType || session.revoked_at || new Date(session.expires_at) <= new Date()) return null;
      const [tokenRow] = await tx.query('SELECT consumed_at FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
      const [user] = await tx.query('SELECT disabled, disabled_until FROM users WHERE id=$1', [session.user_id]);
      const isStillDisabled = user.disabled && (!user.disabled_until || new Date(user.disabled_until) > new Date());
      if (tokenRow.consumed_at || isStillDisabled) {
        // Không throw trong transaction: cần commit thao tác thu hồi khi phát hiện dùng lại.
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [session.id]);
        return null;
      }
      await tx.query('UPDATE refresh_tokens SET consumed_at=now() WHERE token_hash=$1', [tokenHash]);
      return this.issueTokens(tx, session.id, session.user_id);
    });
    if (!result) throw new UnauthorizedException('Phiên hết hạn hoặc đã bị thu hồi.');
    return result;
  }

  private async user(tx: EntityManager, userId: string): Promise<UserDto> {
    const [user] = await tx.query('SELECT id,email,display_name FROM users WHERE id=$1', [userId]);
    const rows = await tx.query('SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role', [userId]);
    return { ...user, roles: rows.map((row: { role: string }) => row.role) };
  }

  async authenticate(token: string): Promise<Principal> {
    let claims: { sub: string; sid: string };
    try {
      claims = await this.jwt.verifyAsync(token, { algorithms: ['HS256'], issuer: 'topic16-api', audience: 'topic16-clients' });
      if (!/^[a-f0-9-]{36}$/i.test(claims.sub) || !/^[a-f0-9-]{36}$/i.test(claims.sid)) throw new Error();
    } catch { throw new UnauthorizedException('Access token không hợp lệ.'); }
    const [session] = await this.db.query(`SELECT s.client_type FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
        AND (NOT u.disabled OR (u.disabled_until IS NOT NULL AND u.disabled_until <= now()))`, [claims.sid, claims.sub]);
    if (!session) throw new UnauthorizedException('Phiên đã bị thu hồi hoặc tài khoản đang bị khóa.');
    return { ...await this.user(this.db.manager, claims.sub), session_id: claims.sid, client_type: session.client_type };
  }

  async logout(principal: Principal): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2',
      [principal.session_id, principal.id]);
  }

  async switchRole(principal: Principal, targetRole: 'STUDENT' | 'INSTRUCTOR'): Promise<UserDto> {
    await this.db.query(
      'INSERT INTO user_roles(user_id, role) VALUES($1, $2) ON CONFLICT DO NOTHING',
      [principal.id, targetRole]
    );
    return this.user(this.db.manager, principal.id);
  }
}
