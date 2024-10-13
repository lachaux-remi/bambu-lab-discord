import AdmZip from "adm-zip";
import AWS from "aws-sdk";
import { setTimeout } from "timers/promises";

import {
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
  S3_SIGNATURE_VERSION
} from "../../constants";
import { ContentType } from "../../enums";
import { getLogger } from "../logger";
import { takeScreenshotBuffer } from "../rtc";

type UploadProjectImage = { url: string; name: string; plate: string };

const logger = getLogger("S3 Storage");
const s3Storage = new AWS.S3({
  endpoint: S3_ENDPOINT,
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY,
  region: S3_REGION,
  signatureVersion: S3_SIGNATURE_VERSION,
  s3ForcePathStyle: true
});

const upload = async (key: string, body: Buffer, contentType: ContentType): Promise<string | null> => {
  return s3Storage
    .upload({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ACL: "public-read",
      ContentType: contentType
    })
    .promise()
    .then(upload => upload.Location)
    .catch((error: Error) => {
      logger.error({ error }, `Failed to upload ${key}`);
      return null;
    });
};

/**
 * Find the plate image in the project 3mf file and upload it to S3.
 *
 * @param data {UploadProjectImage} The data to upload.
 * @param {number} attempt The number of attempts.
 * @returns {Promise<void>}
 */
export const uploadProjectImage = async (data: UploadProjectImage, attempt: number = 0): Promise<string | null> => {
  if (attempt > 5) {
    logger.error("Failed to upload project image after 5 attempts");
    return null;
  }

  const { url, name, plate } = data;

  const projectBuffer = await fetch(url)
    .then(res => res.arrayBuffer())
    .catch(() => null);
  if (!projectBuffer) {
    await setTimeout(1000);
    return uploadProjectImage(data, attempt++);
  }

  // Find the plate image in the project 3mf file
  const projectZip = new AdmZip(Buffer.from(projectBuffer));
  const plateEntry = projectZip.getEntry(`Metadata/plate_${plate}.png`);
  if (!plateEntry) {
    logger.error(`Failed to upload project image ${plate} plate not found`);
    return null;
  }

  return await upload(`projects/${name}.${plate}.png`, plateEntry.getData(), ContentType.IMAGE_PNG);
};

/**
 * Uploads the screenshot from RTC to S3.
 *
 * @param {number} attempt The number of attempts.
 * @returns { string | null } The URL of the screenshot.
 */
export const uploadScreenshot = async (attempt: number = 0): Promise<string | null> => {
  if (attempt > 5) {
    logger.error("Failed to upload screenshot after 5 attempts");
    return null;
  }

  const screenshotBuffer = await takeScreenshotBuffer();
  if (!screenshotBuffer) {
    await setTimeout(1000);
    return uploadScreenshot(attempt++);
  }

  return await upload(`screenshot/${new Date().getTime()}.jpeg`, screenshotBuffer, ContentType.IMAGE_JPEG);
};
