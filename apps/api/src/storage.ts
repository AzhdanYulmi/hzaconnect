import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

// Internal client — server-to-MinIO ops (HEAD, ensureBucket). Uses the
// in-cluster endpoint so the api container can reach MinIO directly.
export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

// Public client — used to mint presigned URLs that the *browser* will use.
// Signs against the host-reachable endpoint so signature validation
// doesn't break when the browser substitutes the URL host.
const publicEndpoint = config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT;
const s3public = new S3Client({
  region: config.S3_REGION,
  endpoint: publicEndpoint,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}

export async function presignPut(
  key: string,
  mime: string,
  expiresSeconds = 60 * 5,
): Promise<string> {
  return await getSignedUrl(
    s3public,
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      ContentType: mime,
    }),
    { expiresIn: expiresSeconds },
  );
}

export async function presignGet(
  key: string,
  expiresSeconds = 60 * 10,
): Promise<string> {
  return await getSignedUrl(
    s3public,
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn: expiresSeconds },
  );
}

export async function headObject(key: string) {
  return await s3.send(
    new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
  );
}
