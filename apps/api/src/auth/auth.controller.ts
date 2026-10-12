import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CONFIG, Config } from '../config';
import { AuthService } from './auth.service';
import { AuthGuard, AuthRequest } from './auth.guard';
import { AuthResultDto, LoginDto, RefreshDto, RegisterDto, SwitchRoleDto, UserDto } from './dto';

const cookieName = 'lms_refresh';
@ApiTags('auth')
@ApiHeader({ name: 'Origin', required: false, description: 'Web bắt buộc bằng WEB_ORIGIN; mobile không gửi.' })
@ApiHeader({ name: 'X-CSRF-Protection', required: false, description: 'Web bắt buộc giá trị 1 trên POST.' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly config: Config) {}

  private checkTransport(request: Request, clientType: string): void {
    const origin = request.headers.origin;
    const allowed = new Set([this.config.WEB_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']);
    if (clientType === 'web' && (!origin || !allowed.has(origin) || request.headers['x-csrf-protection'] !== '1')) {
      throw new ForbiddenException('Origin hoặc CSRF header không hợp lệ.');
    }
    if (clientType === 'mobile' && request.headers.origin) throw new ForbiddenException('Trình duyệt phải dùng phiên web.');
  }

  private respond(response: Response, result: AuthResultDto, clientType: string): AuthResultDto {
    if (clientType === 'web') {
      response.cookie(cookieName, result.refresh_token, { httpOnly: true, secure: true, sameSite: 'strict',
        path: '/api/v1/auth', maxAge: 7 * 86400000 });
      const { refresh_token: _refresh, ...safe } = result;
      return safe;
    }
    return result;
  }

  @Post('register') @ApiCreatedResponse({ type: AuthResultDto })
  async register(@Body() input: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.checkTransport(request, input.client_type);
    return this.respond(response, await this.auth.register(input), input.client_type);
  }

  @Post('login') @HttpCode(200) @ApiOkResponse({ type: AuthResultDto })
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.checkTransport(request, input.client_type);
    return this.respond(response, await this.auth.login(input), input.client_type);
  }

  @Post('refresh') @HttpCode(200) @ApiOkResponse({ type: AuthResultDto })
  async refresh(@Body() input: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.checkTransport(request, input.client_type);
    const token = input.client_type === 'web'
      ? request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
      : input.refresh_token;
    return this.respond(response, await this.auth.refresh(token ?? '', input.client_type), input.client_type);
  }

  @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth() @ApiOkResponse({ type: UserDto })
  me(@Req() request: AuthRequest): UserDto {
    const { id, email, display_name, roles } = request.principal;
    return { id, email, display_name, roles };
  }

  @Post('logout') @HttpCode(204) @UseGuards(AuthGuard) @ApiBearerAuth() @ApiNoContentResponse()
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.checkTransport(request, request.principal.client_type);
    await this.auth.logout(request.principal);
    response.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth' });
  }

  @Post('switch-role') @HttpCode(200) @UseGuards(AuthGuard) @ApiBearerAuth() @ApiOkResponse({ type: UserDto })
  async switchRole(@Body() input: SwitchRoleDto, @Req() request: AuthRequest): Promise<UserDto> {
    return this.auth.switchRole(request.principal, input.role);
  }
}
