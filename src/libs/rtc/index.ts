import * as tls from "tls";

import { BAMBU_USERNAME } from "../../constants";
import { getBambuTlsOptions, isTlsCertificateError } from "../bambu-tls";
import { getLogger } from "../logger";

const logger = getLogger("RTC");

// JPEG markers
const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const MAX_STREAM_BUFFER_SIZE = 20 * 1024 * 1024;

class IncrementalJpegParser {
  private readonly frameChunks: Buffer[] = [];
  private frameSize = 0;
  private previousByteWasMarkerPrefix = false;
  private started = false;

  public receivedSize = 0;
  public limitExceeded = false;

  public push(chunk: Buffer): Buffer | null {
    if (chunk.length > MAX_STREAM_BUFFER_SIZE - this.receivedSize) {
      this.limitExceeded = true;
      return null;
    }

    this.receivedSize += chunk.length;
    let frameChunkStart = this.started ? 0 : -1;

    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index]!;

      if (!this.started) {
        if (this.previousByteWasMarkerPrefix && byte === JPEG_START[1]) {
          this.started = true;
          if (index === 0) {
            this.frameChunks.push(JPEG_START);
            this.frameSize += JPEG_START.length;
            frameChunkStart = 1;
          } else {
            frameChunkStart = index - 1;
          }
        }

        this.previousByteWasMarkerPrefix = byte === JPEG_START[0];
        continue;
      }

      if (this.previousByteWasMarkerPrefix && byte === JPEG_END[1]) {
        if (frameChunkStart >= 0) {
          const frameChunk = chunk.subarray(frameChunkStart, index + 1);
          this.frameChunks.push(frameChunk);
          this.frameSize += frameChunk.length;
        }

        return Buffer.concat(this.frameChunks, this.frameSize);
      }

      this.previousByteWasMarkerPrefix = byte === JPEG_END[0];
    }

    if (frameChunkStart >= 0 && frameChunkStart < chunk.length) {
      const frameChunk = chunk.subarray(frameChunkStart);
      this.frameChunks.push(frameChunk);
      this.frameSize += frameChunk.length;
    }

    return null;
  }
}

/** Extract the first complete JPEG frame from a camera stream buffer. */
export const extractJpegFrame = (buffer: Buffer): Buffer | null => {
  const startIndex = buffer.indexOf(JPEG_START);
  if (startIndex < 0) {
    return null;
  }

  const endIndex = buffer.indexOf(JPEG_END, startIndex + JPEG_START.length);
  if (endIndex < 0) {
    return null;
  }

  return Buffer.from(buffer.subarray(startIndex, endIndex + JPEG_END.length));
};

/**
 * Build the authentication payload for Bambu Lab camera stream
 * Python uses struct.pack("IIL", 0x40, 0x3000, 0x0) which on 64-bit systems:
 * - I = 4 bytes (unsigned int)
 * - I = 4 bytes (unsigned int)
 * - L = 8 bytes (unsigned long on 64-bit)
 * Total header: 16 bytes + 32 bytes username + 32 bytes access code = 80 bytes
 */
const buildAuthPayload = (username: string, accessCode: string): Buffer => {
  // Header: 4 + 4 + 8 = 16 bytes on 64-bit Python
  // Username: 32 bytes, Access code: 32 bytes
  // Total: 80 bytes
  const payload = Buffer.alloc(80);

  // Header: struct.pack("IIL", 0x40, 0x3000, 0x0) in little-endian
  payload.writeUInt32LE(0x40, 0); // I: 4 bytes
  payload.writeUInt32LE(0x3000, 4); // I: 4 bytes
  // L on 64-bit: 8 bytes (BigInt for 64-bit value)
  payload.writeBigUInt64LE(0n, 8); // L: 8 bytes

  // Username at offset 16, 32 bytes null-padded
  const usernameBytes = Buffer.from(username, "ascii");
  usernameBytes.copy(payload, 16, 0, Math.min(usernameBytes.length, 32));

  // Access code at offset 48, 32 bytes null-padded
  const accessCodeBytes = Buffer.from(accessCode, "ascii");
  accessCodeBytes.copy(payload, 48, 0, Math.min(accessCodeBytes.length, 32));

  return payload;
};

/**
 * Capture a single frame from Bambu Lab camera stream
 * Uses the native protocol on the specified port (default 6000)
 *
 * Note: This requires the printer to be awake and camera active.
 */
export const takeScreenshotFromBambuStream = (
  ip: string,
  accessCode: string,
  serial: string,
  port: number = 6000
): Promise<Buffer | null> => {
  return new Promise(resolve => {
    let socket: tls.TLSSocket | null = null;
    const parser = new IncrementalJpegParser();
    let settled = false;

    const finish = (result: Buffer | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket?.destroy();
      resolve(result);
    };

    const logConnectionError = (error: Error): void => {
      const context = { ip, port, expectedIdentity: serial, error: error.message };
      if (isTlsCertificateError(error)) {
        logger.warn(context, "Bambu camera certificate validation failed");
      } else {
        logger.debug(context, "Bambu stream error");
      }
    };

    const timeout = setTimeout(() => {
      logger.debug({ ip, port, bufferSize: parser.receivedSize }, "Bambu stream timeout");
      finish(null);
    }, 15000);

    try {
      socket = tls.connect(
        {
          host: ip,
          port: port,
          ...getBambuTlsOptions(serial)
        },
        () => {
          logger.debug({ ip, port }, "Connected to Bambu camera stream");
          const authPayload = buildAuthPayload(BAMBU_USERNAME, accessCode);
          socket?.write(authPayload);
        }
      );

      socket.on("data", (chunk: Buffer) => {
        const image = parser.push(chunk);
        if (parser.limitExceeded) {
          logger.debug(
            { ip, bufferSize: parser.receivedSize + chunk.length },
            "Bambu stream frame exceeded maximum size"
          );
          finish(null);
          return;
        }

        if (image) {
          logger.debug({ ip, size: image.length }, "Captured frame from Bambu stream");
          finish(image);
        }
      });

      socket.on("error", (error: Error) => {
        logConnectionError(error);
        finish(null);
      });

      socket.on("close", () => {
        finish(null);
      });
    } catch (error) {
      logConnectionError(error as Error);
      finish(null);
    }
  });
};

/**
 * Capture a screenshot from a printer using native Bambu protocol
 *
 * @param ip The printer IP address
 * @param accessCode The printer access code
 * @param serial The printer serial used as the TLS server identity
 * @param port The RTC port (default: 6000)
 * @returns Buffer containing the screenshot or null on failure
 */
export const takeScreenshot = async (
  ip: string,
  accessCode: string,
  serial: string,
  port: number = 6000
): Promise<Buffer | null> => {
  return takeScreenshotFromBambuStream(ip, accessCode, serial, port);
};
