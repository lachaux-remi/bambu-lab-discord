import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock("../src/libs/logger", () => ({ getLogger: () => ({ warn: warnMock }) }));

const originalInsecureValue = process.env.BAMBU_TLS_INSECURE;

describe("Bambu TLS configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    warnMock.mockReset();
    delete process.env.BAMBU_TLS_INSECURE;
  });

  afterEach(() => {
    if (originalInsecureValue === undefined) {
      delete process.env.BAMBU_TLS_INSECURE;
    } else {
      process.env.BAMBU_TLS_INSECURE = originalInsecureValue;
    }
  });

  it("loads the embedded CA bundle and verifies the configured serial by default", async () => {
    const { getBambuTlsOptions } = await import("../src/libs/bambu-tls");

    const options = getBambuTlsOptions("01S00A000000000");

    expect(options).toEqual({
      ca: expect.any(Buffer),
      rejectUnauthorized: true,
      servername: "01S00A000000000"
    });
    expect((options.ca as Buffer).toString("ascii").match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(5);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("matches the reviewed upstream bundle metadata", async () => {
    const directory = resolve("src/libs/bambu-tls");
    const bundle = await readFile(resolve(directory, "bambu-printer-ca.pem"));
    const metadata = JSON.parse(await readFile(resolve(".github/bambu-ca-bundle.json"), "utf8")) as {
      revision: string;
      upstreamSha256: string;
      vendoredSha256: string;
    };
    const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

    expect(metadata.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(sha256(bundle)).toBe(metadata.vendoredSha256);
    expect(bundle.at(-1)).toBe(0x0a);
    expect(sha256(bundle.subarray(0, -1))).toBe(metadata.upstreamSha256);
  });

  it("supports the explicit insecure fallback and warns only once", async () => {
    process.env.BAMBU_TLS_INSECURE = "true";

    const firstImport = await import("../src/libs/bambu-tls");
    const secondImport = await import("../src/libs/bambu-tls");

    expect(firstImport.getBambuTlsOptions("SERIAL")).toMatchObject({
      rejectUnauthorized: false,
      servername: "SERIAL"
    });
    expect(secondImport).toBe(firstImport);
    expect(warnMock).toHaveBeenCalledOnce();
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("BAMBU_TLS_INSECURE=true"));
  });

  it("rejects invalid insecure fallback values at module load", async () => {
    process.env.BAMBU_TLS_INSECURE = "yes";

    await expect(import("../src/libs/bambu-tls")).rejects.toThrow(
      'BAMBU_TLS_INSECURE must be either "true" or "false" when set'
    );
  });
});
