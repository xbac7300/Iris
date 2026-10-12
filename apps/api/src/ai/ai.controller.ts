import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { AiService } from './ai.service';
import { AiStatusDto, ChatDto, ChatInputDto, LessonScopeDto, SubtitleInputDto, SummaryDto, TranscriptDto, TranscriptInputDto } from './dto';
@Controller() @UseGuards(AuthGuard) @ApiBearerAuth() @ApiTags('ai')
export class AiController {
  constructor(private readonly ai: AiService){}
  @Get('lessons/:id/ai-status') @ApiOkResponse({type:AiStatusDto})
  status(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.ai.status(id,r.principal);}
  @Post('lessons/:id/ai-process') @ApiCreatedResponse({type:AiStatusDto})
  process(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.ai.process(id,r.principal);}
  @Get('lessons/:id/transcript') @ApiOkResponse({type:TranscriptDto})
  transcript(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.ai.transcript(id,r.principal);}
  @Post('lessons/:id/transcript-versions') @ApiCreatedResponse({type:TranscriptDto})
  edit(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:TranscriptInputDto,@Req() r:AuthRequest){return this.ai.editTranscript(id,input,r.principal);}
  @Post('lessons/:id/subtitles') @ApiCreatedResponse({type:TranscriptDto})
  subtitles(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:SubtitleInputDto,@Req() r:AuthRequest){return this.ai.subtitles(id,input,r.principal);}
  @Post('ai-tasks/:id/retry') @ApiCreatedResponse({type:AiStatusDto})
  retry(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.ai.retry(id,r.principal);}
  @Get('lessons/:id/summary') @ApiOkResponse({type:SummaryDto})
  summary(@Param('id',new ParseUUIDPipe()) id:string,@Req() r:AuthRequest){return this.ai.summary(id,r.principal);}
  @Post('lessons/:id/chat') @ApiCreatedResponse({type:ChatDto})
  chat(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ChatInputDto,@Req() r:AuthRequest){return this.ai.chat(id,input,r.principal);}
  @Get('me/conversations') @ApiOkResponse({type:[ChatDto]})
  history(@Query() q:LessonScopeDto,@Req() r:AuthRequest){return this.ai.history(q.lesson_id,q.limit,r.principal);}
}
