import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config';

/**
 * S3-compatible object storage (AWS S3, MinIO; Azure Blob via its S3 gateway).
 * Objects are never public: access is via short-lived presigned URLs, server-side encrypted.
 */
let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    const e = env();
    client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(e.S3_ENDPOINT),
      credentials: e.S3_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY } : undefined,
    });
  }
  return client;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // MinIO and S3 both accept SSE-S3; KMS can be configured at the bucket level.
      ServerSideEncryption: env().S3_ENDPOINT ? undefined : 'AES256',
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
}

/** Presigned download URL, 5 minutes by default. Callers must audit the access. */
export async function signedDownloadUrl(key: string, filename: string, ttlSec = 300) {
  const safeName = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${safeName}"` }),
    { expiresIn: ttlSec },
  );
}
