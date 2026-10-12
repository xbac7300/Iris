import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { AiConfig, GENERATION_PROMPT_VERSION, OllamaEmbedding, OllamaGeneration, parseSubtitles, validateSegments } from '@lms/ai-core';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { MediaService } from '../media/media.service';
import { Principal } from '../auth/auth.service';
import { ChatInputDto, SubtitleInputDto, TranscriptInputDto } from './dto';
export const AI_CONFIG = Symbol('AI_CONFIG');
@Injectable()
export class AiService {
  constructor(private readonly db: DataSource, private readonly media: MediaService, @Inject(AI_CONFIG) private readonly config: AiConfig|null) {}
  private providers() { if(!this.config) throw new ServiceUnavailableException('AI local chưa được bật.'); return {embedding:new OllamaEmbedding(this.config),generation:new OllamaGeneration(this.config)}; }
  async context(id: string,p: Principal) {
    const [l]=await this.db.query('SELECT l.*,m.course_id,c.owner_id,a.duration_sec FROM lessons l JOIN modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id LEFT JOIN media_assets a ON a.id=l.active_media_id WHERE l.id=$1',[id]);
    if(!l)throw new NotFoundException('Không tìm thấy bài học.'); await this.media.requireRead(this.db.manager,l.course_id,p); return l;
  }
  async status(id: string,p: Principal) {
    const l=await this.context(id,p);
    const tasks=await this.db.query('SELECT id,stage,status,attempts,error_code FROM ai_tasks WHERE media_id=$1 ORDER BY created_at DESC LIMIT 20',[l.active_media_id]);
    return {transcript_id:l.active_transcript_id,index_id:l.active_index_id,tasks};
  }
  async process(id: string,p: Principal) {
    this.providers(); const l=await this.context(id,p);
    if(l.owner_id!==p.id||!p.roles.includes('INSTRUCTOR'))throw new ForbiddenException('Chỉ chủ khóa được xử lý nguồn.');
    const [asset]=await this.db.query("SELECT id FROM media_assets WHERE id=$1 AND status='READY'",[l.active_media_id]);
    if(!asset)throw new ConflictException('Video chưa sẵn sàng.');
    const stage=l.active_index_id?'SUMMARY':l.active_transcript_id?'INDEX':'ASR';
    const key=stage==='SUMMARY'?`${l.active_index_id}/summary/${this.config!.GENERATION_MODEL_ID}/${GENERATION_PROMPT_VERSION}`:stage==='INDEX'?`${l.active_transcript_id}/index/${this.config!.EMBEDDING_MODEL_ID}`:`${asset.id}/asr/small-v1`;
    await this.db.query('INSERT INTO ai_tasks(id,media_id,transcript_id,stage,job_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_key) DO NOTHING',[randomUUID(),asset.id,l.active_transcript_id,stage,key]);
    // Retry thủ công vẫn giữ giới hạn tối đa 4 lượt; cần nguồn mới nếu lỗi lặp lại.
    return this.status(id,p);
  }
  async transcript(id: string,p: Principal) {
    const l=await this.context(id,p); if(!l.active_transcript_id)throw new ConflictException('Transcript đang được chuẩn bị.');
    const [t]=await this.db.query('SELECT id,media_id,version,language FROM transcript_versions WHERE id=$1',[l.active_transcript_id]);
    t.segments=await this.db.query('SELECT start_sec,end_sec,text FROM segments WHERE transcript_id=$1 ORDER BY position',[t.id]); return t;
  }
  async editTranscript(id: string,input: TranscriptInputDto,p: Principal) {
    const l=await this.context(id,p); if(l.owner_id!==p.id||!p.roles.includes('INSTRUCTOR'))throw new ForbiddenException('Chỉ chủ khóa được sửa transcript.');
    if(!l.duration_sec)throw new ConflictException('Video chưa sẵn sàng.');
    let segments; try{segments=validateSegments(input.segments,l.duration_sec);}catch{throw new UnprocessableEntityException('Timestamp hoặc nội dung transcript không hợp lệ.');}
    await this.db.transaction(async tx=>{
      const [current]=await tx.query('SELECT * FROM lessons WHERE id=$1 FOR UPDATE',[id]);
      if(current.active_media_id!==l.active_media_id || (current.active_transcript_id??undefined)!==input.expected_transcript_id)throw new ConflictException('Nguồn đã thay đổi; tải lại transcript trước khi lưu.');
      const [{version}]=await tx.query('SELECT COALESCE(max(version),0)+1 version FROM transcript_versions WHERE lesson_id=$1',[id]); const transcript=randomUUID();
      await tx.query('INSERT INTO transcript_versions(id,lesson_id,media_id,version,language,source) VALUES($1,$2,$3,$4,$5,$6)',[transcript,id,l.active_media_id,version,input.language,'instructor']);
      for(let position=0;position<segments.length;position++){const s=segments[position];await tx.query('INSERT INTO segments(id,transcript_id,position,start_sec,end_sec,text) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),transcript,position,s.start_sec,s.end_sec,s.text]);}
      if(current.active_index_id){await tx.query("UPDATE index_versions SET status='STALE' WHERE id=$1",[current.active_index_id]);await tx.query("UPDATE summaries SET status='STALE' WHERE index_id=$1",[current.active_index_id]);}
      await tx.query('UPDATE lessons SET active_transcript_id=$2,active_index_id=NULL WHERE id=$1',[id,transcript]);
      await tx.query("INSERT INTO ai_tasks(id,media_id,transcript_id,stage,job_key) VALUES($1,$2,$3,'INDEX',$4)",[randomUUID(),l.active_media_id,transcript,`${transcript}/index/${this.config?.EMBEDDING_MODEL_ID??'qwen3-embedding:0.6b'}`]);
    }); return this.transcript(id,p);
  }
  async subtitles(id:string,input:SubtitleInputDto,p:Principal){
    const l=await this.context(id,p);let segments;
    try{segments=parseSubtitles(input.content,l.duration_sec);}catch{throw new UnprocessableEntityException('Phụ đề SRT/VTT hoặc timestamp không hợp lệ.');}
    return this.editTranscript(id,{segments,language:input.language,expected_transcript_id:input.expected_transcript_id},p);
  }
  async retry(taskId:string,p:Principal){
    const [task]=await this.db.query('SELECT t.*,a.lesson_id FROM ai_tasks t JOIN media_assets a ON a.id=t.media_id WHERE t.id=$1',[taskId]);
    if(!task)throw new NotFoundException('Không tìm thấy tác vụ.');const l=await this.context(task.lesson_id,p);
    if(l.owner_id!==p.id||!p.roles.includes('INSTRUCTOR'))throw new ForbiddenException('Chỉ chủ khóa được thử lại.');
    await this.db.transaction(async tx=>{
      const [t]=await tx.query('SELECT * FROM ai_tasks WHERE id=$1 FOR UPDATE',[taskId]);
      const [{count}]=await tx.query("SELECT count(*)::int count FROM audit_logs WHERE resource_id=$1 AND action='AI_TASK_RETRIED'",[taskId]);
      if(t.status!=='FAILED'||count>=3||l.active_media_id!==t.media_id||(t.transcript_id&&l.active_transcript_id!==t.transcript_id))throw new ConflictException('Không thể thử lại nguồn cũ hoặc tác vụ đã hết lượt.');
      await tx.query("UPDATE ai_tasks SET status='PENDING',attempts=0,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[taskId]);
      await tx.query("INSERT INTO audit_logs(id,actor_id,action,resource_id) VALUES($1,$2,'AI_TASK_RETRIED',$3)",[randomUUID(),p.id,taskId]);
    });return this.status(task.lesson_id,p);
  }
  async summary(id: string,p: Principal) {
    const l=await this.context(id,p);
    const [s]=await this.db.query('SELECT * FROM summaries WHERE index_id=$1 AND model_id=$2 AND prompt_version=$3 ORDER BY created_at DESC LIMIT 1',[l.active_index_id,this.config?.GENERATION_MODEL_ID??'qwen3:4b',GENERATION_PROMPT_VERSION]);
    const [task]=await this.db.query("SELECT status FROM ai_tasks WHERE transcript_id=$1 AND stage='SUMMARY' ORDER BY created_at DESC LIMIT 1",[l.active_transcript_id]);
    return {status:s?.status??(task?.status==='FAILED'?'FAILED':'PENDING'),sections:(s?.content??[]).map((section:{answer:string;citations:object[]})=>({...section,citations:section.citations.map(c=>({...c,lesson_id:id,media_version:l.active_media_id,transcript_version:l.active_transcript_id}))}))};
  }
  private async message(id: string,p: Principal) {
    const [m]=await this.db.query('SELECT m.*,c.lesson_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND c.user_id=$2',[id,p.id]);
    if(!m)throw new NotFoundException('Không tìm thấy hội thoại.'); await this.context(m.lesson_id,p);
    const citations=await this.db.query(`SELECT t.lesson_id,t.media_id media_version,t.id transcript_version,k.id chunk_id,k.start_sec,k.end_sec,left(k.text,600) excerpt
      FROM citations ci JOIN chunks k ON k.id=ci.chunk_id JOIN index_versions i ON i.id=k.index_id JOIN transcript_versions t ON t.id=i.transcript_id WHERE ci.message_id=$1`,[id]);
    return {id:m.id,conversation_id:m.conversation_id,index_version:m.index_id,question:m.question,answer:m.answer,evidence_status:m.evidence_status,citations};
  }
  async history(lesson: string,limit: number,p: Principal) {
    await this.context(lesson,p);
    const rows=await this.db.query('SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND c.lesson_id=$2 ORDER BY m.created_at DESC LIMIT $3',[p.id,lesson,limit]);
    const result=[];for(const row of rows.reverse())result.push(await this.message(row.id,p));return result;
  }
  async chat(id: string,input: ChatInputDto,p: Principal) {
    const providers=this.providers(), l=await this.context(id,p);
    if(!l.active_index_id)throw new ConflictException('Chỉ mục nguồn đang được chuẩn bị. Lịch sử cũ vẫn được giữ.');
    const [index]=await this.db.query("SELECT * FROM index_versions WHERE id=$1 AND status='READY'",[l.active_index_id]);
    if(!index||index.model_id!==providers.embedding.modelId||index.dimensions!==providers.embedding.dimensions)throw new ConflictException('Cần xây lại chỉ mục cho model đang dùng.');
    const hash=createHash('sha256').update(JSON.stringify([id,input.question,input.conversation_id??null])).digest('hex');
    const reservation=await this.db.transaction(async tx=>{
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[p.id]);
      await tx.query("UPDATE ai_usage SET status='FAILED' WHERE user_id=$1 AND status='PENDING' AND created_at<now()-interval '10 minutes'",[p.id]);
      const [existing]=await tx.query('SELECT * FROM ai_usage WHERE user_id=$1 AND request_key=$2',[p.id,input.request_key]);
      if(existing){if(existing.request_hash!==hash)throw new ConflictException('Request key đã dùng cho nội dung khác.');if(existing.status==='COMPLETE')return existing;if(existing.status==='PENDING')throw new ConflictException('Câu hỏi đang xử lý.');throw new ServiceUnavailableException('Lần xử lý trước thất bại; dùng yêu cầu mới để thử lại.');}
      const [{count}]=await tx.query("SELECT count(*)::int count FROM ai_usage WHERE user_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND status<>'FAILED'",[p.id]);
      if(count>=this.config!.AI_CHAT_DAILY_QUOTA)throw new HttpException('Đã hết hạn mức hỏi đáp hôm nay.',429);
      const usage=randomUUID();await tx.query("INSERT INTO ai_usage(id,user_id,lesson_id,request_key,request_hash,status) VALUES($1,$2,$3,$4,$5,'PENDING')",[usage,p.id,id,input.request_key,hash]);return {id:usage};
    });
    if(reservation.message_id)return this.message(reservation.message_id,p);
    const start=Date.now();
    try{
      if(input.conversation_id){const [c]=await this.db.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 AND lesson_id=$3',[input.conversation_id,p.id,id]);if(!c)throw new NotFoundException('Hội thoại không thuộc tài khoản/bài học.');}
      const history=input.conversation_id?await this.db.query('SELECT question,answer FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 3',[input.conversation_id]):[];
      history.reverse();
      const retrievalQuestion=history.length&&input.question.length<100?`${history.at(-1).question}\n${input.question}`:input.question;
      const [vector]=await providers.embedding.embed([retrievalQuestion],true);
      const evidence=await this.db.query(`SELECT c.id chunk_id,c.text FROM chunks c JOIN embeddings e ON e.chunk_id=c.id WHERE c.index_id=$1 AND e.model_id=$2 AND e.dimensions=$3 ORDER BY e.values::vector <=> $4::vector LIMIT 5`,[index.id,index.model_id,index.dimensions,JSON.stringify(vector)]);
      const result=await providers.generation.generate(input.question,evidence,false,history);
      const updated=await this.context(id,p);if(updated.active_index_id!==index.id)throw new ConflictException('Nguồn vừa thay đổi; hãy hỏi lại trên bản mới.');
      const message=await this.db.transaction(async tx=>{
        const [current]=await tx.query('SELECT active_index_id FROM lessons WHERE id=$1 FOR UPDATE',[id]);if(current.active_index_id!==index.id)throw new ConflictException('Nguồn đã thay đổi.');
        const conversation=input.conversation_id??randomUUID();if(!input.conversation_id)await tx.query('INSERT INTO conversations(id,user_id,lesson_id) VALUES($1,$2,$3)',[conversation,p.id,id]);
        const message=randomUUID();await tx.query('INSERT INTO messages(id,conversation_id,index_id,question,answer,evidence_status) VALUES($1,$2,$3,$4,$5,$6)',[message,conversation,index.id,input.question,result.answer.answer,result.answer.evidence_status]);
        for(const chunk of new Set(result.answer.chunk_ids))await tx.query('INSERT INTO citations(id,message_id,chunk_id) VALUES($1,$2,$3)',[randomUUID(),message,chunk]);
        await tx.query("UPDATE ai_usage SET status='COMPLETE',message_id=$2,input_tokens=$3,output_tokens=$4,latency_ms=$5 WHERE id=$1",[reservation.id,message,result.inputTokens,result.outputTokens,Date.now()-start]);return message;
      });return this.message(message,p);
    }catch(error){await this.db.query("UPDATE ai_usage SET status='FAILED' WHERE id=$1 AND status='PENDING'",[reservation.id]);if(error instanceof HttpException)throw error;throw new ServiceUnavailableException('Model local chưa trả lời được. Vui lòng thử lại sau.');}
  }
}
