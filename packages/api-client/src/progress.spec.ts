import { ProgressTracker } from './progress';
import { SessionClient } from './session';
function fixture(){
  let clear=()=>{};const bodies:Record<string,unknown>[]=[];let online=true;let revision=1;
  const post=jest.fn(async(path:string,input:{body?:Record<string,unknown>})=>{
    if(path.endsWith('playback-sessions'))return {data:{session_id:'session',media_version:'media',resume_revision:1,position_sec:0}};
    bodies.push(input.body!);if(!online)throw new Error('offline');
    return {data:{accepted:(input.body!.events as {event_id:string}[]).map(e=>e.event_id),duplicate:[],rejected:[],checkpoint_applied:input.body!.resume_revision===revision,session_current:true,resume_revision:++revision,watched_ratio:0.2}};
  });
  const client={user:{id:'first'},api:{POST:post},onClear:(listener:()=>void)=>{clear=listener;return()=>{};}};
  let id=0;const tracker=new ProgressTracker(client as unknown as SessionClient,'lesson',()=>String(++id));
  return {tracker,client,bodies,post,setOnline:(value:boolean)=>{online=value;},clear:()=>clear()};
}
test('seek không thành watched interval, gửi lại sau offline chỉ giữ khoảng phát thật',async()=>{
  const f=fixture();await f.tracker.start();f.tracker.sample(0,true,1,0);f.tracker.sample(1,true,1,1000);f.tracker.sample(300,true,1,2000);f.tracker.sample(301,true,1,3000);
  f.setOnline(false);await f.tracker.flush();expect(f.bodies[0].events).toEqual([expect.objectContaining({start_sec:0,end_sec:1}),expect.objectContaining({start_sec:300,end_sec:301})]);
  f.setOnline(true);await f.tracker.flush();expect(f.bodies[1].events).toEqual(f.bodies[0].events);await f.tracker.flush();expect(f.bodies[2].events).toEqual([]);f.tracker.close();
});
test('logout xóa queue, tracker tài khoản trước không gửi dưới tài khoản mới',async()=>{
  const f=fixture();await f.tracker.start();f.tracker.sample(0,true,1,0);f.tracker.sample(1,true,1,1000);f.clear();f.client.user.id='second';await f.tracker.flush();expect(f.post).toHaveBeenCalledTimes(1);
});
test('tốc độ 2x hợp lệ, buffering không tạo khoảng và revision được theo ACK',async()=>{
  const f=fixture();await f.tracker.start();f.tracker.sample(0,true,2,0);f.tracker.sample(2,true,2,1000);f.tracker.sample(2,false,2,2000);f.tracker.sample(10,true,2,5000);f.tracker.sample(12,true,2,6000);await f.tracker.flush();expect(f.bodies[0].events).toHaveLength(2);await f.tracker.flush();expect(f.bodies[1].resume_revision).toBe(2);f.tracker.close();
});
