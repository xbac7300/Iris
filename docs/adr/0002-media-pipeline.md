# ADR 0002: media bất biến và xử lý ngoài API

Ngày: 22/09/2026. Phạm vi: backend M2, chưa nghiệm thu UI hai client hoặc APK.

## Quyết định

- Mỗi course ID là một phiên bản cấu trúc. Chỉ DRAFT được thêm chương/bài/thay media; PUBLISHED và ARCHIVED luôn khóa cấu trúc. Enrollment ghi thêm thời điểm đóng băng. Thay nội dung cần course mới; chức năng sao chép phiên bản chưa triển khai.
- API cấp URL PUT 15 phút cho object UUID; HEAD xác minh dung lượng/Content-Type/ETag khi complete. Transaction ghi media, job, outbox; complete lặp lại trả cùng job ID. Quota hiện 20 bản upload và 2 GiB khai báo trong 24 giờ/người.
- Worker Node/BullMQ chạy concurrency=1; initial attempt và tối đa 3 retry, exponential backoff. File hỏng là lỗi cố định. Manual retry chỉ dành cho lỗi tạm thời, tối đa 3 generation, có audit.
- Outbox poll 2 giây; reconcile DB phục hồi job bị mất khỏi Redis. Lease DB và generation chặn lần chạy cũ công bố kết quả. Không giả định exactly-once.
- Worker GET nguồn với If-Match, tải vào thư mục UUID, kiểm tra byte thực và giải mã toàn bộ video. PUT kết quả sang key riêng theo media ID/lease; URL upload không thể ghi đè object dùng playback. Worker không thay lesson.active_media_id. Nếu mất phản hồi COMMIT, kiểm tra DB trước khi dọn object; khi DB không truy cập được giữ object để tránh mất media đã chốt.
- Dùng FFmpeg qua PyAV 18.1.0, argv cố định và execFile(shell=false), không cần ffmpeg.exe riêng cho bước này. Giới hạn bổ sung ở giai đoạn local: tối đa 1920×1080, một stream H.264 và một stream AAC, 500 MiB, 60 phút. Parser chỉ nhận file local. Timeout 300 giây; decoder dùng 2 thread video/1 thread audio. Linux có RLIMIT_AS 1,5 GiB và CPU 240 giây; Windows chưa có giới hạn RAM cứng cho subprocess, cần Job Object/container trước vận hành dữ liệu không tin cậy lâu dài.
- Playback GET ký 5 phút, hỗ trợ Range; kiểm tra quyền trước và sau khi ký. Thu hồi enrollment chặn URL mới, URL đã cấp còn hiệu lực tối đa TTL. Media READY trả ai_status=NOT_STARTED: ASR/RAG chưa tích hợp worker.
- AWS SDK v3 mặc định tự tính checksum upload. Presigned PUT chưa biết body nên dùng requestChecksumCalculation=WHEN_REQUIRED để tránh ký checksum của body rỗng. Worker vẫn xác minh ETag, số byte, codec và decode trước khi công bố.

## Giới hạn còn lại

Chưa có browser CORS/upload UI, PATCH lesson, endpoint thu hồi enrollment, upload cancel, retention/cleanup upload bị bỏ dở, recovery test kill tiến trình giữa COMMIT, hard delete hoặc migration rollback tự động. Không xóa volume/database người dùng. Test restart hiện là đóng worker có trật tự và phục hồi outbox; không thay cho thử crash mọi điểm.

## Tài liệu đã đối chiếu

- [BullMQ retry và backoff](https://docs.bullmq.io/guide/retrying-failing-jobs).
- [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids).
- [AWS SDK v3 checksum](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).
- [S3 presigner chính thức](https://github.com/aws/aws-sdk-js-v3/blob/main/packages/s3-request-presigner/README.md).
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Model thử local: Systran/faster-whisper-small, revision `536b0662742c02347bc0e980a01041f333bce120`; chưa là quyết định model cuối cho đánh giá tiếng Việt.
