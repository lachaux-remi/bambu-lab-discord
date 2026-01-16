import * as tls from "tls";

import { getLogger } from "../logger";

const logger = getLogger("RTC");

// JPEG markers
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

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
 * Uses the native protocol on port 6000
 *
 * Note: This requires the printer to be awake and camera active.
 */
export const takeScreenshotFromBambuStream = (ip: string, accessCode: string): Promise<Buffer | null> => {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      logger.debug({ ip, bufferSize: buffer.length }, "Bambu stream timeout");
      socket?.destroy();
      resolve(null);
    }, 15000);

    let socket: tls.TLSSocket | null = null;
    let buffer = Buffer.alloc(0);
    let foundStart = false;

    try {
      socket = tls.connect(
        {
          host: ip,
          port: 6000,
          rejectUnauthorized: false
        },
        () => {
          logger.debug({ ip }, "Connected to Bambu camera stream");
          const authPayload = buildAuthPayload("bblp", accessCode);
          socket?.write(authPayload);
        }
      );

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (!foundStart) {
          const startIdx = buffer.indexOf(JPEG_START);
          if (startIdx >= 0) {
            foundStart = true;
            buffer = buffer.subarray(startIdx);
          }
          return;
        }

        const endIdx = buffer.indexOf(JPEG_END);
        if (endIdx >= 0) {
          const image = buffer.subarray(0, endIdx + JPEG_END.length);
          clearTimeout(timeout);
          socket?.destroy();
          logger.debug({ ip, size: image.length }, "Captured frame from Bambu stream");
          resolve(image);
        }
      });

      socket.on("error", (error: Error) => {
        clearTimeout(timeout);
        logger.debug({ ip, error: error.message }, "Bambu stream error");
        resolve(null);
      });

      socket.on("close", () => {
        clearTimeout(timeout);
      });
    } catch (error) {
      clearTimeout(timeout);
      logger.debug({ ip, error: (error as Error).message }, "Failed to connect to Bambu stream");
      resolve(null);
    }
  });
};

/**
 * Capture a screenshot from a printer using native Bambu protocol
 *
 * @param ip The printer IP address
 * @param accessCode The printer access code
 * @returns Buffer containing the screenshot or null on failure
 */
export const takeScreenshot = async (ip: string, accessCode: string): Promise<Buffer | null> => {
  return takeScreenshotFromBambuStream(ip, accessCode);
};
