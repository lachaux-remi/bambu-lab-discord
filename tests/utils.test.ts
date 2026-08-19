import { describe, expect, it } from "vitest";

import { PrintState } from "../src/enums";
import { getDiscordTagsForStatus, getInitialDiscordTags } from "../src/utils/discord-tags.util";
import { getFilamentCount, isMulticolorPrint, isMulticolorPrintV2 } from "../src/utils/print.util";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../src/utils/time.util";

describe("print utilities", () => {
  it.each([
    [undefined, false, 0],
    [[], false, 0],
    [[-1, -1], false, 0],
    [[0, -1], false, 1],
    [[0, 3], true, 2]
  ])("handles AMS mapping %j", (mapping, multicolor, count) => {
    expect(isMulticolorPrint(mapping)).toBe(multicolor);
    expect(getFilamentCount(mapping)).toBe(count);
  });

  it("ignores unused AMS v2 slots", () => {
    expect(
      isMulticolorPrintV2([
        { ams_id: 0, slot_id: 1 },
        { ams_id: 255, slot_id: 255 }
      ])
    ).toBe(false);
    expect(
      isMulticolorPrintV2([
        { ams_id: 0, slot_id: 1 },
        { ams_id: 1, slot_id: 2 }
      ])
    ).toBe(true);
  });
});

describe("time utilities", () => {
  it("floors elapsed time to complete minutes", () => {
    expect(timeDiffInMinutes(1_000, 121_999)).toBe(2);
  });

  it.each([
    [0, "0 minute"],
    [1, "1 minute"],
    [59, "59 minutes"],
    [60, "1 heure 0 minute"],
    [121, "2 heures 1 minute"]
  ])("formats %i minutes", (minutes, expected) => {
    expect(formatMinuteToBestDisplay(minutes)).toBe(expected);
  });
});

describe("Discord tag utilities", () => {
  it.each([
    [PrintState.RUNNING, "En cours"],
    [PrintState.FINISH, "Réussi"],
    [PrintState.FAILED, "Échoué"],
    [PrintState.PAUSE, "En pause"],
    [PrintState.IDLE, "En cours"]
  ])("maps %s to its state tag", (state, expectedTag) => {
    expect(getDiscordTagsForStatus({ state, isMulticolor: true } as never)).toEqual(["Multicolore", expectedTag]);
  });

  it("builds initial tags for monochrome prints", () => {
    expect(getInitialDiscordTags(false)).toEqual(["En cours", "Monocolor"]);
  });
});
