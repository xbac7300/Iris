import { SessionClient } from './session';
import type { components } from './schema';
type WatchEvent=components['schemas']['WatchEventDto'];
type PlaybackSession=components['schemas']['PlaybackSessionDto'];
export class ProgressTracker {
  private playback:PlaybackSession|null=null;
  private queue:WatchEvent[]=[];
  private rejected=new Set<string>();
  private previous:{position:number;time:number;rate:number}|null=null;
  private position=0;
  private sequence=0;
  private busy=false;
  private active=true;
  private userId:string|null;
  private unsubscribe:()=>void;
  constructor(private readonly client:SessionClient,private readonly lessonId:string,private readonly uuid:()=>string,private readonly report:(message:string)=>void=()=>{}) {
    this.userId=client.user?.id??null;this.unsubscribe=client.onClear(()=>{this.active=false;this.queue=[];this.previous=null;this.playback=null;});
  }
  async start() {const {data,error}=await this.client.api.POST('/api/v1/lessons/{id}/playback-sessions',{params:{path:{id:this.lessonId}}});if(!data)throw new Error(error?.message??'Chưa mở được phiên học.');if(!this.active)return 0;this.playback=data;this.position=data.position_sec;return data.position_sec;}
  sample(position:number,playing:boolean,rate:number,now:number) {
    if(!this.active||this.client.user?.id!==this.userId||!this.playback)return;
    this.position=position;
    const previous=this.previous;
    if(playing&&previous&&previous.rate===rate){const elapsed=now-previous.time,delta=position-previous.position;
      // Seek, buffering hoặc nhảy đồng hồ không được chuyển thành khoảng đã xem.
      if(elapsed>=100&&elapsed<=15000&&delta>0&&Math.abs(delta-elapsed/1000*rate)<=Math.max(0.5,elapsed/1000*rate*0.1)&&this.queue.length<500){this.queue.push({event_id:this.uuid(),session_id:this.playback.session_id,media_version:this.playback.media_version,sequence:this.sequence++,start_sec:previous.position,end_sec:position,playback_rate:rate,elapsed_ms:elapsed});}
    }
    this.previous=playing?{position,time:now,rate}:null;
  }
  reset(){this.previous=null;}
  async flush() {
    if(!this.active||this.busy||!this.playback||this.client.user?.id!==this.userId)return;
    this.busy=true;
    try {
      const {data,error}=await this.client.api.POST('/api/v1/lessons/{id}/watch-events',{params:{path:{id:this.lessonId}},body:{...this.playback,position_sec:this.position,events:this.queue.filter(e=>!this.rejected.has(e.event_id)).slice(0,100)}});
      if(!data)throw new Error(error?.message??'Chưa đồng bộ được tiến độ.');if(!this.active)return;
      const acknowledged=new Set([...data.accepted,...data.duplicate]);this.queue=this.queue.filter(e=>!acknowledged.has(e.event_id));
      data.rejected.forEach(e=>this.rejected.add(e.event_id));
      // Phiên cũ không được lấy revision mới để ghi đè thiết bị vừa mở sau nó.
      if(data.session_current)this.playback.resume_revision=data.resume_revision;
      this.report(data.rejected.length?'Một số khoảng xem không hợp lệ.':`Đã lưu ${Math.round(data.watched_ratio*100)}% bài học${data.checkpoint_applied?'':' · Vị trí tiếp tục do phiên mới hơn quản lý'}`);
    }catch{if(this.active)this.report('Đang giữ tiến độ trong phiên này, sẽ thử đồng bộ khi có mạng.');}
    finally{this.busy=false;}
  }
  close(){this.active=false;this.previous=null;this.queue=[];this.unsubscribe();}
}
