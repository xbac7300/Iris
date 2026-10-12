export function mergeIntervals(intervals: number[][], duration: number): number[][] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Thời lượng không hợp lệ.');
  const sorted = intervals.filter(pair => pair.length === 2 && pair.every(Number.isFinite))
    .map(([start,end]) => [Math.max(0,start),Math.min(duration,end)]).filter(([start,end]) => end>start).sort((a,b)=>a[0]-b[0]);
  const result: number[][]=[];
  for (const pair of sorted) { const last=result.at(-1); if(last && pair[0]<=last[1]) last[1]=Math.max(last[1],pair[1]); else result.push([...pair]); }
  return result;
}
export function grade(correct: number, count: number, threshold: number) {
  if(!Number.isInteger(count)||count<=0||!Number.isInteger(correct)||correct<0||correct>count||!Number.isFinite(threshold)||threshold<0||threshold>100) throw new Error('Dữ liệu chấm điểm không hợp lệ.');
  return {correct_count:correct,question_count:count,score:100*correct/count,passed:10000*correct>=Math.round(threshold*100)*count};
}
export function validWatch(event: {start_sec:number;end_sec:number;playback_rate:number;elapsed_ms:number},duration:number) {
  const {start_sec:start,end_sec:end,playback_rate:rate,elapsed_ms:elapsed}=event;
  return [start,end,rate,elapsed,duration].every(Number.isFinite)&&duration>0&&start>=0&&end>start&&end<=duration+0.05&&rate>=0.25&&rate<=2&&elapsed>0&&elapsed<=120000&&Math.abs((end-start)-elapsed/1000*rate)<=Math.max(1,elapsed/1000*rate*0.15);
}
