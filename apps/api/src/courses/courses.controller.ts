import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';

export const COURSE_TAGS = [
  'Phát triển',
  'Kinh doanh',
  'Tài chính & Kế toán',
  'CNTT & Phần mềm',
  'Năng suất văn phòng',
  'Phát triển cá nhân',
  'Thiết kế',
  'Marketing',
  'Sức khỏe & Thể dục',
  'Âm nhạc',
] as const;
export type CourseTag = (typeof COURSE_TAGS)[number];

export const ACCESS_MODES = ['PUBLIC', 'LINK', 'RESTRICTED'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export class CreateCourseDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString() @Length(1, 200) @Matches(/\S/) title!: string;
  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @ApiPropertyOptional({ enum: COURSE_TAGS, default: 'CNTT & Phần mềm' })
  @IsOptional() @IsString() tag?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional() @IsString() thumbnail_url?: string;
  @ApiPropertyOptional({ enum: ACCESS_MODES, default: 'PUBLIC' })
  @IsOptional() @IsString() access_mode?: AccessMode;
  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional() allowed_emails?: string[];
}
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}
export class CourseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) owner_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ enum: COURSE_TAGS }) tag?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) thumbnail_url?: string | null;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ format: 'date-time' }) updated_at!: string;
  @ApiPropertyOptional({ enum: ['PUBLISH', 'ARCHIVE', 'DELETE'] }) scheduled_action?: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) scheduled_at?: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) scheduled_until?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) action_reason?: string | null;
  @ApiPropertyOptional({ type: Boolean }) is_locked?: boolean;
  @ApiPropertyOptional({ format: 'date-time' }) locked_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) locked_reason?: string | null;
  @ApiPropertyOptional({ enum: ACCESS_MODES, default: 'PUBLIC' }) access_mode?: AccessMode;
  @ApiPropertyOptional({ type: String, nullable: true }) share_code?: string | null;
  @ApiPropertyOptional({ type: [String], default: [] }) allowed_emails?: string[];
  @ApiPropertyOptional() avg_rating?: number;
  @ApiPropertyOptional() review_count?: number;
  @ApiPropertyOptional() like_count?: number;
  @ApiPropertyOptional() user_liked?: boolean;
  @ApiPropertyOptional() user_enrolled?: boolean;
}
export class ScheduleActionDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  scheduled_at?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  scheduled_until?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  reason?: string;
}
export class CreateComplaintDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString() @Length(1, 255) reason!: string;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @IsString() @Length(1, 5000) description!: string;
}

export class SubmitFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @Length(0, 1000) comment?: string;
}
export class FeedbackItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) user_id!: string;
  @ApiProperty() user_name!: string;
  @ApiProperty() rating!: number;
  @ApiProperty() comment!: string;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
}
export class CourseFeedbackSummaryDto {
  @ApiProperty() avg_rating!: number;
  @ApiProperty() total_reviews!: number;
  @ApiProperty() total_likes!: number;
  @ApiProperty() user_liked!: boolean;
  @ApiPropertyOptional({ type: FeedbackItemDto }) user_review?: FeedbackItemDto;
  @ApiProperty({ type: [FeedbackItemDto] }) reviews!: FeedbackItemDto[];
}
export class ToggleLikeResponseDto {
  @ApiProperty() liked!: boolean;
  @ApiProperty() total_likes!: number;
}
export class PageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset: number = 0;
}

@ApiTags('courses') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('courses')
export class CoursesController {
  constructor(private readonly db: DataSource) {}

  @Get() @ApiOkResponse({ type: [CourseDto] })
  async list(@Req() request: AuthRequest, @Query() page: PageDto): Promise<CourseDto[]> {
    await this.autoResolveSchedules();
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    const isAdmin = request.principal.roles.includes('ADMIN');
    const userEmail = request.principal.email?.toLowerCase() || '';

    // Khóa học công khai (PUBLIC), hoặc thuộc sở hữu giảng viên, hoặc admin,
    // hoặc người dùng đã đăng ký (kể cả LINK hay RESTRICTED),
    // hoặc với khóa RESTRICTED thì email người dùng nằm trong allowed_emails
    const rows = await this.db.query(
      `SELECT c.*,
        COALESCE(ROUND(AVG(f.rating)::numeric, 1), 0)::float AS avg_rating,
        COUNT(DISTINCT f.id)::int AS review_count,
        COUNT(DISTINCT lk.user_id)::int AS like_count,
        EXISTS(SELECT 1 FROM course_likes cl WHERE cl.course_id=c.id AND cl.user_id=$1) AS user_liked,
        EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$1 AND e.revoked_at IS NULL) AS user_enrolled
      FROM courses c
      LEFT JOIN course_feedback f ON f.course_id=c.id
      LEFT JOIN course_likes lk ON lk.course_id=c.id
      WHERE (
        status='PUBLISHED'
        OR (owner_id=$1 AND $4::boolean)
        OR $5::boolean
        OR (status='ARCHIVED' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$1 AND e.revoked_at IS NULL))
      ) AND (
        c.access_mode = 'PUBLIC'
        OR c.owner_id = $1
        OR EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$1 AND e.revoked_at IS NULL)
        OR (c.access_mode = 'RESTRICTED' AND EXISTS (
          SELECT 1 FROM unnest(c.allowed_emails) AS elem WHERE lower(trim(elem)) = lower($6)
        ))
      )
      GROUP BY c.id
      ORDER BY c.created_at DESC, c.id LIMIT $2 OFFSET $3`,
      [request.principal.id, page.limit, page.offset, isInstructor, isAdmin, userEmail]
    );
    return rows.map((r: any) => ({
      ...r,
      tag: r.tag || 'CNTT & Phần mềm',
      thumbnail_url: r.thumbnail_url || null,
      scheduled_action: r.scheduled_action || null,
      scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
      scheduled_until: r.scheduled_until ? new Date(r.scheduled_until).toISOString() : null,
      action_reason: r.action_reason || null,
      is_locked: Boolean(r.is_locked),
      locked_at: r.locked_at ? new Date(r.locked_at).toISOString() : null,
      locked_reason: r.locked_reason || null,
      access_mode: r.access_mode || 'PUBLIC',
      share_code: r.share_code || null,
      allowed_emails: Array.isArray(r.allowed_emails) ? r.allowed_emails : [],
      avg_rating: Number(r.avg_rating || 0),
      review_count: Number(r.review_count || 0),
      like_count: Number(r.like_count || 0),
      user_liked: Boolean(r.user_liked),
      user_enrolled: Boolean(r.user_enrolled),
    }));
  }

  @Get(':id') @ApiOkResponse({ type: CourseDto })
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<CourseDto> {
    await this.autoResolveSchedules();
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    const isAdmin = request.principal.roles.includes('ADMIN');
    const userEmail = request.principal.email?.toLowerCase() || '';

    const rows = await this.db.query(
      `SELECT c.*,
        COALESCE(ROUND(AVG(f.rating)::numeric, 1), 0)::float AS avg_rating,
        COUNT(DISTINCT f.id)::int AS review_count,
        COUNT(DISTINCT lk.user_id)::int AS like_count,
        EXISTS(SELECT 1 FROM course_likes cl WHERE cl.course_id=c.id AND cl.user_id=$2) AS user_liked,
        EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$2 AND e.revoked_at IS NULL) AS user_enrolled
      FROM courses c
      LEFT JOIN course_feedback f ON f.course_id=c.id
      LEFT JOIN course_likes lk ON lk.course_id=c.id
      WHERE c.id=$1 AND (
        status='PUBLISHED'
        OR (owner_id=$2 AND $3::boolean)
        OR $4::boolean
        OR (status='ARCHIVED' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$2 AND e.revoked_at IS NULL))
      )
      GROUP BY c.id`,
      [id, request.principal.id, isInstructor, isAdmin]
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy khóa học.');
    const r = rows[0];

    // Kiểm tra quyền đối với khóa học RESTRICTED
    if (r.access_mode === 'RESTRICTED' && !isAdmin && r.owner_id !== request.principal.id) {
      const isEnrolled = Boolean(r.user_enrolled);
      const isAllowed = Array.isArray(r.allowed_emails) && r.allowed_emails.map((e: string) => e.toLowerCase()).includes(userEmail);
      if (!isEnrolled && !isAllowed) {
        throw new ForbiddenException('Bạn không thuộc danh sách học viên được chỉ định tham gia khóa học này.');
      }
    }

    return {
      ...r,
      tag: r.tag || 'CNTT & Phần mềm',
      thumbnail_url: r.thumbnail_url || null,
      scheduled_action: r.scheduled_action || null,
      scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
      scheduled_until: r.scheduled_until ? new Date(r.scheduled_until).toISOString() : null,
      action_reason: r.action_reason || null,
      is_locked: Boolean(r.is_locked),
      locked_at: r.locked_at ? new Date(r.locked_at).toISOString() : null,
      locked_reason: r.locked_reason || null,
      access_mode: r.access_mode || 'PUBLIC',
      share_code: r.share_code || null,
      allowed_emails: Array.isArray(r.allowed_emails) ? r.allowed_emails : [],
      avg_rating: Number(r.avg_rating || 0),
      review_count: Number(r.review_count || 0),
      like_count: Number(r.like_count || 0),
      user_liked: Boolean(r.user_liked),
      user_enrolled: Boolean(r.user_enrolled),
    };
  }

  @Get(':id/feedback') @ApiOkResponse({ type: CourseFeedbackSummaryDto })
  async getFeedback(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<CourseFeedbackSummaryDto> {
    const [stats] = await this.db.query(
      `SELECT 
        COALESCE(ROUND(AVG(f.rating)::numeric, 1), 0)::float AS avg_rating,
        COUNT(DISTINCT f.id)::int AS total_reviews,
        COUNT(DISTINCT lk.user_id)::int AS total_likes,
        EXISTS(SELECT 1 FROM course_likes cl WHERE cl.course_id=$1 AND cl.user_id=$2) AS user_liked
      FROM courses c
      LEFT JOIN course_feedback f ON f.course_id=c.id
      LEFT JOIN course_likes lk ON lk.course_id=c.id
      WHERE c.id=$1
      GROUP BY c.id`,
      [id, request.principal.id]
    );

    const reviews = await this.db.query(
      `SELECT f.id, f.user_id, COALESCE(u.display_name, 'Học viên') as user_name, f.rating, f.comment, f.created_at
       FROM course_feedback f
       JOIN users u ON u.id = f.user_id
       WHERE f.course_id = $1
       ORDER BY f.created_at DESC`,
      [id]
    );

    const userReview = reviews.find((r: { user_id: string }) => r.user_id === request.principal.id) || undefined;

    return {
      avg_rating: stats ? Number(stats.avg_rating || 0) : 0,
      total_reviews: stats ? Number(stats.total_reviews || 0) : 0,
      total_likes: stats ? Number(stats.total_likes || 0) : 0,
      user_liked: stats ? Boolean(stats.user_liked) : false,
      user_review: userReview,
      reviews,
    };
  }

  @Post(':id/feedback') @ApiCreatedResponse({ type: FeedbackItemDto })
  async submitFeedback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SubmitFeedbackDto,
    @Req() request: AuthRequest
  ): Promise<FeedbackItemDto> {
    const [course] = await this.db.query('SELECT id, owner_id FROM courses WHERE id=$1', [id]);
    if (!course) throw new NotFoundException('Không tìm thấy khóa học.');
    if (course.owner_id === request.principal.id) {
      throw new ForbiddenException('Giảng viên không thể tự đánh giá khóa học của mình.');
    }

    const [saved] = await this.db.query(
      `INSERT INTO course_feedback(id, course_id, user_id, rating, comment, updated_at)
       VALUES($1, $2, $3, $4, $5, now())
       ON CONFLICT (course_id, user_id)
       DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, updated_at=now()
       RETURNING *`,
      [randomUUID(), id, request.principal.id, input.rating, (input.comment ?? '').trim()]
    );

    const [user] = await this.db.query('SELECT display_name FROM users WHERE id=$1', [request.principal.id]);

    return {
      id: saved.id,
      user_id: saved.user_id,
      user_name: user?.display_name || 'Học viên',
      rating: saved.rating,
      comment: saved.comment,
      created_at: saved.created_at,
    };
  }

  @Post(':id/feedback/delete') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  deleteFeedbackPost(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<{ success: boolean }> {
    return this.deleteFeedback(id, request);
  }

  @Delete(':id/feedback') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  async deleteFeedback(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<{ success: boolean }> {
    await this.db.query('DELETE FROM course_feedback WHERE course_id=$1 AND user_id=$2', [id, request.principal.id]);
    return { success: true };
  }

  @Post(':id/like') @HttpCode(200)
  @ApiOkResponse({ type: ToggleLikeResponseDto })
  async toggleLike(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<ToggleLikeResponseDto> {
    const [course] = await this.db.query('SELECT id FROM courses WHERE id=$1', [id]);
    if (!course) throw new NotFoundException('Không tìm thấy khóa học.');

    const [existing] = await this.db.query('SELECT 1 FROM course_likes WHERE course_id=$1 AND user_id=$2', [id, request.principal.id]);
    let liked = false;
    if (existing) {
      await this.db.query('DELETE FROM course_likes WHERE course_id=$1 AND user_id=$2', [id, request.principal.id]);
      liked = false;
    } else {
      await this.db.query('INSERT INTO course_likes(course_id, user_id) VALUES($1, $2)', [id, request.principal.id]);
      liked = true;
    }

    const [countRow] = await this.db.query('SELECT COUNT(*)::int as total FROM course_likes WHERE course_id=$1', [id]);
    return {
      liked,
      total_likes: Number(countRow?.total || 0),
    };
  }

  @Post() @ApiCreatedResponse({ type: CourseDto })
  async create(@Body() input: CreateCourseDto, @Req() request: AuthRequest): Promise<CourseDto> {
    if (!request.principal.roles.includes('INSTRUCTOR')) throw new ForbiddenException('Chỉ giảng viên được tạo khóa học.');
    const tag = input.tag && (COURSE_TAGS as readonly string[]).includes(input.tag) ? input.tag : 'CNTT & Phần mềm';
    const accessMode = input.access_mode && (ACCESS_MODES as readonly string[]).includes(input.access_mode) ? input.access_mode : 'PUBLIC';
    const allowedEmails = Array.isArray(input.allowed_emails)
      ? input.allowed_emails.map(e => String(e).trim().toLowerCase()).filter(e => e.length > 0)
      : [];
    const shareCode = randomUUID().replace(/-/g, '').slice(0, 16);

    const [course] = await this.db.query(
      'INSERT INTO courses(id,owner_id,title,description,tag,thumbnail_url,access_mode,share_code,allowed_emails) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [randomUUID(), request.principal.id, input.title.trim(), input.description ?? '', tag, input.thumbnail_url?.trim() || null, accessMode, shareCode, allowedEmails]
    );
    return {
      ...course,
      tag: course.tag || tag,
      thumbnail_url: course.thumbnail_url || null,
      access_mode: course.access_mode || accessMode,
      share_code: course.share_code || shareCode,
      allowed_emails: Array.isArray(course.allowed_emails) ? course.allowed_emails : allowedEmails,
    };
  }

  @Patch(':id') @ApiOkResponse({ type: CourseDto })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateCourseDto,
    @Req() request: AuthRequest): Promise<CourseDto> {
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    if (!isInstructor) throw new ForbiddenException('Chỉ giảng viên sở hữu mới được sửa thông tin khóa học.');
    const [existingCourse] = await this.db.query('SELECT owner_id, is_locked, locked_reason FROM courses WHERE id=$1', [id]);
    if (!existingCourse) throw new NotFoundException('Không tìm thấy khóa học.');
    if (existingCourse.owner_id !== request.principal.id) throw new ForbiddenException('Chỉ giảng viên sở hữu mới được sửa thông tin khóa học.');
    if (existingCourse.is_locked) {
      throw new ForbiddenException(`Khóa học này đang bị Quản trị viên khóa${existingCourse.locked_reason ? `: ${existingCourse.locked_reason}` : ''}. Không thể chỉnh sửa.`);
    }

    const tag = input.tag && (COURSE_TAGS as readonly string[]).includes(input.tag) ? input.tag : undefined;
    const title = input.title !== undefined ? input.title.trim() : undefined;
    const hasTitle = title !== undefined;
    const hasDesc = input.description !== undefined;
    const hasTag = tag !== undefined;
    const hasThumb = input.thumbnail_url !== undefined;
    const thumbVal = hasThumb ? (input.thumbnail_url?.trim() || null) : null;
    const descVal = hasDesc ? (input.description ?? '') : '';

    const hasAccessMode = input.access_mode !== undefined && (ACCESS_MODES as readonly string[]).includes(input.access_mode);
    const accessModeVal = hasAccessMode ? input.access_mode : 'PUBLIC';

    const hasAllowedEmails = input.allowed_emails !== undefined;
    const allowedEmailsVal = hasAllowedEmails && Array.isArray(input.allowed_emails)
      ? input.allowed_emails.map(e => String(e).trim().toLowerCase()).filter(e => e.length > 0)
      : [];

    const [rows] = await this.db.query(
      `UPDATE courses SET
        title = CASE WHEN $1::boolean THEN $2 ELSE title END,
        description = CASE WHEN $3::boolean THEN $4 ELSE description END,
        tag = CASE WHEN $5::boolean THEN $6 ELSE tag END,
        thumbnail_url = CASE WHEN $7::boolean THEN $8 ELSE thumbnail_url END,
        access_mode = CASE WHEN $9::boolean THEN $10 ELSE access_mode END,
        allowed_emails = CASE WHEN $11::boolean THEN $12::text[] ELSE allowed_emails END,
        updated_at = now()
      WHERE id = $13 AND owner_id = $14 RETURNING id`,
      [hasTitle, title, hasDesc, descVal, hasTag, tag, hasThumb, thumbVal, hasAccessMode, accessModeVal, hasAllowedEmails, allowedEmailsVal, id, request.principal.id]
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy khóa học thuộc quyền sở hữu của bạn.');
    return this.get(id, request);
  }

  @Post(':id/complaints') @HttpCode(201)
  @ApiCreatedResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  async createComplaint(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateComplaintDto,
    @Req() request: AuthRequest
  ): Promise<{ success: boolean; id: string }> {
    if (!request.principal.roles.includes('STUDENT')) {
      throw new ForbiddenException('Chỉ học viên mới có thể gửi khiếu nại về khóa học.');
    }
    const [course] = await this.db.query('SELECT id, title, owner_id FROM courses WHERE id=$1', [id]);
    if (!course) throw new NotFoundException('Không tìm thấy khóa học.');
    if (course.owner_id === request.principal.id) {
      throw new ForbiddenException('Không thể gửi khiếu nại về khóa học của chính bạn.');
    }

    const [enrollment] = await this.db.query(
      'SELECT 1 FROM enrollments WHERE course_id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [id, request.principal.id]
    );
    if (!enrollment) {
      throw new ForbiddenException('Bạn chỉ có thể khiếu nại về khóa học mà bạn đã đăng ký tham gia.');
    }

    const complaintId = randomUUID();
    await this.db.query(
      `INSERT INTO course_complaints(id, course_id, user_id, reason, description, created_at)
       VALUES($1, $2, $3, $4, $5, now())`,
      [complaintId, id, request.principal.id, input.reason.trim(), input.description.trim()]
    );

    return { success: true, id: complaintId };
  }

  @Post(':id/cancel-schedule') @HttpCode(200)
  @ApiOkResponse({ type: CourseDto })
  async cancelSchedule(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest): Promise<CourseDto> {
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    const isAdmin = request.principal.roles.includes('ADMIN');
    if (!isInstructor && !isAdmin) throw new ForbiddenException('Chỉ giảng viên sở hữu hoặc quản trị viên mới được thao tác.');
    const [res] = await this.db.query(
      "UPDATE courses SET scheduled_action=NULL, scheduled_at=NULL, scheduled_until=NULL, action_reason=NULL, updated_at=now() WHERE id=$1 AND (owner_id=$2 OR $3::boolean) RETURNING id",
      [id, request.principal.id, isAdmin]
    );
    if (!res) throw new NotFoundException('Không tìm thấy khóa học thuộc quyền quản lý.');
    return this.get(id, request);
  }

  @Post(':id/delete') @HttpCode(200)
  @ApiBody({ type: ScheduleActionDto, required: false })
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, scheduled: { type: 'boolean' } } } })
  deletePost(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: ScheduleActionDto | undefined, @Req() request: AuthRequest): Promise<{ success: boolean; id: string; scheduled?: boolean }> {
    return this.delete(id, input, request);
  }

  @Delete(':id') @HttpCode(200)
  @ApiBody({ type: ScheduleActionDto, required: false })
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, scheduled: { type: 'boolean' } } } })
  async delete(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: ScheduleActionDto | undefined, @Req() request: AuthRequest): Promise<{ success: boolean; id: string; scheduled?: boolean }> {
    const isInstructor = request.principal.roles.includes('INSTRUCTOR');
    const isAdmin = request.principal.roles.includes('ADMIN');
    if (!isInstructor && !isAdmin) throw new ForbiddenException('Chỉ giảng viên sở hữu hoặc quản trị viên mới được xóa khóa học.');

    const reason = input?.reason?.trim() || null;
    const scheduledUntil = input?.scheduled_until ? new Date(input.scheduled_until).toISOString() : null;
    if (input?.scheduled_at && new Date(input.scheduled_at).getTime() > Date.now()) {
      const [res] = await this.db.query(
        "UPDATE courses SET scheduled_action='DELETE', scheduled_at=$1, scheduled_until=$2, action_reason=$3, updated_at=now() WHERE id=$4 AND (owner_id=$5 OR $6::boolean) RETURNING id",
        [new Date(input.scheduled_at).toISOString(), scheduledUntil, reason, id, request.principal.id, isAdmin]
      );
      if (!res) throw new NotFoundException('Không tìm thấy khóa học thuộc quyền quản lý.');
      return { success: true, id, scheduled: true };
    }

    await this.deleteCourseCascade(id, request.principal.id, isAdmin, reason);
    return { success: true, id };
  }

  private async autoResolveSchedules(): Promise<void> {
    const overdue = await this.db.query(
      "SELECT * FROM courses WHERE scheduled_action IS NOT NULL AND scheduled_at IS NOT NULL AND scheduled_at <= now()"
    );
    for (const c of overdue) {
      if (c.scheduled_action === 'PUBLISH') {
        await this.db.query(
          "UPDATE courses SET status='PUBLISHED', scheduled_action=NULL, scheduled_at=NULL, scheduled_until=NULL, action_reason=NULL, updated_at=now() WHERE id=$1",
          [c.id]
        );
      } else if (c.scheduled_action === 'ARCHIVE') {
        await this.db.query(
          "UPDATE courses SET status='ARCHIVED', scheduled_action=NULL, scheduled_at=NULL, updated_at=now() WHERE id=$1",
          [c.id]
        );
      } else if (c.scheduled_action === 'DELETE') {
        await this.deleteCourseCascade(c.id, undefined, true, c.action_reason);
      }
    }

    const rePublish = await this.db.query(
      "SELECT * FROM courses WHERE status='ARCHIVED' AND scheduled_until IS NOT NULL AND scheduled_until <= now()"
    );
    for (const c of rePublish) {
      await this.db.query(
        "UPDATE courses SET status='PUBLISHED', scheduled_until=NULL, action_reason=NULL, updated_at=now() WHERE id=$1",
        [c.id]
      );
    }
  }

  private async deleteCourseCascade(id: string, actorId?: string, isAdmin = true, reason?: string | null): Promise<void> {
    await this.db.transaction(async tx => {
      const [course] = await tx.query(
        actorId && !isAdmin
          ? 'SELECT * FROM courses WHERE id=$1 AND owner_id=$2 FOR UPDATE'
          : 'SELECT * FROM courses WHERE id=$1 FOR UPDATE',
        actorId && !isAdmin ? [id, actorId] : [id]
      );
      if (!course) throw new NotFoundException('Không tìm thấy khóa học thuộc quyền quản lý.');

      const lessons = await tx.query(
        'SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=$1',
        [id]
      );
      const lessonIds = lessons.map((l: { id: string }) => l.id);

      const mediaRows = lessonIds.length
        ? await tx.query('SELECT id FROM media_assets WHERE lesson_id=ANY($1)', [lessonIds])
        : [];
      const mediaIds = mediaRows.map((m: { id: string }) => m.id);

      if (lessonIds.length > 0) {
        await tx.query(
          'UPDATE lessons SET active_transcript_id=NULL, active_index_id=NULL, active_media_id=NULL WHERE id=ANY($1)',
          [lessonIds]
        );

        await tx.query(
          'DELETE FROM ai_tasks WHERE media_id IN (SELECT id FROM media_assets WHERE lesson_id=ANY($1)) OR transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM ai_usage WHERE lesson_id=ANY($1) OR message_id IN (SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM citations WHERE message_id IN (SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query('DELETE FROM conversations WHERE lesson_id=ANY($1)', [lessonIds]);

        await tx.query(
          'DELETE FROM embeddings WHERE chunk_id IN (SELECT c.id FROM chunks c JOIN index_versions i ON i.id=c.index_id JOIN transcript_versions t ON t.id=i.transcript_id WHERE t.lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM chunks WHERE index_id IN (SELECT i.id FROM index_versions i JOIN transcript_versions t ON t.id=i.transcript_id WHERE t.lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM summaries WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM index_versions WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query(
          'DELETE FROM segments WHERE transcript_id IN (SELECT id FROM transcript_versions WHERE lesson_id=ANY($1))',
          [lessonIds]
        );
        await tx.query('DELETE FROM transcript_versions WHERE lesson_id=ANY($1)', [lessonIds]);
      }

      if (mediaIds.length > 0) {
        await tx.query('DELETE FROM ai_tasks WHERE media_id=ANY($1)', [mediaIds]);
        await tx.query(
          'DELETE FROM watch_events WHERE session_id IN (SELECT id FROM playback_sessions WHERE media_id=ANY($1))',
          [mediaIds]
        );
        await tx.query('DELETE FROM playback_sessions WHERE media_id=ANY($1)', [mediaIds]);
        await tx.query('DELETE FROM lesson_progress WHERE media_id=ANY($1)', [mediaIds]);
        await tx.query('DELETE FROM resume_state WHERE media_id=ANY($1)', [mediaIds]);

        await tx.query(
          'DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE media_id=ANY($1))',
          [mediaIds]
        );
        await tx.query('DELETE FROM jobs WHERE media_id=ANY($1)', [mediaIds]);
        await tx.query('DELETE FROM media_assets WHERE id=ANY($1)', [mediaIds]);
      }

      // Xóa toàn bộ quiz thuộc khóa học, module hoặc lesson của khóa trước khi xóa lesson/module
      const quizzes = await tx.query(
        'SELECT id FROM quiz_versions WHERE course_id=$1 OR module_id IN (SELECT id FROM modules WHERE course_id=$1) OR lesson_id=ANY($2)',
        [id, lessonIds.length ? lessonIds : ['00000000-0000-0000-0000-000000000000']]
      );
      const quizIds = quizzes.map((q: { id: string }) => q.id);
      if (quizIds.length > 0) {
        await tx.query(
          'DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE quiz_id=ANY($1)) OR question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))',
          [quizIds]
        );
        await tx.query('DELETE FROM attempts WHERE quiz_id=ANY($1)', [quizIds]);
        await tx.query(
          'DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id=ANY($1))',
          [quizIds]
        );
        await tx.query('DELETE FROM questions WHERE quiz_id=ANY($1)', [quizIds]);
        await tx.query('DELETE FROM quiz_versions WHERE id=ANY($1)', [quizIds]);
      }

      if (lessonIds.length > 0) {
        await tx.query('DELETE FROM lessons WHERE id=ANY($1)', [lessonIds]);
      }

      await tx.query('DELETE FROM modules WHERE course_id=$1', [id]);

      await tx.query('DELETE FROM course_feedback WHERE course_id=$1', [id]);
      await tx.query('DELETE FROM course_likes WHERE course_id=$1', [id]);
      await tx.query('DELETE FROM enrollments WHERE course_id=$1', [id]);
      await tx.query('DELETE FROM courses WHERE id=$1', [id]);
      if (actorId) {
        await tx.query(
          'INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,$3,$4)',
          [randomUUID(), actorId, 'COURSE_DELETED', id]
        );
      }
    });
  }
}
