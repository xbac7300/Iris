import {readFile} from 'node:fs/promises';
const {course_id}=JSON.parse(await readFile('.local/demo-media.json','utf8'));
const call=async(path,body,token)=>{const r=await fetch(`http://localhost:4000/api/v1/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok)throw new Error(`${r.status} ${result.message}`);return result;};
const login=email=>call('auth/login',{email,password:process.env.SEED_PASSWORD,client_type:'mobile'});
const owner=await login('instructor@lms.example');const token=owner.access_token;
const course=await call(`courses/${course_id}`,null,token);
if(course.status==='DRAFT'){
  const quizzes=await call(`courses/${course_id}/quizzes`,null,token);
  if(!quizzes.length)await call(`courses/${course_id}/quizzes`,{title:'Ôn tập Course Overview (bài thử chức năng)',required:true,pass_threshold:70,max_attempts:3,questions:[{text:'Video giới thiệu khóa học thuộc nền tảng cloud nào?',options:[{text:'Amazon Web Services (AWS)',is_correct:true},{text:'Một khóa học không liên quan cloud',is_correct:false}]},{text:'Nội dung khóa học đề cập đến lĩnh vực AI nào?',options:[{text:'Generative AI (AI tạo sinh)',is_correct:true},{text:'Chỉ lập trình giao diện HTML',is_correct:false}]}]},token);
  await call(`courses/${course_id}/publish`,{},token);
}
const student=await login('student@lms.example');await call(`courses/${course_id}/enrollments`,{},student.access_token);
console.log('Khóa demo local đã mở cho tài khoản học viên seed, có video thật và quiz thử chức năng.');
