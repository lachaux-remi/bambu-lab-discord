import { describe, expect, it } from "vitest";

import { PrintState } from "../src/enums";
import { getDiscordTagsForStatus, getInitialDiscordTags } from "../src/utils/discord-tags.util";
import { normalizePrintIdentity } from "../src/utils/print-identity.util";
import { isMulticolorPrint } from "../src/utils/print.util";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../src/utils/time.util";

describe("print identity utilities", () => {
  it.each([
    [undefined, undefined, undefined],
    ["", undefined, undefined],
    ["   ", undefined, undefined],
    [0, undefined, "0"],
    ["0", undefined, "0"],
    [42, "42", "42"],
    ["print-42", "print-42", "print-42"]
  ] as const)("normalizes identity value %j", (value, expectedId, expectedText) => {
    expect(normalizePrintIdentity(value, true)).toBe(expectedId);
    expect(normalizePrintIdentity(value, false)).toBe(expectedText);
  });
});

describe("print utilities", () => {
  it.each([
    [undefined, false],
    [[], false],
    [[-1, -1], false],
    [[0, -1], false],
    [[0, 3], true]
  ])("handles AMS mapping %j", (mapping, multicolor) => {
    expect(isMulticolorPrint(mapping)).toBe(multicolor);
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
