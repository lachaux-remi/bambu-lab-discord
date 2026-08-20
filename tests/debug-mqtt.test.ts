import { describe, expect, it } from "vitest";

import {
  createCaptureRecord,
  createCaptureSanitizer,
  formatCaptureRecord,
  formatConsoleSummary
} from "../src/tools/debug-mqtt";

const SENTINELS = [
  "ACCESS-CODE-SENTINEL",
  "PASSWORD-SENTINEL",
  "TOKEN-SENTINEL",
  "AUTHORIZATION-SENTINEL",
  "ENCRYPTION-KEY-SENTINEL",
  "AWS-CREDENTIAL-SENTINEL",
  "AWS-SIGNATURE-SENTINEL",
  "192.0.2.42",
  "SERIAL-SENTINEL",
  "TASK-SENTINEL",
  "SUBTASK-SENTINEL",
  "PROJECT-SENTINEL",
  "USER-SENTINEL",
  "PRIVATE-PROJECT-NAME"
];

const expectSafe = (value: string): void => {
  for (const sentinel of SENTINELS) {
    expect(value).not.toContain(sentinel);
  }
};

describe("safe MQTT capture", () => {
  it("recursively sanitizes a realistic payload without mutating it", () => {
    const payload = {
      print: {
        command: "push_status",
        gcode_state: "RUNNING",
        mc_percent: 0,
        layer_num: 0,
        total_layer_num: 120,
        task_id: "TASK-SENTINEL",
        subtask_id: "SUBTASK-SENTINEL",
        project_id: "PROJECT-SENTINEL",
        userId: "USER-SENTINEL",
        subtask_name: "PRIVATE-PROJECT-NAME",
        gcode_file: "/home/alice/PRIVATE-PROJECT-NAME.3mf",
        url: "https://example.invalid/PRIVATE-PROJECT-NAME.3mf?X-Amz-Credential=AWS-CREDENTIAL-SENTINEL&X-Amz-Signature=AWS-SIGNATURE-SENTINEL",
        modules: [
          {
            ipAddress: "192.0.2.42",
            serialNumber: "SERIAL-SENTINEL",
            accessCode: "ACCESS-CODE-SENTINEL",
            Password: "PASSWORD-SENTINEL",
            auth_token: "TOKEN-SENTINEL",
            Authorization: "AUTHORIZATION-SENTINEL",
            encryption_key: "ENCRYPTION-KEY-SENTINEL"
          }
        ]
      },
      system: { access_code: "ACCESS-CODE-SENTINEL" }
    };
    const original = structuredClone(payload);
    const sanitize = createCaptureSanitizer("fixed-test-salt");

    const first = createCaptureRecord(Buffer.from(JSON.stringify(payload)), "2026-08-20T10:00:00.000Z", sanitize);
    const second = createCaptureRecord(Buffer.from(JSON.stringify(payload)), "2026-08-20T10:00:01.000Z", sanitize);
    const ndjson = `${formatCaptureRecord(first)}${formatCaptureRecord(second)}`;
    const consoleOutput = `${formatConsoleSummary(first)}\n${formatConsoleSummary(second)}`;

    expect(payload).toEqual(original);
    expectSafe(ndjson);
    expectSafe(consoleOutput);
    expect(first).toMatchObject({ timestamp: "2026-08-20T10:00:00.000Z", key: "print" });
    expect(first.payload).toEqual(second.payload);
    expect(consoleOutput).toContain("progress=0%");
    expect(consoleOutput).toContain("layer=0/120");

    const lines = ndjson.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map(line => JSON.parse(line))).toEqual([first, second]);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).not.toContain("  ");
  });

  it("sanitizes residual liveview and print identifiers while preserving multicolor mappings", () => {
    const payload = {
      liveview: {
        ttcode_enc: "LIVESTREAM-TTCODE-SENTINEL",
        TTCode_Enc: "LIVESTREAM-TTCODE-VARIANT-SENTINEL"
      },
      print: {
        md5: "PRINT-MD5-SENTINEL",
        MD_5: "PRINT-MD5-VARIANT-SENTINEL",
        tray_uuid: "TRAY-UUID-SENTINEL",
        TrayUUID: "TRAY-UUID-VARIANT-SENTINEL",
        ams: {
          ams: [{ ams_id: "AMS-SERIAL-SENTINEL" }, { AMSId: "AMS-SERIAL-VARIANT-SENTINEL" }]
        },
        ams_mapping: [0, -1, 2, -1],
        ams_mapping2: [
          { ams_id: 0, slot_id: 0 },
          { AMSId: 1, SlotId: 2 }
        ]
      }
    };

    const sanitized = createCaptureSanitizer("fixed-test-salt")(payload);
    const output = JSON.stringify(sanitized);

    expect(output).not.toContain("SENTINEL");
    expect(sanitized).toMatchObject({
      liveview: { ttcode_enc: "[REDACTED]", TTCode_Enc: "[REDACTED]" },
      print: {
        md5: expect.stringMatching(/^\[HASH_[a-f\d]{12}\]$/),
        MD_5: expect.stringMatching(/^\[HASH_[a-f\d]{12}\]$/),
        tray_uuid: expect.stringMatching(/^\[ID_[a-f\d]{12}\]$/),
        TrayUUID: expect.stringMatching(/^\[ID_[a-f\d]{12}\]$/),
        ams: {
          ams: [
            { ams_id: expect.stringMatching(/^\[SERIAL_[a-f\d]{12}\]$/) },
            { AMSId: expect.stringMatching(/^\[SERIAL_[a-f\d]{12}\]$/) }
          ]
        },
        ams_mapping: [0, -1, 2, -1],
        ams_mapping2: [
          { ams_id: 0, slot_id: 0 },
          { AMSId: 1, SlotId: 2 }
        ]
      }
    });
  });

  it("records only safe metadata when JSON parsing fails", () => {
    const rawPayload = Buffer.from('{"access_code":"ACCESS-CODE-SENTINEL",broken');
    const record = createCaptureRecord(
      rawPayload,
      "2026-08-20T10:00:00.000Z",
      createCaptureSanitizer("fixed-test-salt")
    );
    const fileOutput = formatCaptureRecord(record);
    const consoleOutput = formatConsoleSummary(record);

    expectSafe(fileOutput);
    expectSafe(consoleOutput);
    expect(JSON.parse(fileOutput)).toEqual({
      timestamp: "2026-08-20T10:00:00.000Z",
      key: "invalid_json",
      error: { byteLength: rawPayload.byteLength, sha256: expect.stringMatching(/^[a-f\d]{64}$/) }
    });
    expect(consoleOutput).toContain(`invalid JSON bytes=${rawPayload.byteLength}`);
  });

  it("shows print state transitions in the human summary", () => {
    const record = createCaptureRecord(
      Buffer.from(JSON.stringify({ print: { command: "push_status", gcode_state: "PAUSE" } })),
      "2026-08-20T10:00:00.000Z",
      createCaptureSanitizer("fixed-test-salt")
    );

    expect(formatConsoleSummary(record, "RUNNING")).toContain("state=RUNNING→PAUSE");
  });
});
