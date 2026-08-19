import { afterEach, describe, expect, it, vi } from "vitest";

const discord = vi.hoisted(() => {
  const fetch = vi.fn();

  class Client {
    channels = { fetch };
    destroy = vi.fn();
    login = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
  }

  return { Client, fetch };
});

vi.mock("discord.js", async importOriginal => {
  const actual = await importOriginal<typeof import("discord.js")>();
  return { ...actual, Client: discord.Client };
});
vi.mock("../src/constants", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/constants")>();
  return { ...actual, DISCORD_BOT_TOKEN: "test-token" };
});

describe.sequential("Discord forum mutation serialization", () => {
  afterEach(async () => {
    const { shutdownDiscordClient } = await import("../src/services/discord/bot");
    await shutdownDiscordClient();
    discord.fetch.mockReset();
  });

  it("serializes ensureForumTags and ensurePrinterTag edits for the same forum", async () => {
    const edits: Array<() => void> = [];
    let activeEdits = 0;
    let maximumActiveEdits = 0;
    const forum = {
      type: 15,
      availableTags: [],
      edit: vi.fn(() => {
        activeEdits += 1;
        maximumActiveEdits = Math.max(maximumActiveEdits, activeEdits);
        return new Promise<void>(resolve => {
          edits.push(() => {
            activeEdits -= 1;
            resolve();
          });
        });
      })
    };
    discord.fetch.mockResolvedValue(forum);

    const { ensureForumTags, ensurePrinterTag, initDiscordClient } = await import("../src/services/discord/bot");
    await initDiscordClient();

    const baseTags = ensureForumTags("forum-1");
    const printerTag = ensurePrinterTag("forum-1", "Workshop P1S");
    await vi.waitFor(() => expect(forum.edit).toHaveBeenCalledTimes(1));
    expect(discord.fetch).toHaveBeenCalledTimes(1);

    edits.shift()?.();
    await vi.waitFor(() => expect(forum.edit).toHaveBeenCalledTimes(2));
    expect(discord.fetch).toHaveBeenCalledTimes(2);
    expect(maximumActiveEdits).toBe(1);

    edits.shift()?.();
    await expect(Promise.all([baseTags, printerTag])).resolves.toEqual([
      { created: ["En cours", "Réussi", "Échoué", "En pause", "Attention", "Multicolore", "Monocolor"], removed: [] },
      true
    ]);
  });
});
