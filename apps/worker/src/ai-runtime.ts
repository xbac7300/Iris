import { DataSource } from 'typeorm';
import { Queue, Worker } from 'bullmq';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ObjectStorage } from '@lms/media-core';
import { AiConfig, chunkSegments, GENERATION_PROMPT_VERSION, OllamaEmbedding, OllamaGeneration, validateSegments } from '@lms/ai-core';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { redisConnection, WorkerConfig } from './config';
const execute = promisify(execFile);
export class AiRuntime {
  private readonly db: DataSource;
  private readonly storage: ObjectStorage;
  private readonly queue: Queue;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;
  private readonly embedding: OllamaEmbedding;
  private readonly generation: OllamaGeneration;
  constructor(private readonly config: WorkerConfig, private readonly ai: AiConfig, private readonly modelPath: string) {
    this.db = new DataSource({ type:'postgres',url:config.DATABASE_URL,synchronize:false,logging:false,extra:{max:4,statement_timeout:15000} });
    this.storage = new ObjectStorage(config); this.queue = new Queue(`${config.MEDIA_QUEUE_NAME}-ai`,{connection:redisConnection(config.REDIS_URL)});
    this.embedding = new OllamaEmbedding(ai); this.generation = new OllamaGeneration(ai);
    this.queue.on('error',()=>console.error('AI queue chưa kết nối được.'));
  }
  async start() {
    await this.db.initialize(); await this.queue.waitUntilReady();
    await this.embedding.embed(['Kiểm tra chiều vector.']);
    this.worker = new Worker(`${this.config.MEDIA_QUEUE_NAME}-ai`,job=>this.process(job.data.id),{connection:redisConnection(this.config.REDIS_URL),concurrency:1,lockDuration:60000});
    this.worker.on('error',()=>console.error('AI worker gặp lỗi kết nối.'));
    this.timer = setInterval(()=>void this.poll(),3000); await this.poll();
  }
  private async poll() {
    if (this.closing || this.polling) return;
    this.polling = (async()=> {
      // DB là nguồn trạng thái chuẩn; có thể phục hồi queue sau Redis restart.
      const rows = await this.db.query(`SELECT id FROM ai_tasks WHERE (status='PENDING' OR (status='RUNNING' AND lease_until<now())) AND attempts<4 ORDER BY created_at LIMIT 20`);
      for (const row of rows) {
        const existing = await this.queue.getJob(row.id);
        if (existing) { const state = await existing.getState(); if (!['failed','completed'].includes(state)) continue; await existing.remove(); }
        await this.queue.add('ai-stage',{id:row.id},{jobId:row.id,attempts:4,backoff:{type:'exponential',delay:3000},removeOnComplete:{age:86400},removeOnFail:{age:86400}});
      }
    })().catch(()=>console.error('AI outbox chưa xử lý được; sẽ thử lại.')).finally(()=>{this.polling=undefined;});
    return this.polling;
  }
  private async process(id: string) {
    const lease = randomUUID();
    const task = await this.db.transaction(async tx=>{
      const [t] = await tx.query('SELECT * FROM ai_tasks WHERE id=$1 FOR UPDATE',[id]);
      if (!t || !['PENDING','RUNNING'].includes(t.status) || t.attempts>=4 || (t.lease_until && new Date(t.lease_until).getTime()>Date.now())) return null;
      await tx.query("UPDATE ai_tasks SET status='RUNNING',attempts=attempts+1,lease_id=$2,lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1",[id,lease]); return t;
    });
    if (!task) return;
    const heartbeat = setInterval(()=>void this.db.query("UPDATE ai_tasks SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_id=$2",[id,lease]).catch(()=>{}),15000);
    try {
      const [asset] = await this.db.query('SELECT a.*,l.active_media_id,l.active_transcript_id,l.active_index_id FROM media_assets a JOIN lessons l ON l.id=a.lesson_id WHERE a.id=$1',[task.media_id]);
      if (!asset || asset.active_media_id!==task.media_id || (task.transcript_id && asset.active_transcript_id!==task.transcript_id)) {
        await this.db.query("UPDATE ai_tasks SET status='STALE',lease_until=NULL,lease_id=NULL WHERE id=$1 AND lease_id=$2",[id,lease]); return;
      }
      if (task.stage==='ASR') {
        const root = resolve(this.config.MEDIA_TEMP_DIR); await mkdir(root,{recursive:true}); const directory = await mkdtemp(join(root,'asr-'));
        try {
          const file = join(directory,'media.mp4'), output = join(directory,'transcript.json');
          const source = await this.storage.client.send(new GetObjectCommand({Bucket:this.config.S3_BUCKET,Key:asset.playback_key}));
          await pipeline(source.Body as Readable,createWriteStream(file),{signal:AbortSignal.timeout(180000)});
          await execute(this.config.PYTHON_EXECUTABLE,[resolve('services/asr/transcribe.py'),'--input',file,'--output',output,'--model',resolve(this.modelPath),'--language','auto'],{shell:false,windowsHide:true,timeout:3600000,maxBuffer:1024*1024,env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}});
          const raw = JSON.parse(await readFile(output,'utf8')); const segments = validateSegments(raw.segments,asset.duration_sec);
          await this.db.transaction(async tx=>{
            const [current] = await tx.query('SELECT * FROM lessons WHERE id=$1 FOR UPDATE',[asset.lesson_id]);
            const [guard] = await tx.query('SELECT lease_id FROM ai_tasks WHERE id=$1 FOR UPDATE',[id]);
            if (guard.lease_id!==lease || current.active_media_id!==task.media_id || current.active_transcript_id) {await tx.query("UPDATE ai_tasks SET status='STALE',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2",[id,lease]);return;}
            const transcript = randomUUID(); const [{version}] = await tx.query('SELECT COALESCE(max(version),0)+1 version FROM transcript_versions WHERE lesson_id=$1',[asset.lesson_id]);
            await tx.query('INSERT INTO transcript_versions(id,lesson_id,media_id,version,language,source) VALUES($1,$2,$3,$4,$5,$6)',[transcript,asset.lesson_id,asset.id,version,raw.language,'faster-whisper-small']);
            for (let position=0;position<segments.length;position++) { const s=segments[position]; await tx.query('INSERT INTO segments(id,transcript_id,position,start_sec,end_sec,text) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),transcript,position,s.start_sec,s.end_sec,s.text]); }
            await tx.query('UPDATE lessons SET active_transcript_id=$2 WHERE id=$1',[asset.lesson_id,transcript]);
            await tx.query("INSERT INTO ai_tasks(id,media_id,transcript_id,stage,job_key) VALUES($1,$2,$3,'INDEX',$4) ON CONFLICT(job_key) DO NOTHING",[randomUUID(),asset.id,transcript,`${transcript}/index/${this.ai.EMBEDDING_MODEL_ID}`]);
          });
        } finally { const child=relative(root,directory); if(child.startsWith('asr-')&&!child.includes('..')) await rm(directory,{recursive:true,force:true}); }
      } else if (task.stage==='INDEX') {
        const [existing]=await this.db.query("SELECT id FROM index_versions WHERE id=$1 AND transcript_id=$2 AND model_id=$3 AND dimensions=$4 AND status='READY'",[asset.active_index_id,task.transcript_id,this.embedding.modelId,this.embedding.dimensions]);
        if(existing){await this.db.query("UPDATE ai_tasks SET status='READY',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2",[id,lease]);return;}
        const segments = await this.db.query('SELECT * FROM segments WHERE transcript_id=$1 ORDER BY position',[task.transcript_id]);
        const chunks = chunkSegments(segments); const vectors: number[][]=[];
        for (let offset=0;offset<chunks.length;offset+=4) vectors.push(...await this.embedding.embed(chunks.slice(offset,offset+4).map(c=>c.text)));
        await this.db.transaction(async tx=>{
          const [current] = await tx.query('SELECT * FROM lessons WHERE id=$1 FOR UPDATE',[asset.lesson_id]);
          const [guard] = await tx.query('SELECT lease_id FROM ai_tasks WHERE id=$1 FOR UPDATE',[id]);
          if (guard.lease_id!==lease || current.active_transcript_id!==task.transcript_id || current.active_media_id!==task.media_id) {await tx.query("UPDATE ai_tasks SET status='STALE',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2",[id,lease]);return;}
          const index = randomUUID();
          await tx.query("INSERT INTO index_versions(id,transcript_id,model_id,dimensions,status) VALUES($1,$2,$3,$4,'READY')",[index,task.transcript_id,this.embedding.modelId,this.embedding.dimensions]);
          for(let position=0;position<chunks.length;position++) { const c=chunks[position],chunk=randomUUID();
            await tx.query('INSERT INTO chunks(id,index_id,position,text,start_sec,end_sec,segment_ids) VALUES($1,$2,$3,$4,$5,$6,$7)',[chunk,index,position,c.text,c.start_sec,c.end_sec,c.segment_ids]);
            await tx.query('INSERT INTO embeddings(chunk_id,model_id,dimensions,values) VALUES($1,$2,$3,$4)',[chunk,this.embedding.modelId,this.embedding.dimensions,vectors[position]]);
          }
          if(current.active_index_id) await tx.query("UPDATE index_versions SET status='STALE' WHERE id=$1",[current.active_index_id]);
          await tx.query('UPDATE lessons SET active_index_id=$2 WHERE id=$1',[asset.lesson_id,index]);
          await tx.query("INSERT INTO ai_tasks(id,media_id,transcript_id,stage,job_key) VALUES($1,$2,$3,'SUMMARY',$4) ON CONFLICT(job_key) DO NOTHING",[randomUUID(),asset.id,task.transcript_id,`${index}/summary/${this.generation.modelId}/${GENERATION_PROMPT_VERSION}`]);
        });
      } else {
        const chunks = await this.db.query('SELECT id chunk_id,text,start_sec,end_sec FROM chunks WHERE index_id=$1 ORDER BY position',[asset.active_index_id]);
        const sections: {answer:string;citations:{chunk_id:string;start_sec:number;end_sec:number;excerpt:string}[]}[] = [];
        for(let offset=0;offset<chunks.length;offset+=4) {
          const group=chunks.slice(offset,offset+4); const result=await this.generation.generate('Tóm tắt các ý chính trong phần bài giảng này theo trình tự.',group,true);
          sections.push({answer:result.answer.answer,citations:group.filter((c:{chunk_id:string})=>result.answer.chunk_ids.includes(c.chunk_id)).map((c:{chunk_id:string;text:string;start_sec:number;end_sec:number})=>({chunk_id:c.chunk_id,start_sec:c.start_sec,end_sec:c.end_sec,excerpt:c.text.slice(0,600)}))});
        }
        const mapped=sections.filter(s=>s.citations.length).map(s=>({chunk_id:s.citations[0].chunk_id,text:s.answer}));
        if(mapped.length>1){
          const overview=await this.generation.generate('Tổng hợp các phần thành một tóm tắt toàn bài, tối đa 5 ý chính theo trình tự.',mapped,true);
          const sources=sections.filter(s=>overview.answer.chunk_ids.includes(s.citations[0]?.chunk_id)).flatMap(s=>s.citations);
          sections.unshift({answer:overview.answer.answer,citations:sources});
        }
        // Map các phần theo thứ tự rồi reduce; giữ nguồn gốc của từng phần.
        await this.db.transaction(async tx=>{
          const [current]=await tx.query('SELECT * FROM lessons WHERE id=$1 FOR UPDATE',[asset.lesson_id]);
          const [guard]=await tx.query('SELECT lease_id FROM ai_tasks WHERE id=$1 FOR UPDATE',[id]);
          if(guard.lease_id!==lease || current.active_index_id!==asset.active_index_id) {await tx.query("UPDATE ai_tasks SET status='STALE',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2",[id,lease]);return;}
          await tx.query("INSERT INTO summaries(id,transcript_id,index_id,model_id,prompt_version,status,content) VALUES($1,$2,$3,$4,$5,'READY',$6) ON CONFLICT(index_id,model_id,prompt_version) DO UPDATE SET status='READY',content=excluded.content",[randomUUID(),task.transcript_id,asset.active_index_id,this.generation.modelId,GENERATION_PROMPT_VERSION,JSON.stringify(sections)]);
        });
      }
      await this.db.query("UPDATE ai_tasks SET status='READY',lease_id=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2",[id,lease]);
    } catch {
      await this.db.query("UPDATE ai_tasks SET status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,lease_id=NULL,lease_until=NULL,error_code='AI_PROCESSING_ERROR',updated_at=now() WHERE id=$1 AND lease_id=$2",[id,lease]);
      throw new Error('AI_PROCESSING_ERROR');
    } finally {clearInterval(heartbeat);}
  }
  async close(){if(this.closing)return;this.closing=true;if(this.timer)clearInterval(this.timer);await this.polling;await this.worker?.close();await this.queue.close();this.storage.close();if(this.db.isInitialized)await this.db.destroy();}
}
