import AdmZip from "adm-zip";
import AWS from "aws-sdk";

import {
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
  S3_SIGNATURE_VERSION
} from "../../constants";
import { takeScreenshotBuffer } from "../rtc";

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
    .then(upload => upload.Location)
    .catch(() => null);
};

/**
 * Finds the plate image in the project and uploads it to S3.
 *
 * @param {string} url The URL of the project file.
 * @param {string} name The name of the project.
 * @param {string} plate The name of the plate.
 *
 * @returns {Promise<void>}
 */
export const uploadProjectImage = async (url: string, name: string, plate: string): Promise<string | null> => {
  const projectBuffer = await fetch(url)
    .then(res => res.arrayBuffer())
    .catch(() => null);
  if (!projectBuffer) {
    return null;
  }

  const projectZip = new AdmZip(Buffer.from(projectBuffer));
  const plateEntry = projectZip.getEntry(`Metadata/plate_${plate}.png`);
  if (!plateEntry) {
    return null;
  }

  return await upload(`projects/${name}.${plate}.png`, plateEntry.getData(), "image/png");
};

/**
 * Uploads the screenshot from RTC to S3.
 *
 * @returns { string | null } The URL of the screenshot.
 */
export const uploadScreenshot = async (): Promise<string | null> => {
  const screenshotBuffer = await takeScreenshotBuffer();
  if (!screenshotBuffer) {
    return null;
  }

  return await upload(`screenshot/${new Date().getTime()}.jpeg`, screenshotBuffer, "image/jpeg");
};
