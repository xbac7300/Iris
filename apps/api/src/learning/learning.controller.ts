import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { LearningService } from './learning.service';
import { AnalyticsDto, AttemptDto, CourseProgressDto, PlaybackSessionDto, QuizDto, QuizInputDto, SubmitDto, WatchBatchDto, WatchResultDto } from './dto';
@Controller() @ApiBearerAuth() @ApiTags('assessment') @UseGuards(AuthGuard)
export class LearningController {
  constructor(private readonly service:LearningService){}
  @Post('courses/:id/quizzes') @ApiCreatedResponse({type:QuizDto})
  create(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:QuizInputDto,@Req() r:AuthRequest){return this.service.createQuiz(id,input,r.principal);}
  @Get('courses/:id/quizzes') @ApiOkResponse({type:[QuizDto]})
  quizzes(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.quizzes(id,r.principal);}
  @Get('quizzes/:id') @ApiOkResponse({type:QuizDto})
  quiz(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.quiz(id,r.principal);}
  @Delete('quizzes/:id') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteQuiz(@Param('id', new ParseUUIDPipe()) id: string, @Req() r: AuthRequest) {
    return this.service.deleteQuiz(id, r.principal);
  }
  @Post('quizzes/:id/delete') @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } } } })
  deleteQuizPost(@Param('id', new ParseUUIDPipe()) id: string, @Req() r: AuthRequest) {
    return this.service.deleteQuiz(id, r.principal);
  }
  @Get('quizzes/:id/submissions') @ApiOkResponse({ type: [Object] })
  submissions(@Param('id', new ParseUUIDPipe()) id: string, @Req() r: AuthRequest) {
    return this.service.quizSubmissions(id, r.principal);
  }
  @Get('quizzes/:id/my-attempts') @ApiOkResponse({ type: [Object] })
  myAttempts(@Param('id', new ParseUUIDPipe()) id: string, @Req() r: AuthRequest) {
    return this.service.myAttempts(id, r.principal);
  }
  @Post('attempts/:id/grade') @HttpCode(200) @ApiOkResponse({ type: AttemptDto })
  gradeAttempt(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: any, @Req() r: AuthRequest) {
    return this.service.gradeAttempt(id, input, r.principal);
  }
  @Post('quizzes/:id/attempts') @ApiCreatedResponse({type:AttemptDto})
  attempt(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.attempt(id,r.principal);}
  @Get('attempts/:id') @ApiOkResponse({type:AttemptDto})
  result(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.getAttempt(id,r.principal);}
  @Post('attempts/:id/submit') @HttpCode(200) @ApiOkResponse({type:AttemptDto})
  submit(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:SubmitDto,@Req() r:AuthRequest){return this.service.submit(id,input,r.principal);}
  @Post('lessons/:id/playback-sessions') @ApiCreatedResponse({type:PlaybackSessionDto})
  playback(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.playbackSession(id,r.principal);}
  @Post('lessons/:id/watch-events') @HttpCode(200) @ApiOkResponse({type:WatchResultDto})
  watch(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:WatchBatchDto,@Req() r:AuthRequest){return this.service.watch(id,input,r.principal);}
  @Get('me/courses/:id/progress') @ApiOkResponse({type:CourseProgressDto})
  progress(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.progress(id,r.principal);}
  @Get('courses/:id/analytics') @ApiOkResponse({type:AnalyticsDto})
  analytics(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.service.analytics(id,r.principal);}
}
