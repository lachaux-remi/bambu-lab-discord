/**
 * Script de débogage pour tester les connexions RTC des imprimantes.
 * Permet de vérifier que les captures d'écran fonctionnent via le protocole natif Bambu.
 *
 * Usage: pnpm run debug:rtc
 *
 * Options via environment variables:
 * - PRINTER_ADDRESS + PRINTER_ACCESS_CODE + PRINTER_SERIAL_NUMBER + PRINTER_RTC_PORT (optional, default 6000):
 *   Test natif Bambu protocol
 * - Or it will test all configured printers
 */
import { writeFileSync } from "fs";
import { join } from "path";

import { getLogger } from "../libs/logger";
import { takeScreenshot } from "../libs/rtc";
import { getAllPrinters } from "../services/database";

const logger = getLogger("RTC-Debug");

const saveScreenshot = (buffer: Buffer): string => {
  const filename = join(process.cwd(), `rtc-debug-${Date.now()}.jpg`);
  writeFileSync(filename, buffer);
  return filename;
};

const testNativeProtocol = async (
  ip: string,
  accessCode: string,
  serial: string,
  port: number = 6000
): Promise<boolean> => {
  const startTime = Date.now();
  logger.info({ ip, port, mode: "Native-Bambu" }, "Testing native Bambu protocol...");

  const buffer = await takeScreenshot(ip, accessCode, serial, port);
  const elapsed = Date.now() - startTime;

  if (buffer) {
    const filename = saveScreenshot(buffer);
    logger.info({ elapsed: `${elapsed}ms`, size: `${buffer.length} bytes`, file: filename }, "✅ Screenshot captured");
    return true;
  }
  logger.error({ elapsed: `${elapsed}ms` }, "❌ Failed to capture screenshot");
  return false;
};

(async () => {
  logger.info("🎥 Starting RTC debug test...");

  // Option 1: Test from environment variables
  const printerIp = process.env.PRINTER_ADDRESS;
  const printerCode = process.env.PRINTER_ACCESS_CODE;
  const printerSerial = process.env.PRINTER_SERIAL_NUMBER;
  const printerRtcPort = parseInt(process.env.PRINTER_RTC_PORT ?? "6000", 10);
  if (printerIp && printerCode && printerSerial) {
    logger.info("Testing native Bambu protocol (direct connection to printer)...");
    const success = await testNativeProtocol(printerIp, printerCode, printerSerial, printerRtcPort);
    process.exit(success ? 0 : 1);
  }

  // Option 2: Test all configured printers
  const printers = getAllPrinters();

  if (printers.length === 0) {
    logger.warn(
      "No printers configured. Set PRINTER_ADDRESS + PRINTER_ACCESS_CODE + PRINTER_SERIAL_NUMBER or use /printer add command."
    );
    process.exit(1);
  }

  logger.info({ count: printers.length }, "Testing configured printers...");

  let successCount = 0;
  let failCount = 0;

  for (const printer of printers) {
    const success = await testNativeProtocol(printer.ip, printer.accessCode, printer.serial, printer.rtcPort);

    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  logger.info("=".repeat(50));
  logger.info({ success: successCount, failed: failCount, total: printers.length }, "RTC Debug Summary");

  if (failCount === 0) {
    logger.info("✅ All RTC connections working!");
  } else if (successCount === 0) {
    logger.error("❌ All RTC connections failed!");
  } else {
    logger.warn(`⚠️ ${successCount}/${printers.length} RTC connections working`);
  }

  process.exit(failCount > 0 ? 1 : 0);
})();
