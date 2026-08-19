import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getLogger } from "../logger";

const logger = getLogger("BambuTLS");

const parseInsecureMode = (): boolean => {
  const value = process.env.BAMBU_TLS_INSECURE;
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }

  throw new Error('BAMBU_TLS_INSECURE must be either "true" or "false" when set');
};

const insecure = parseInsecureMode();
const ca = readFileSync(join(__dirname, "bambu-printer-ca.pem"));
const certificateErrorCodes = new Set([
  "CERT_CHAIN_TOO_LONG",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_SSL_CERTIFICATE_VERIFY_FAILED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
]);

if (insecure) {
  logger.warn(
    "🚨 SECURITY WARNING: BAMBU_TLS_INSECURE=true disables MQTT and camera certificate verification; " +
      "this exposes the printer access code, controls, and camera stream to man-in-the-middle attacks"
  );
}

interface BambuTlsOptions {
  ca: Buffer;
  rejectUnauthorized: boolean;
  servername: string;
}

export const getBambuTlsOptions = (serial: string): BambuTlsOptions => ({
  ca,
  rejectUnauthorized: !insecure,
  servername: serial
});

export const isTlsCertificateError = (error: unknown): boolean => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const code = error.code;
  return typeof code === "string" && (code.startsWith("ERR_TLS_CERT_") || certificateErrorCodes.has(code));
};
