import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { CourseDto, PageDto, ScheduleActionDto } from '../courses/courses.controller';
import { MediaService } from './media.service';
import { AcceptedJobDto, CreateLessonDto, CreateModuleDto, EnrollmentDto, JobDto, LessonDto, ModuleDto, PlaybackDto, UploadCompleteDto, UploadDto, UploadResultDto } from './dto';
import { EnrollmentMemberDto, EnrollmentStatusDto, LessonDetailsDto, UpdateLessonDto } from './dto';

@Controller() @ApiTags('learning') @ApiBearerAuth() @UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Post('courses/:id/modules') @ApiCreatedResponse({ type: ModuleDto })
  addModule(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: CreateModuleDto, @Req() req: AuthRequest) {
    return this.media.addModule(id, input, req.principal);
  }
  @Delete('modules/:id') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteModule(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) {
    return this.media.deleteModule(id, req.principal);
  }
  @Post('modules/:id/delete') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteModulePost(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) {
    return this.media.deleteModule(id, req.principal);
  }
  @Post('modules/:id/lessons') @ApiCreatedResponse({ type: LessonDto })
  addLesson(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: CreateLessonDto, @Req() req: AuthRequest) {
    return this.media.addLesson(id, input, req.principal);
  }
  @Delete('lessons/:id') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteLesson(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) {
    return this.media.deleteLesson(id, req.principal);
  }
  @Post('lessons/:id/delete') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteLessonPost(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) {
    return this.media.deleteLesson(id, req.principal);
  }
  @Patch('lessons/:id') @ApiOkResponse({type:LessonDto})
  updateLesson(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:UpdateLessonDto,@Req() r:AuthRequest){return this.media.updateLesson(id,input,r.principal);}
  @Get('courses/:id/enrollments') @ApiOkResponse({type:[EnrollmentMemberDto]})
  members(@Param('id',new ParseUUIDPipe()) id:string,@Query() page:PageDto,@Req() r:AuthRequest){return this.media.members(id,page,r.principal);}
  @Post('enrollments/:id/status') @HttpCode(200) @ApiOkResponse({schema:{type:'object',properties:{id:{type:'string',format:'uuid'}},required:['id']}})
  enrollmentStatus(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:EnrollmentStatusDto,@Req() r:AuthRequest){return this.media.enrollmentStatus(id,input.revoked,r.principal);}
  @Get('courses/:id/modules') @ApiOkResponse({ type: [ModuleDto] })
  modules(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest, @Query() page: PageDto) { return this.media.modules(id, req.principal, page); }
  @Get('courses/:id/lessons') @ApiOkResponse({ type: [LessonDetailsDto] })
  lessons(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest, @Query() page: PageDto) { return this.media.lessons(id, req.principal, page); }
  @Post('courses/:id/publish') @HttpCode(200) @ApiOkResponse({ type: CourseDto })
  @ApiBody({ type: ScheduleActionDto, required: false })
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: ScheduleActionDto | undefined, @Req() req: AuthRequest) { return this.media.publish(id, req.principal, input); }
  @Post('courses/:id/archive') @HttpCode(200) @ApiOkResponse({ type: CourseDto })
  @ApiBody({ type: ScheduleActionDto, required: false })
  archive(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: ScheduleActionDto | undefined, @Req() req: AuthRequest) { return this.media.archive(id, req.principal, input); }
  @Post('courses/:id/enrollments') @HttpCode(200) @ApiOkResponse({ type: EnrollmentDto })
  enroll(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) { return this.media.enroll(id, req.principal); }
  @Post('lessons/:id/upload-url') @ApiCreatedResponse({ type: UploadResultDto })
  upload(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UploadDto, @Req() req: AuthRequest) {
    return this.media.upload(id, input.size_bytes, req.principal, req.headers.host);
  }
  @Post('lessons/:id/upload-complete') @HttpCode(202) @ApiAcceptedResponse({ type: AcceptedJobDto })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UploadCompleteDto, @Req() req: AuthRequest) {
    return this.media.complete(id, input.media_id, req.principal);
  }
  @Get('lessons/:id/playback') @ApiOkResponse({ type: PlaybackDto })
  playback(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) { return this.media.playback(id, req.principal, req.headers.host); }
  @Get('jobs/:id') @ApiOkResponse({ type: JobDto })
  job(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) { return this.media.job(id, req.principal); }
  @Post('jobs/:id/retry') @HttpCode(202) @ApiAcceptedResponse({ type: AcceptedJobDto })
  retry(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthRequest) { return this.media.retry(id, req.principal); }
}
