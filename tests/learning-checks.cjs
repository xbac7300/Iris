const {test}=require('node:test');
const {expect}=require('expect');
const {randomUUID}=require('node:crypto');
module.exports=function learningChecks(context){
  let owner,student,outsider,course,lesson,media,quiz;
  const auth=session=>`Bearer ${session.access_token}`;
  test('quiz: quyền, đề hợp lệ, không rò đáp án; khóa cấu trúc sau xuất bản',async()=>{
    const {db,api,register}=context();
    owner=await register('learning-owner@example.com');student=await register('learning-student@example.com');outsider=await register('learning-outsider@example.com');
    await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR')",[owner.user.id]);
    course=(await api.post('/api/v1/courses').set('Authorization',auth(owner)).send({title:'Khóa kiểm thử học tập',description:'Dữ liệu fixture biệt lập'}).expect(201)).body.id;
    const module=(await api.post(`/api/v1/courses/${course}/modules`).set('Authorization',auth(owner)).send({title:'Chương',position:0}).expect(201)).body.id;
    lesson=(await api.post(`/api/v1/modules/${module}/lessons`).set('Authorization',auth(owner)).send({title:'Bài học',position:0,required:true}).expect(201)).body.id;media=randomUUID();
    await db.query("INSERT INTO media_assets(id,lesson_id,uploader_id,upload_key,playback_key,expected_bytes,actual_bytes,duration_sec,status) VALUES($1,$2,$3,$4,$5,1,1,600,'READY')",[media,lesson,owner.user.id,`${media}/upload`,`${media}/playback`]);await db.query('UPDATE lessons SET active_media_id=$2 WHERE id=$1',[lesson,media]);
    const input={title:'Đề 10 câu',questions:Array.from({length:10},(_,i)=>({text:`Câu ${i+1}`,options:[{text:'Đúng',is_correct:true},{text:'Sai',is_correct:false}]}))};
    await api.post(`/api/v1/courses/${course}/quizzes`).set('Authorization',auth(student)).send(input).expect(403);
    await api.post(`/api/v1/courses/${course}/quizzes`).set('Authorization',auth(owner)).send({...input,questions:[]}).expect(422);
    await api.post(`/api/v1/courses/${course}/quizzes`).set('Authorization',auth(owner)).send({...input,questions:[{text:'Sai',options:[{text:'A',is_correct:true},{text:'B',is_correct:true}]}]}).expect(422);
    quiz=(await api.post(`/api/v1/courses/${course}/quizzes`).set('Authorization',auth(owner)).send(input).expect(201)).body;
    expect(JSON.stringify(quiz)).not.toContain('is_correct');
    await api.post(`/api/v1/courses/${course}/publish`).set('Authorization',auth(owner)).expect(200);
    await api.post(`/api/v1/courses/${course}/enrollments`).set('Authorization',auth(student)).expect(200);
    await api.post(`/api/v1/courses/${course}/quizzes`).set('Authorization',auth(owner)).send(input).expect(409);
    await api.get(`/api/v1/quizzes/${quiz.id}`).set('Authorization',auth(outsider)).expect(404);
  });
  test('quiz: tạo và submit đồng thời, 7/10=70%, payload conflict, giới hạn 3 lượt',async()=>{
    const {api}=context();
    const attempts=await Promise.all([0,1,2].map(()=>api.post(`/api/v1/quizzes/${quiz.id}/attempts`).set('Authorization',auth(student)).expect(201)));
    expect(new Set(attempts.map(a=>a.body.id)).size).toBe(1);const id=attempts[0].body.id;
    const answers=quiz.questions.map((q,i)=>({question_id:q.id,option_id:q.options[i<7?0:1].id}));
    await api.post(`/api/v1/attempts/${id}/submit`).set('Authorization',auth(student)).send({idempotency_key:randomUUID(),answers:[{question_id:quiz.questions[0].id,option_id:quiz.questions[1].options[0].id}]}).expect(422);
    const body={idempotency_key:randomUUID(),answers};
    const results=await Promise.all([0,1].map(()=>api.post(`/api/v1/attempts/${id}/submit`).set('Authorization',auth(student)).send(body).expect(200)));
    results.forEach(r=>expect(r.body).toMatchObject({score:70,passed:true,status:'SUBMITTED'}));
    await api.post(`/api/v1/attempts/${id}/submit`).set('Authorization',auth(student)).send({...body,answers:[]}).expect(409);
    await api.get(`/api/v1/attempts/${id}`).set('Authorization',auth(outsider)).expect(404);
    for(let i=0;i<2;i++){const a=(await api.post(`/api/v1/quizzes/${quiz.id}/attempts`).set('Authorization',auth(student)).expect(201)).body;await api.post(`/api/v1/attempts/${a.id}/submit`).set('Authorization',auth(student)).send({idempotency_key:randomUUID(),answers:[]}).expect(200);}
    await api.post(`/api/v1/quizzes/${quiz.id}/attempts`).set('Authorization',auth(student)).expect(409);
  });
  test('progress: overlap, retry, concurrent merge, stale checkpoint và account khác',async()=>{
    const {api}=context();
    const s1=(await api.post(`/api/v1/lessons/${lesson}/playback-sessions`).set('Authorization',auth(student)).expect(201)).body;
    const s2=(await api.post(`/api/v1/lessons/${lesson}/playback-sessions`).set('Authorization',auth(student)).expect(201)).body;
    const event=(s,start,end,sequence=0)=>({event_id:randomUUID(),session_id:s.session_id,media_version:media,sequence,start_sec:start,end_sec:end,playback_rate:1,elapsed_ms:(end-start)*1000});
    const e1=event(s1,0,120),e2=event(s2,60,180);
    const batch=(s,events,position=180)=>({...s,events,position_sec:position});
    const r1=await api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(student)).send(batch(s1,[e1],120)).expect(200);
    expect(r1.body.checkpoint_applied).toBe(false);
    const r2=await api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(student)).send(batch(s2,[e2])).expect(200);expect(r2.body.watched_ratio).toBeCloseTo(0.3);expect(r2.body.checkpoint_applied).toBe(true);
    const retry=await api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(student)).send(batch(s2,[e2])).expect(200);expect(retry.body.duplicate).toEqual([e2.event_id]);expect(retry.body.watched_ratio).toBe(0.3);expect(retry.body.checkpoint_applied).toBe(false);expect(retry.body.session_current).toBe(true);expect(r1.body.session_current).toBe(false);
    const results=await Promise.all([event(s2,180,240,1),event(s2,220,280,2)].map(e=>api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(student)).send(batch({...s2,resume_revision:r2.body.resume_revision},[e])).expect(200)));
    expect(Math.max(...results.map(r=>r.body.watched_ratio))).toBeCloseTo(280/600);
    await api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(outsider)).send(batch(s2,[e2])).expect(404);
    const invalid=await api.post(`/api/v1/lessons/${lesson}/watch-events`).set('Authorization',auth(student)).send(batch(s2,[{...event(s2,300,420,3),elapsed_ms:1000}])).expect(200);expect(invalid.body.rejected).toHaveLength(1);
    const state=(await api.post(`/api/v1/lessons/${lesson}/playback-sessions`).set('Authorization',auth(student)).expect(201)).body;expect(state.position_sec).toBe(180);
  });
  test('analytics theo cohort; transcript bất biến, quyền và compare-and-swap',async()=>{
    const {api}=context();
    await api.get(`/api/v1/courses/${course}/analytics`).set('Authorization',auth(student)).expect(404);
    const stats=(await api.get(`/api/v1/courses/${course}/analytics`).set('Authorization',auth(owner)).expect(200)).body;expect(stats).toMatchObject({enrolled:1,submitted:1,not_submitted:0,average_best_score:70,completed:0});
    const input={language:'vi',segments:[{start_sec:0,end_sec:30,text:'Nguồn bài học được kiểm thử.'}]};
    await api.post(`/api/v1/lessons/${lesson}/transcript-versions`).set('Authorization',auth(student)).send(input).expect(403);
    const t=(await api.post(`/api/v1/lessons/${lesson}/transcript-versions`).set('Authorization',auth(owner)).send(input).expect(201)).body;
    await api.post(`/api/v1/lessons/${lesson}/transcript-versions`).set('Authorization',auth(owner)).send(input).expect(409);
    const t2=(await api.post(`/api/v1/lessons/${lesson}/transcript-versions`).set('Authorization',auth(owner)).send({...input,expected_transcript_id:t.id}).expect(201)).body;expect(t2.version).toBe(t.version+1);
    await api.get(`/api/v1/lessons/${lesson}/transcript`).set('Authorization',auth(outsider)).expect(404);
    const progress=(await api.get(`/api/v1/me/courses/${course}/progress`).set('Authorization',auth(student)).expect(200)).body;expect(progress).toMatchObject({required_count:2,completed_count:1,complete:false});expect(progress.lessons[0].watched_ratio).toBeCloseTo(280/600);
  });
  test('quản lý vòng đời khóa học: ngưng xuất bản (archive), xuất bản lại, và xóa khóa học', async () => {
    const { api } = context();
    // 1. Giảng viên ngưng xuất bản (archive) khóa học đang PUBLISHED
    const archived = (await api.post(`/api/v1/courses/${course}/archive`).set('Authorization', auth(owner)).expect(200)).body;
    expect(archived.status).toBe('ARCHIVED');

    // Khóa học ARCHIVED không cho học viên mới đăng ký
    await api.post(`/api/v1/courses/${course}/enrollments`).set('Authorization', auth(outsider)).expect(404);

    // Học viên đã đăng ký trước đó vẫn xem được
    await api.get(`/api/v1/courses/${course}`).set('Authorization', auth(student)).expect(200);

    // 2. Xuất bản lại khóa học
    const republished = (await api.post(`/api/v1/courses/${course}/publish`).set('Authorization', auth(owner)).expect(200)).body;
    expect(republished.status).toBe('PUBLISHED');

    // 3. Xóa khóa học: người ngoài hoặc học viên không được xóa
    await api.delete(`/api/v1/courses/${course}`).set('Authorization', auth(student)).expect(403);
    await api.delete(`/api/v1/courses/${course}`).set('Authorization', auth(outsider)).expect(403);

    // Giảng viên sở hữu xóa khóa học thành công
    const deleted = (await api.delete(`/api/v1/courses/${course}`).set('Authorization', auth(owner)).expect(200)).body;
    expect(deleted.success).toBe(true);

    // Khóa học không còn tồn tại
    await api.get(`/api/v1/courses/${course}`).set('Authorization', auth(owner)).expect(404);
  });
  test('đánh giá khóa học, số sao, tim (likes), nhận xét (comments)', async () => {
    const { db, api, register } = context();
    const inst = await register('rating-owner@example.com');
    const stu1 = await register('rating-stu1@example.com');
    const stu2 = await register('rating-stu2@example.com');
    await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR')", [inst.user.id]);

    const cId = (await api.post('/api/v1/courses').set('Authorization', auth(inst)).send({ title: 'Khóa học Đánh giá', description: 'Test ratings' }).expect(201)).body.id;
    const modId = (await api.post(`/api/v1/courses/${cId}/modules`).set('Authorization', auth(inst)).send({ title: 'Chương 1', position: 0 }).expect(201)).body.id;
    const lesId = (await api.post(`/api/v1/modules/${modId}/lessons`).set('Authorization', auth(inst)).send({ title: 'Bài 1', position: 0, required: true }).expect(201)).body.id;
    const medId = randomUUID();
    await db.query("INSERT INTO media_assets(id,lesson_id,uploader_id,upload_key,playback_key,expected_bytes,actual_bytes,duration_sec,status) VALUES($1,$2,$3,$4,$5,1,1,600,'READY')", [medId, lesId, inst.user.id, `${medId}/up`, `${medId}/play`]);
    await db.query('UPDATE lessons SET active_media_id=$2 WHERE id=$1', [lesId, medId]);
    await api.post(`/api/v1/courses/${cId}/publish`).set('Authorization', auth(inst)).expect(200);

    // Initial feedback check
    const initialFb = (await api.get(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(initialFb.avg_rating).toBe(0);
    expect(initialFb.total_reviews).toBe(0);
    expect(initialFb.total_likes).toBe(0);
    expect(initialFb.user_liked).toBe(false);

    // Toggle like
    const likeRes = (await api.post(`/api/v1/courses/${cId}/like`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(likeRes.liked).toBe(true);
    expect(likeRes.total_likes).toBe(1);

    // stu2 also likes
    await api.post(`/api/v1/courses/${cId}/like`).set('Authorization', auth(stu2)).expect(200);

    // stu1 toggles like again (unlikes)
    const unlikeRes = (await api.post(`/api/v1/courses/${cId}/like`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(unlikeRes.liked).toBe(false);
    expect(unlikeRes.total_likes).toBe(1);

    // stu1 submits 5 star review with comment
    const rev1 = (await api.post(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).send({ rating: 5, comment: 'Khóa học tuyệt vời!' }).expect(201)).body;
    expect(rev1.rating).toBe(5);
    expect(rev1.comment).toBe('Khóa học tuyệt vời!');

    // stu2 submits 3 star review
    await api.post(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu2)).send({ rating: 3, comment: 'Bài giảng ổn' }).expect(201);

    // Check course feedback summary: avg_rating should be (5+3)/2 = 4.0
    const summary = (await api.get(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(summary.avg_rating).toBe(4);
    expect(summary.total_reviews).toBe(2);
    expect(summary.reviews).toHaveLength(2);
    expect(summary.user_review.rating).toBe(5);

    // Check course listing returns avg_rating, review_count, like_count
    const list = (await api.get('/api/v1/courses').set('Authorization', auth(stu1)).expect(200)).body;
    const found = list.find(c => c.id === cId);
    expect(found.avg_rating).toBe(4);
    expect(found.review_count).toBe(2);
    expect(found.like_count).toBe(1);

    // stu1 updates their review to 4 stars
    await api.post(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).send({ rating: 4, comment: 'Cập nhật lại nhận xét' }).expect(201);
    const updatedSummary = (await api.get(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(updatedSummary.avg_rating).toBe(3.5);
    expect(updatedSummary.total_reviews).toBe(2);

    // Instructor (owner) is forbidden from reviewing own course
    await api.post(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(inst)).send({ rating: 5, comment: 'Tự đánh giá' }).expect(403);

    // stu1 deletes their review
    await api.delete(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).expect(200);
    const afterDelete = (await api.get(`/api/v1/courses/${cId}/feedback`).set('Authorization', auth(stu1)).expect(200)).body;
    expect(afterDelete.total_reviews).toBe(1);
    expect(afterDelete.avg_rating).toBe(3);

    // Test course tags creation, default tag, and update
    const taggedCourse = (await api.post('/api/v1/courses').set('Authorization', auth(inst)).send({
      title: 'Khóa học Thiết kế đồ họa',
      tag: 'Thiết kế',
    }).expect(201)).body;
    expect(taggedCourse.tag).toBe('Thiết kế');

    const updatedTagged = (await api.patch(`/api/v1/courses/${taggedCourse.id}`).set('Authorization', auth(inst)).send({
      tag: 'Marketing',
    }).expect(200)).body;
    expect(updatedTagged.tag).toBe('Marketing');

    const defaultTagCourse = (await api.post('/api/v1/courses').set('Authorization', auth(inst)).send({
      title: 'Khóa học không có tag',
    }).expect(201)).body;
    expect(defaultTagCourse.tag).toBe('CNTT & Phần mềm');

    // Test updating title, description and tag by instructor
    const updatedFull = (await api.patch(`/api/v1/courses/${taggedCourse.id}`).set('Authorization', auth(inst)).send({
      title: 'Khóa học Thiết kế đồ họa nâng cao',
      description: 'Mô tả chi tiết khóa học đã được cập nhật',
      tag: 'Phát triển cá nhân',
    }).expect(200)).body;
    expect(updatedFull.title).toBe('Khóa học Thiết kế đồ họa nâng cao');
    expect(updatedFull.description).toBe('Mô tả chi tiết khóa học đã được cập nhật');
    expect(updatedFull.tag).toBe('Phát triển cá nhân');

    // Student cannot update course
    await api.patch(`/api/v1/courses/${taggedCourse.id}`).set('Authorization', auth(stu1)).send({
      title: 'Học viên cố tình sửa',
    }).expect(403);
  });
  test('chỉnh sửa chi tiết: thêm/xóa chương, bài học, bài kiểm tra và lên lịch thao tác (publish/archive/delete/cancel)', async () => {
    const { api, register, db } = context();
    const inst = await register('editor-inst@example.com');
    const stu = await register('editor-stu@example.com');
    await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'INSTRUCTOR')",[inst.user.id]);

    // 1. Tạo khóa học nháp
    const c = (await api.post('/api/v1/courses').set('Authorization', auth(inst)).send({
      title: 'Khóa học chỉnh sửa toàn diện',
      description: 'Test thêm xóa chương, bài học, bài kiểm tra',
      tag: 'CNTT & Phần mềm',
    }).expect(201)).body;

    // 2. Thêm chương (module)
    const m1 = (await api.post(`/api/v1/courses/${c.id}/modules`).set('Authorization', auth(inst)).send({
      title: 'Chương 1: Mở đầu',
      position: 0,
    }).expect(201)).body;

    const m2 = (await api.post(`/api/v1/courses/${c.id}/modules`).set('Authorization', auth(inst)).send({
      title: 'Chương 2: Kiến thức trọng tâm',
      position: 1,
    }).expect(201)).body;

    // 3. Thêm bài học vào m1
    const l1 = (await api.post(`/api/v1/modules/${m1.id}/lessons`).set('Authorization', auth(inst)).send({
      title: 'Bài 1.1: Giới thiệu',
      position: 0,
      required: true,
    }).expect(201)).body;

    const l2 = (await api.post(`/api/v1/modules/${m1.id}/lessons`).set('Authorization', auth(inst)).send({
      title: 'Bài 1.2: Cài đặt môi trường',
      position: 1,
      required: false,
    }).expect(201)).body;

    const mAsset = randomUUID();
    await db.query("INSERT INTO media_assets(id,lesson_id,uploader_id,upload_key,playback_key,expected_bytes,actual_bytes,duration_sec,status) VALUES($1,$2,$3,$4,$5,1,1,600,'READY')",[mAsset,l1.id,inst.user.id,`${mAsset}/upload`,`${mAsset}/playback`]);
    await db.query('UPDATE lessons SET active_media_id=$2 WHERE id=$1',[l1.id,mAsset]);

    // 4. Thêm bài kiểm tra
    const q1 = (await api.post(`/api/v1/courses/${c.id}/quizzes`).set('Authorization', auth(inst)).send({
      title: 'Bài kiểm tra chương 1',
      questions: [{ text: 'Câu 1', options: [{ text: 'A', is_correct: true }, { text: 'B', is_correct: false }] }],
      required: true,
      pass_threshold: 70,
      max_attempts: 3,
    }).expect(201)).body;

    // 5. Xóa bài học l2
    // Học viên không thể xóa
    await api.delete(`/api/v1/lessons/${l2.id}`).set('Authorization', auth(stu)).expect(403);
    // Giảng viên xóa
    await api.delete(`/api/v1/lessons/${l2.id}`).set('Authorization', auth(inst)).expect(200);
    const lessonsAfter = (await api.get(`/api/v1/courses/${c.id}/lessons`).set('Authorization', auth(inst)).expect(200)).body;
    expect(lessonsAfter.map(l => l.id)).not.toContain(l2.id);
    expect(lessonsAfter.map(l => l.id)).toContain(l1.id);

    // 6. Xóa bài kiểm tra q1
    // Học viên không thể xóa
    await api.delete(`/api/v1/quizzes/${q1.id}`).set('Authorization', auth(stu)).expect(403);
    // Giảng viên xóa
    await api.delete(`/api/v1/quizzes/${q1.id}`).set('Authorization', auth(inst)).expect(200);
    const quizzesAfter = (await api.get(`/api/v1/courses/${c.id}/quizzes`).set('Authorization', auth(inst)).expect(200)).body;
    expect(quizzesAfter.map(q => q.id)).not.toContain(q1.id);

    // 7. Xóa chương m2
    // Học viên không thể xóa
    await api.delete(`/api/v1/modules/${m2.id}`).set('Authorization', auth(stu)).expect(403);
    // Giảng viên xóa
    await api.delete(`/api/v1/modules/${m2.id}`).set('Authorization', auth(inst)).expect(200);
    const modulesAfter = (await api.get(`/api/v1/courses/${c.id}/modules`).set('Authorization', auth(inst)).expect(200)).body;
    expect(modulesAfter.map(m => m.id)).not.toContain(m2.id);
    expect(modulesAfter.map(m => m.id)).toContain(m1.id);

    // 8. Lên lịch thao tác: PUBLISH trong tương lai
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString();
    const scheduledPublish = (await api.post(`/api/v1/courses/${c.id}/publish`).set('Authorization', auth(inst)).send({
      scheduled_at: futureDate,
    }).expect(200)).body;
    expect(scheduledPublish.scheduled_action).toBe('PUBLISH');
    expect(scheduledPublish.scheduled_at).toBeTruthy();
    expect(scheduledPublish.status).toBe('DRAFT'); // chưa publish ngay

    // Hủy lịch hẹn
    const cancelled = (await api.post(`/api/v1/courses/${c.id}/cancel-schedule`).set('Authorization', auth(inst)).expect(200)).body;
    expect(cancelled.scheduled_action).toBeNull();
    expect(cancelled.scheduled_at).toBeNull();

    // 9. Lên lịch thao tác: DELETE trong tương lai
    const scheduledDelete = (await api.delete(`/api/v1/courses/${c.id}`).set('Authorization', auth(inst)).send({
      scheduled_at: futureDate,
    }).expect(200)).body;
    expect(scheduledDelete.scheduled).toBe(true);

    const checkScheduledCourse = (await api.get(`/api/v1/courses/${c.id}`).set('Authorization', auth(inst)).expect(200)).body;
    expect(checkScheduledCourse.scheduled_action).toBe('DELETE');

    // Hủy lịch xóa
    await api.post(`/api/v1/courses/${c.id}/cancel-schedule`).set('Authorization', auth(inst)).expect(200);

    // 10. Xóa vĩnh viễn ngay lập tức
    await api.delete(`/api/v1/courses/${c.id}`).set('Authorization', auth(inst)).expect(200);
    await api.get(`/api/v1/courses/${c.id}`).set('Authorization', auth(inst)).expect(404);
  });
};
