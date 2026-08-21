import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrinterConfig } from "../src/types/printer-config";

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
    const editPayloads: Array<{ availableTags: Array<{ id?: string; name: string }> }> = [];
    let activeEdits = 0;
    let maximumActiveEdits = 0;
    const forum = {
      type: 15,
      availableTags: [] as Array<{ id: string; name: string }>,
      edit: vi.fn((payload: { availableTags: Array<{ id?: string; name: string }> }) => {
        editPayloads.push(payload);
        activeEdits += 1;
        maximumActiveEdits = Math.max(maximumActiveEdits, activeEdits);
        return new Promise<void>(resolve => {
          edits.push(() => {
            forum.availableTags = payload.availableTags.map((tag, index) => ({
              id: tag.id ?? `tag-${index}`,
              name: tag.name
            }));
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
    expect(editPayloads[1]?.availableTags.map(tag => tag.name)).toEqual([
      "En cours",
      "Réussi",
      "Échoué",
      "En pause",
      "Attention",
      "Multicolore",
      "Monocolor",
      "Workshop P1S"
    ]);

    edits.shift()?.();
    await expect(Promise.all([baseTags, printerTag])).resolves.toEqual([
      { created: ["En cours", "Réussi", "Échoué", "En pause", "Attention", "Multicolore", "Monocolor"], removed: [] },
      { status: "ready", created: ["Workshop P1S"] }
    ]);
  });

  it("reconciles every configured printer tag once per forum and preserves foreign tags", async () => {
    const forum = {
      type: 15,
      availableTags: [
        { id: "foreign", name: "Équipe nuit", moderated: false },
        { id: "base", name: "En cours", moderated: false, emoji: { id: null, name: "❌" } }
      ] as Array<{ id: string; name: string; moderated: boolean; emoji?: { id: null; name: string } }>,
      edit: vi.fn((payload: { availableTags: typeof forum.availableTags }) => {
        forum.availableTags = payload.availableTags.map((tag, index) => ({
          ...tag,
          id: tag.id ?? `created-${index}`
        }));
        return Promise.resolve();
      })
    };
    discord.fetch.mockResolvedValue(forum);
    const printer = (id: string, name: string): PrinterConfig => ({
      id,
      name,
      ip: "192.0.2.1",
      port: 8883,
      rtcPort: 6000,
      serial: id,
      accessCode: "secret",
      forumChannelId: "forum-1",
      enabled: true,
      createdAt: 1,
      updatedAt: 1
    });

    const { initDiscordClient, reconcileConfiguredForumTags } = await import("../src/services/discord/bot");
    await initDiscordClient();
    const printers = [printer("p1s", "Atelier P1S"), printer("x1c", "Bureau X1C")];

    await reconcileConfiguredForumTags(printers);
    await reconcileConfiguredForumTags(printers);

    expect(forum.edit).toHaveBeenCalledOnce();
    expect(forum.availableTags.map(tag => tag.name)).toEqual([
      "Équipe nuit",
      "En cours",
      "Réussi",
      "Échoué",
      "En pause",
      "Attention",
      "Multicolore",
      "Monocolor",
      "Atelier P1S",
      "Bureau X1C"
    ]);
    expect(forum.availableTags[0]).toMatchObject({ id: "foreign", name: "Équipe nuit", moderated: false });
    expect(forum.availableTags[1]).toMatchObject({
      id: "base",
      name: "En cours",
      moderated: true,
      emoji: { id: null, name: "⏳" }
    });
  });

  it("refuses preparation before mutation when the forum tag capacity is exceeded", async () => {
    const forum = {
      type: 15,
      availableTags: Array.from({ length: 20 }, (_, index) => ({
        id: `foreign-${index}`,
        name: `Tag étranger ${index}`,
        moderated: false
      })),
      edit: vi.fn()
    };
    discord.fetch.mockResolvedValue(forum);

    const { ensurePrinterTag, initDiscordClient } = await import("../src/services/discord/bot");
    await initDiscordClient();

    await expect(ensurePrinterTag("forum-1", "Atelier P1S")).resolves.toEqual({
      status: "capacity",
      maximum: 20,
      required: 28
    });
    expect(forum.edit).not.toHaveBeenCalled();
  });
});
