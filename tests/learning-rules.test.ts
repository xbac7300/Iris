import { grade, mergeIntervals, validWatch } from '../apps/api/src/learning/rules';
describe('bất biến học tập',()=>{
  test('7/10 đạt 70, điểm chưa làm tròn quyết định kết quả',()=>{expect(grade(7,10,70)).toMatchObject({score:70,passed:true});expect(grade(2,3,66.67).passed).toBe(false);expect(()=>grade(0,0,70)).toThrow();});
  test('hợp khoảng không tính overlap, clip biên và bỏ khoảng sai',()=>{const result=mergeIntervals([[0,120],[60,180],[60,180],[-5,10],[700,800]],600);expect(result).toEqual([[0,180]]);expect(result.reduce((n,[a,b])=>n+b-a,0)/600).toBe(0.3);});
  test('seek và tốc độ bất hợp lệ không tạo tiến độ',()=>{expect(validWatch({start_sec:0,end_sec:120,playback_rate:1,elapsed_ms:120000},600)).toBe(true);expect(validWatch({start_sec:0,end_sec:120,playback_rate:1,elapsed_ms:1000},600)).toBe(false);expect(validWatch({start_sec:0,end_sec:60,playback_rate:2,elapsed_ms:30000},600)).toBe(true);expect(validWatch({start_sec:590,end_sec:620,playback_rate:1,elapsed_ms:30000},600)).toBe(false);});
});
