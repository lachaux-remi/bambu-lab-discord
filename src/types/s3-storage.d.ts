import type { StringNumber } from "./general";

/** Data required to upload a project image to S3 */
export interface UploadProjectImageData {
  url: string;
  model: string;
  project: string;
  plate: StringNumber;
}
