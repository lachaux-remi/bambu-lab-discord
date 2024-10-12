import AWS from "aws-sdk";

import {
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
  S3_SIGNATURE_VERSION
} from "../../constants";
import type { Status } from "../../types";
import { getLogger } from "../logger";
import { takeScreenshotBuffer } from "../rtc";

const logger = getLogger("S3Storage");

const s3Storage = new AWS.S3({
  endpoint: S3_ENDPOINT,
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: S3_SIGNATURE_VERSION,
  s3ForcePathStyle: true
});

const upload = async (key: string, body: Buffer, contentType: string): Promise<string | null> => {
  return s3Storage
    .upload({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ACL: "public-read",
      ContentType: contentType
    })
    .promise()
    .then(upload => upload.Location);
};

export const getScreenshotURL = async (): Promise<string | null> => {
  const screenshotBuffer = await takeScreenshotBuffer();

  return await upload(`screenshot/${new Date().getTime()}.jpeg`, Buffer.from(screenshotBuffer), "image/jpeg").catch(
    error => {
      logger.error({ message: error.message }, "Error uploading screenshot to S3");
      return null;
    }
  );
};

export const getProjectURL = async (status: Status): Promise<string | null> => {
  const projectBuffer = await fetch(status.url).then(res => res.arrayBuffer());

  return await upload(`projects/${status.taskName}.3mf`, Buffer.from(projectBuffer), "application/zip").catch(error => {
    logger.error({ message: error.message }, "Error uploading project to S3");
    return null;
  });
};
