import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { PageDto } from '../courses/courses.controller';

export class AdminUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() display_name!: string;
  @ApiProperty() disabled!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) disabled_from?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) disabled_until?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) disabled_reason?: string | null;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class RoleInputDto {
  @ApiProperty({ enum: ['STUDENT', 'INSTRUCTOR', 'ADMIN'] })
  @IsIn(['STUDENT', 'INSTRUCTOR', 'ADMIN']) role!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

export class UsageDto {
  @ApiProperty() users!: number;
  @ApiProperty() courses!: number;
  @ApiProperty() chats_today!: number;
  @ApiProperty() failed_ai_tasks!: number;
  @ApiProperty() pending_media_jobs!: number;
}

export class SetDisabledDto {
  @ApiProperty() @IsBoolean() disabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() days?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() disabled_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() disabled_until?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class CreateAnnouncementDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MinLength(1) message!: string;
  @ApiProperty({ enum: ['ALL', 'INSTRUCTOR', 'STUDENT', 'USER'] })
  @IsIn(['ALL', 'INSTRUCTOR', 'STUDENT', 'USER']) target_type!: 'ALL' | 'INSTRUCTOR' | 'STUDENT' | 'USER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() target_user_id?: string;
}

export class ResolveComplaintDto {
  @ApiProperty({ enum: ['CLOSE_COURSE', 'DISMISS'] })
  @IsIn(['CLOSE_COURSE', 'DISMISS'])
  action!: 'CLOSE_COURSE' | 'DISMISS';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  admin_notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locked_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locked_until?: string;
}

export class LockCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() days?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() locked_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locked_until?: string;
}

export class AnnouncementDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty() target_type!: string;
  @ApiPropertyOptional() target_user_id?: string | null;
  @ApiPropertyOptional() target_user_name?: string | null;
  @ApiProperty() created_by_name!: string;
  @ApiProperty() created_at!: string;
  @ApiProperty() read_count!: number;
}

export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['SYSTEM', 'SUBMISSION', 'COURSE_UPDATE'] }) type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiPropertyOptional() course_id?: string;
  @ApiPropertyOptional() course_title?: string;
  @ApiPropertyOptional() quiz_id?: string;
  @ApiPropertyOptional() student_name?: string;
  @ApiProperty() read!: boolean;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('admin')
export class AdminController implements OnModuleInit {
  constructor(private readonly db: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_from TIMESTAMPTZ NULL').catch(() => {});
  }

  private async autoClearExpiredLocks(): Promise<void> {
    await this.db.query(
      'UPDATE users SET disabled=false, disabled_from=NULL, disabled_until=NULL, disabled_reason=NULL WHERE disabled=true AND disabled_until IS NOT NULL AND disabled_until <= now()'
    ).catch(() => {});
    await this.db.query(
      "UPDATE courses SET status='PUBLISHED', is_locked=FALSE, locked_at=NULL, locked_reason=NULL, locked_by=NULL, scheduled_until=NULL, action_reason=NULL, updated_at=now() WHERE is_locked=TRUE AND scheduled_until IS NOT NULL AND scheduled_until <= now()"
    ).catch(() => {});
  }

  @Get('users')
  @ApiOkResponse({ type: [AdminUserDto] })
  async users(@Query() page: PageDto, @Req() request: AuthRequest): Promise<AdminUserDto[]> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    await this.autoClearExpiredLocks();
    const rows = await this.db.query(
      `SELECT u.id, u.email, u.display_name, u.disabled,
              u.disabled_from, u.disabled_until, u.disabled_reason,
              array_agg(r.role ORDER BY r.role) as roles
       FROM users u
       JOIN user_roles r ON r.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
      [page.limit, page.offset]
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      email: String(r.email),
      display_name: String(r.display_name),
      disabled: Boolean(r.disabled),
      roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
      disabled_from: r.disabled_from ? new Date(String(r.disabled_from)).toISOString() : null,
      disabled_until: r.disabled_until ? new Date(String(r.disabled_until)).toISOString() : null,
      disabled_reason: r.disabled_reason ? String(r.disabled_reason) : null,
    }));
  }

  @Get('users/usage')
  @ApiOkResponse({ type: UsageDto })
  async usage(@Req() request: AuthRequest): Promise<UsageDto> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    const [result] = await this.db.query(
      `SELECT (SELECT count(*)::int FROM users) users,
              (SELECT count(*)::int FROM courses) courses,
              (SELECT count(*)::int FROM ai_usage WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND status='COMPLETE') chats_today,
              (SELECT count(*)::int FROM ai_tasks WHERE status='FAILED') failed_ai_tasks,
              (SELECT count(*)::int FROM jobs WHERE status IN ('RUNNING','PENDING')) pending_media_jobs`
    );
    return result;
  }

  @Post('users/:id/roles')
  @HttpCode(204)
  @ApiNoContentResponse()
  async role(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: RoleInputDto, @Req() request: AuthRequest): Promise<void> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    if (request.principal.id === id) throw new ForbiddenException('Không tự đổi quyền quản trị.');
    await this.db.transaction(async tx => {
      const [u] = await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      if (!u) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (input.enabled) {
        await tx.query('INSERT INTO user_roles(user_id, role) VALUES($1, $2) ON CONFLICT DO NOTHING', [id, input.role]);
      } else {
        const [{ count }] = await tx.query('SELECT count(*)::int count FROM user_roles WHERE user_id=$1', [id]);
        if (count <= 1) throw new ForbiddenException('Tài khoản cần ít nhất một vai trò.');
        await tx.query('DELETE FROM user_roles WHERE user_id=$1 AND role=$2', [id, input.role]);
      }
      await tx.query('INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
        [randomUUID(), request.principal.id, `${input.enabled ? 'ROLE_GRANTED' : 'ROLE_REVOKED'}_${input.role}`, id]);
    });
  }

  @Post('users/:id/status')
  @HttpCode(204)
  @ApiNoContentResponse()
  async setStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: SetDisabledDto, @Req() request: AuthRequest): Promise<void> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    if (id === request.principal.id) throw new ForbiddenException('Không tự khóa tài khoản quản trị.');

    let from: Date | null = null;
    let until: Date | null = null;
    if (input.disabled) {
      if (input.disabled_from) {
        const parsedFrom = new Date(input.disabled_from);
        if (!isNaN(parsedFrom.getTime())) from = parsedFrom;
      }
      if (input.days && input.days > 0) {
        const baseTime = from ? from.getTime() : Date.now();
        until = new Date(baseTime + input.days * 24 * 60 * 60 * 1000);
      } else if (input.disabled_until) {
        const parsedUntil = new Date(input.disabled_until);
        if (!isNaN(parsedUntil.getTime())) until = parsedUntil;
      }
    }
    const reason = input.disabled ? (input.reason?.trim() || null) : null;

    await this.db.transaction(async tx => {
      const rows = await tx.query(
        'UPDATE users SET disabled=$1, disabled_from=$2, disabled_until=$3, disabled_reason=$4 WHERE id=$5 RETURNING id',
        [input.disabled, from ? from.toISOString() : null, until ? until.toISOString() : null, reason, id]
      );
      if (!rows[0]?.id && !rows[0]?.length) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (input.disabled && (!from || from <= new Date())) {
        await tx.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1', [id]);
      }
      await tx.query('INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
        [randomUUID(), request.principal.id, input.disabled ? 'USER_DISABLED' : 'USER_ENABLED', id]);
    });
  }

  @Get('announcements')
  @ApiOkResponse({ type: [AnnouncementDto] })
  async listAnnouncements(@Req() request: AuthRequest): Promise<AnnouncementDto[]> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    const rows = await this.db.query(
      `SELECT a.*, creator.display_name as creator_name, target.display_name as target_user_name,
        (SELECT count(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) as read_count
       FROM announcements a
       JOIN users creator ON creator.id = a.created_by
       LEFT JOIN users target ON target.id = a.target_user_id
       ORDER BY a.created_at DESC LIMIT 50`
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      title: String(r.title),
      message: String(r.message),
      target_type: String(r.target_type),
      target_user_id: r.target_user_id ? String(r.target_user_id) : null,
      target_user_name: r.target_user_name ? String(r.target_user_name) : null,
      created_by_name: r.creator_name ? String(r.creator_name) : 'Admin',
      created_at: new Date(String(r.created_at)).toISOString(),
      read_count: Number(r.read_count || 0),
    }));
  }

  @Post('announcements')
  @ApiOkResponse({ type: AnnouncementDto })
  async createAnnouncement(@Body() input: CreateAnnouncementDto, @Req() request: AuthRequest): Promise<Record<string, unknown>> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    if (input.target_type === 'USER' && !input.target_user_id) {
      throw new BadRequestException('Cần chọn người dùng cụ thể khi gửi thông báo cá nhân.');
    }
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO announcements(id, title, message, target_type, target_user_id, created_by)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [id, input.title.trim(), input.message.trim(), input.target_type, input.target_user_id || null, request.principal.id]
    );
    await this.db.query(
      'INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
      [randomUUID(), request.principal.id, 'ANNOUNCEMENT_CREATED', id]
    );
    return { id, ...input, created_at: new Date().toISOString() };
  }

  @Delete('announcements/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async deleteAnnouncement(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<void> {
    if (!request.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    await this.db.query('DELETE FROM announcements WHERE id = $1', [id]);
    await this.db.query(
      'INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
      [randomUUID(), request.principal.id, 'ANNOUNCEMENT_DELETED', id]
    );
  }

  @Get('complaints')
  @ApiOkResponse({ type: [Object] })
  async getComplaints(@Req() req: AuthRequest): Promise<Record<string, unknown>[]> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    await this.autoClearExpiredLocks();
    return this.db.query(`
      SELECT comp.id, comp.course_id, comp.user_id, comp.reason, comp.description,
             comp.status, comp.admin_notes, comp.resolved_at, comp.created_at,
             c.title as course_title, c.status as course_status, c.is_locked as course_is_locked,
             u.display_name as student_name, u.email as student_email,
             inst.display_name as instructor_name, inst.email as instructor_email
      FROM course_complaints comp
      JOIN courses c ON c.id = comp.course_id
      JOIN users u ON u.id = comp.user_id
      JOIN users inst ON inst.id = c.owner_id
      ORDER BY comp.created_at DESC
    `);
  }

  @Post('complaints/:id/resolve')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  async resolveComplaint(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ResolveComplaintDto,
    @Req() req: AuthRequest
  ): Promise<{ success: boolean }> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    const [comp] = await this.db.query('SELECT * FROM course_complaints WHERE id=$1', [id]);
    if (!comp) throw new NotFoundException('Không tìm thấy khiếu nại.');

    const notes = input.admin_notes?.trim() || null;
    if (input.action === 'CLOSE_COURSE') {
      let lockedAt: Date = new Date();
      if (input.locked_from) {
        const parsedFrom = new Date(input.locked_from);
        if (!isNaN(parsedFrom.getTime())) lockedAt = parsedFrom;
      }
      let until: Date | null = null;
      if (input.days && input.days > 0) {
        until = new Date(lockedAt.getTime() + input.days * 24 * 60 * 60 * 1000);
      } else if (input.locked_until) {
        const parsedUntil = new Date(input.locked_until);
        if (!isNaN(parsedUntil.getTime())) until = parsedUntil;
      }
      const lockReason = `Đã đóng/khóa khóa học theo khiếu nại của học viên (${comp.reason}): ${notes || 'Vi phạm tiêu chuẩn'}`;
      await this.db.query(
        "UPDATE courses SET status='ARCHIVED', is_locked=TRUE, locked_at=$4, scheduled_until=$5, locked_reason=$1, locked_by=$2, action_reason=$1, updated_at=now() WHERE id=$3",
        [lockReason, req.principal.id, comp.course_id, lockedAt.toISOString(), until ? until.toISOString() : null]
      );
      await this.db.query(
        "UPDATE course_complaints SET status='RESOLVED', admin_notes=$1, resolved_by=$2, resolved_at=now() WHERE id=$3",
        [notes || 'Đã đóng và khóa khóa học theo khiếu nại', req.principal.id, id]
      );
      await this.db.query(
        "INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)",
        [randomUUID(), req.principal.id, 'COURSE_CLOSED_AND_LOCKED_BY_COMPLAINT', comp.course_id]
      );
    } else {
      await this.db.query(
        "UPDATE course_complaints SET status='DISMISSED', admin_notes=$1, resolved_by=$2, resolved_at=now() WHERE id=$3",
        [notes || 'Khiếu nại không đủ cơ sở xử lý', req.principal.id, id]
      );
    }
    return { success: true };
  }

  @Get('locked-courses')
  @ApiOkResponse({ type: [Object] })
  async getLockedCourses(@Req() req: AuthRequest): Promise<Record<string, unknown>[]> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    await this.autoClearExpiredLocks();
    return this.db.query(`
      SELECT c.id, c.title, c.description, c.status, c.is_locked, c.locked_at, c.locked_reason,
             c.scheduled_until as locked_until, c.created_at, c.thumbnail_url,
             u.id as owner_id, u.display_name as owner_name, u.email as owner_email,
             lb.display_name as locked_by_name
      FROM courses c
      JOIN users u ON u.id = c.owner_id
      LEFT JOIN users lb ON lb.id = c.locked_by
      WHERE c.is_locked = TRUE
      ORDER BY c.locked_at DESC NULLS LAST
    `);
  }

  @Get('all-courses')
  @ApiOkResponse({ type: [Object] })
  async getAllCourses(@Req() req: AuthRequest): Promise<Record<string, unknown>[]> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    await this.autoClearExpiredLocks();
    return this.db.query(`
      SELECT c.id, c.title, c.description, c.status, c.is_locked, c.locked_at, c.locked_reason,
             c.scheduled_until as locked_until, c.created_at, c.thumbnail_url, c.tag,
             u.id as owner_id, u.display_name as owner_name, u.email as owner_email,
             lb.display_name as locked_by_name
      FROM courses c
      JOIN users u ON u.id = c.owner_id
      LEFT JOIN users lb ON lb.id = c.locked_by
      ORDER BY c.is_locked DESC, c.created_at DESC
    `);
  }

  @Post('courses/:id/unlock')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } })
  async unlockCourse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest
  ): Promise<{ success: boolean; message: string }> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    const [c] = await this.db.query('SELECT id, title, is_locked FROM courses WHERE id=$1', [id]);
    if (!c) throw new NotFoundException('Không tìm thấy khóa học.');
    await this.db.query(`
      UPDATE courses
      SET is_locked=FALSE, status='PUBLISHED', locked_at=NULL, scheduled_until=NULL, locked_reason=NULL, locked_by=NULL, action_reason=NULL, updated_at=now()
      WHERE id=$1
    `, [id]);
    await this.db.query(
      'INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
      [randomUUID(), req.principal.id, 'COURSE_UNLOCKED', id]
    );
    return { success: true, message: `Đã mở khóa thành công cho khóa học "${c.title}". Khóa học đã được mở lại ở trạng thái Đã xuất bản.` };
  }

  @Post('courses/:id/lock')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  async lockCourse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: LockCourseDto,
    @Req() req: AuthRequest
  ): Promise<{ success: boolean }> {
    if (!req.principal.roles.includes('ADMIN')) throw new ForbiddenException('Cần quyền quản trị.');
    const [c] = await this.db.query('SELECT id, title FROM courses WHERE id=$1', [id]);
    if (!c) throw new NotFoundException('Không tìm thấy khóa học.');
    const reason = input?.reason?.trim() || 'Tạm khóa bởi Quản trị viên để kiểm duyệt';
    let lockedAt: Date = new Date();
    if (input?.locked_from) {
      const parsedFrom = new Date(input.locked_from);
      if (!isNaN(parsedFrom.getTime())) lockedAt = parsedFrom;
    }
    let until: Date | null = null;
    if (input?.days && input.days > 0) {
      until = new Date(lockedAt.getTime() + input.days * 24 * 60 * 60 * 1000);
    } else if (input?.locked_until) {
      const parsedUntil = new Date(input.locked_until);
      if (!isNaN(parsedUntil.getTime())) until = parsedUntil;
    }
    await this.db.query(`
      UPDATE courses
      SET is_locked=TRUE, status='ARCHIVED', locked_at=$3, scheduled_until=$4, locked_reason=$1, locked_by=$2, action_reason=$1, updated_at=now()
      WHERE id=$5
    `, [reason, req.principal.id, lockedAt.toISOString(), until ? until.toISOString() : null, id]);
    await this.db.query(
      'INSERT INTO audit_logs(id, actor_id, action, resource_id) VALUES($1, $2, $3, $4)',
      [randomUUID(), req.principal.id, 'COURSE_LOCKED', id]
    );
    return { success: true };
  }
}

@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly db: DataSource) {}

  @Get('unread')
  @ApiOkResponse({ type: [AnnouncementDto] })
  async unread(@Req() request: AuthRequest): Promise<AnnouncementDto[]> {
    const roles = request.principal.roles;
    const isInstructor = roles.includes('INSTRUCTOR');
    const isStudent = roles.includes('STUDENT');

    const rows = await this.db.query(
      `SELECT a.*, u.display_name as creator_name,
        (SELECT count(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) as read_count
       FROM announcements a
       JOIN users u ON u.id = a.created_by
       WHERE (
         a.target_type = 'ALL'
         OR (a.target_type = 'INSTRUCTOR' AND $2::boolean)
         OR (a.target_type = 'STUDENT' AND $3::boolean)
         OR (a.target_type = 'USER' AND a.target_user_id = $1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $1
       )
       ORDER BY a.created_at DESC LIMIT 5`,
      [request.principal.id, isInstructor, isStudent]
    );

    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      title: String(r.title),
      message: String(r.message),
      target_type: String(r.target_type),
      target_user_id: r.target_user_id ? String(r.target_user_id) : null,
      created_by_name: r.creator_name ? String(r.creator_name) : 'Hệ thống',
      created_at: new Date(String(r.created_at)).toISOString(),
      read_count: Number(r.read_count || 0),
    }));
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiNoContentResponse()
  async markRead(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<void> {
    await this.db.query(
      'INSERT INTO announcement_reads(announcement_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING',
      [id, request.principal.id]
    );
  }

  @Get('notifications')
  @ApiOkResponse({ type: [NotificationDto] })
  async getNotifications(@Req() request: AuthRequest): Promise<NotificationDto[]> {
    const roles = request.principal.roles;
    const isInstructor = roles.includes('INSTRUCTOR');
    const isStudent = roles.includes('STUDENT');
    const userId = request.principal.id;

    const notifs: NotificationDto[] = [];

    // 1. System announcements
    const announcements = await this.db.query(
      `SELECT a.*, u.display_name as creator_name,
        EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $1) as is_read
       FROM announcements a
       JOIN users u ON u.id = a.created_by
       WHERE (
         a.target_type = 'ALL'
         OR (a.target_type = 'INSTRUCTOR' AND $2::boolean)
         OR (a.target_type = 'STUDENT' AND $3::boolean)
         OR (a.target_type = 'USER' AND a.target_user_id = $1)
       )
       ORDER BY a.created_at DESC LIMIT 15`,
      [userId, isInstructor, isStudent]
    );

    for (const a of announcements) {
      notifs.push({
        id: a.id,
        type: 'SYSTEM',
        title: `Thông báo hệ thống: ${a.title}`,
        message: a.message,
        created_at: new Date(a.created_at).toISOString(),
        read: Boolean(a.is_read),
      });
    }

    // 2. Instructor: Student quiz submissions
    if (isInstructor) {
      const submissions = await this.db.query(
        `SELECT a.id, a.submitted_at, a.graded_at, u.display_name as student_name,
                q.title as quiz_title, c.title as course_title, c.id as course_id, q.id as quiz_id
         FROM attempts a
         JOIN quiz_versions q ON q.id = a.quiz_id
         JOIN courses c ON c.id = q.course_id
         JOIN users u ON u.id = a.user_id
         WHERE c.owner_id = $1 AND a.status = 'SUBMITTED'
         ORDER BY a.submitted_at DESC LIMIT 15`,
        [userId]
      );

      for (const s of submissions) {
        notifs.push({
          id: `sub-${s.id}`,
          type: 'SUBMISSION',
          title: 'Bài nộp mới từ học viên',
          message: `Học viên ${s.student_name || 'Học viên'} vừa nộp bài kiểm tra "${s.quiz_title}" trong khóa học "${s.course_title}".`,
          created_at: new Date(s.submitted_at).toISOString(),
          course_id: s.course_id,
          course_title: s.course_title,
          quiz_id: s.quiz_id,
          student_name: s.student_name,
          read: Boolean(s.graded_at),
        });
      }
    }

    // 3. Student: Course updates (new lessons / modules) in enrolled courses
    if (isStudent) {
      const updates = await this.db.query(
        `SELECT l.id, l.title as lesson_title, m.title as module_title, c.title as course_title, c.id as course_id, c.updated_at
         FROM lessons l
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
         JOIN enrollments e ON e.course_id = c.id
         WHERE e.user_id = $1 AND e.revoked_at IS NULL
         ORDER BY c.updated_at DESC, l.position ASC LIMIT 15`,
        [userId]
      );

      for (const u of updates) {
        notifs.push({
          id: `lesson-${u.id}`,
          type: 'COURSE_UPDATE',
          title: 'Bài học mới trong khóa học',
          message: `Khóa học "${u.course_title}" vừa cập nhật bài giảng mới: "${u.lesson_title}" (Chương: ${u.module_title}).`,
          created_at: new Date(u.updated_at).toISOString(),
          course_id: u.course_id,
          course_title: u.course_title,
          read: false,
        });
      }
    }

    // Sort by created_at DESC
    notifs.sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
    return notifs.slice(0, 30);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  async markAllRead(@Req() request: AuthRequest): Promise<{ success: boolean }> {
    const userId = request.principal.id;
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    const isStudent = request.principal.roles.includes('STUDENT');

    const rows = await this.db.query(
      `SELECT a.id FROM announcements a
       WHERE (
         a.target_type = 'ALL'
         OR (a.target_type = 'INSTRUCTOR' AND $2::boolean)
         OR (a.target_type = 'STUDENT' AND $3::boolean)
         OR (a.target_type = 'USER' AND a.target_user_id = $1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $1
       )`,
      [userId, isInstructor, isStudent]
    );

    for (const r of rows) {
      await this.db.query(
        'INSERT INTO announcement_reads(announcement_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING',
        [r.id, userId]
      );
    }
    return { success: true };
  }
}
