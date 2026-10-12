# ADR 0001 Nền tảng và giới hạn kiểm chứng

Ngày quyết định: 22/09/2026. Trạng thái: chấp nhận cho nền tảng, chưa nghiệm thu M0/M1 toàn bộ.

## Stack và pin

Khảo sát thấy chỉ có AGENTS.md và Word. Giữ stack yêu cầu: Next.js/TypeScript, Expo/React Native, NestJS, TypeORM/PostgreSQL/pgvector, BullMQ/Redis. Phiên bản lấy trực tiếp npm registry và metadata `expo/bundledNativeModules.json`, không gán từ trí nhớ. Exact versions trong package.json, dependency gián tiếp trong pnpm-lock.yaml.

Node 24.15.0, pnpm 10.34.5, TypeScript 5.9.3, Next 16.3.5, NestJS 12.0.4, TypeORM 0.3.31, Expo 57.0.24, React 19.2.3, React Native 0.86.3. Giữ TypeScript 5 để tương thích ts-jest (<7), TypeORM 0.3 để ổn định DataSource/migration API. Expo kiểm soát các phiên bản React/native/Router/video/SecureStore; bật strict peer dependency.

## Storage

Chọn SeaweedFS 4.47 làm S3 local, dựa trên [release 4.47](https://github.com/seaweedfs/seaweedfs/releases/tag/4.47), [mã nguồn server của tag](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/command/server.go) và [tài liệu upstream](https://github.com/seaweedfs/seaweedfs). License Apache-2.0. Image khóa tag và digest; config có identity, không anonymous; chỉ publish S3 lên loopback. Không dùng bucket cloud trả phí mặc định. Tài khoản local có quyền bootstrap storage, chưa là thiết kế IAM production.

Compose dùng pgvector 0.8.6 trên PostgreSQL 18 và Redis 8.8.3. Tag/digest xác minh qua Docker Hub API ngày khảo sát. Init SQL tạo extension vector ở volume mới. Docker chưa có nên **chưa xác nhận Compose, private access hoặc HTTP Range hoạt động**. M2 cần test unauthenticated denial, bucket, presigned URL/TTL/Range và quyền bị thu hồi.

## Kiểm thử khi không có Docker

Dùng `embedded-postgres` 18.4.0-beta.17 để chạy PostgreSQL native thật, chỉ cho test trong `.local`. Không thay DB sản phẩm bằng SQLite/in-memory. Kiểm thử này chứng minh SQL, constraint, transaction và refresh lock; không chứng minh pgvector hoặc storage. Test DB không tự xóa để tránh thao tác xóa hàng loạt; người dùng có thể dọn các thư mục test khi đã dừng tiến trình.

Jest dùng cho unit TypeScript. NestJS 12 là ESM; runner integration ban đầu không nạp được trong Jest, nên integration HTTP dùng Node test runner + Supertest. Runner truyền đúng exit code sau cleanup vì hook của embedded-postgres mặc định có thể ghi đè mã lỗi. Playwright CDN timeout; E2E local dùng Chrome đã cài, profile kiểm thử riêng.

## AI và tính khoa học

Chưa chọn model embedding/generation và chưa có dữ liệu video có license trong thư mục. Chỉ tạo interface provider, parser transcript và CLI faster-whisper nhận model cục bộ. Không phát sinh request AI trả phí hoặc dựng số liệu RAG. Pipeline ứng dụng retrieval rồi generation chưa được triển khai; không tuyên bố tái hiện huấn luyện trong paper RAG.

Tài liệu đã đối chiếu: [Expo Video SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/video/), [Expo SecureStore SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/), [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [TypeORM migrations](https://typeorm.io/docs/migrations/setup/), [pgvector](https://github.com/pgvector/pgvector), [faster-whisper](https://github.com/SYSTRAN/faster-whisper). API cụ thể được kiểm tra thêm bằng typecheck và build với gói đã khóa.
