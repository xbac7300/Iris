import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand,
  GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function main() {
  const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  assert(S3_ENDPOINT && S3_BUCKET && S3_REGION && S3_ACCESS_KEY && S3_SECRET_KEY, 'Thiếu cấu hình S3 local.');
  const endpoint = new URL(S3_ENDPOINT);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Smoke check chỉ chạy trên storage local.');
  const client = new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY }, maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 } });
  const Key = `checks/${randomUUID()}.txt`;
  const object = { Bucket: S3_BUCKET, Key };
  const body = Buffer.from('topic16-private-storage-check');
  let uploaded = false;
  const fetchLocal = (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
  try {
    try { await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
    catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
      await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
    }
    await client.send(new PutObjectCommand({ ...object, Body: body, ContentType: 'text/plain' }));
    uploaded = true;
    console.log('PASS: bucket và upload có xác thực.');

    const plainUrl = `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/${Key}`;
    const anonymous = await fetchLocal(plainUrl);
    await anonymous.arrayBuffer();
    assert.equal(anonymous.status, 403, 'Object phải từ chối anonymous GET.');
    const list = await fetchLocal(`${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}?list-type=2`);
    await list.arrayBuffer();
    assert.equal(list.status, 403, 'Bucket phải từ chối anonymous LIST.');
    console.log('PASS: anonymous GET/LIST bị chặn (403).');

    const signedUrl = await getSignedUrl(client, new GetObjectCommand(object), { expiresIn: 300 });
    const full = await fetchLocal(signedUrl);
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), body);
    const range = await fetchLocal(signedUrl, { headers: { Range: 'bytes=0-6' } });
    assert.equal(range.status, 206, 'Storage phải hỗ trợ HTTP Range.');
    assert.equal(range.headers.get('content-range'), `bytes 0-6/${body.length}`);
    assert.equal(await range.text(), 'topic16');
    console.log('PASS: presigned GET và HTTP Range (206).');

    const expiredUrl = await getSignedUrl(client, new GetObjectCommand(object), {
      expiresIn: 1, signingDate: new Date(Date.now() - 60000),
    });
    const expired = await fetchLocal(expiredUrl);
    await expired.arrayBuffer();
    assert.equal(expired.status, 403, 'URL hết hạn phải bị từ chối.');
    const tamperedUrl = new URL(signedUrl);
    tamperedUrl.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    const tampered = await fetchLocal(tamperedUrl);
    await tampered.arrayBuffer();
    assert.equal(tampered.status, 403, 'Chữ ký bị sửa phải bị từ chối.');
    console.log('PASS: URL hết hạn và chữ ký sai bị chặn (403).');
  } finally {
    // Chỉ xóa đúng object test UUID do lần chạy này tạo, giữ nguyên bucket và dữ liệu khác.
    try { if (uploaded) await client.send(new DeleteObjectCommand(object)); }
    finally { client.destroy(); }
  }
}

void main().catch(error => {
  // Không in exception đầy đủ vì có thể chứa request và thông tin xác thực.
  console.error(`Storage check thất bại: ${error instanceof assert.AssertionError ? error.message : error?.name ?? 'UnknownError'}`);
  process.exitCode = 1;
});
