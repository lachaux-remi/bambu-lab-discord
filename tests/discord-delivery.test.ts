import { EmbedBuilder } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISCORD_ATTACHMENT_SIZE_LIMIT,
  DISCORD_EMBED_DESCRIPTION_LIMIT,
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  DISCORD_EMBED_TEXT_LIMIT,
  discordEmbedTextLength
} from "../src/services/discord/payload";

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
const logs = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("discord.js", async importOriginal => {
  const actual = await importOriginal<typeof import("discord.js")>();
  return { ...actual, Client: discord.Client };
});
vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: logs.warn })
}));
vi.mock("../src/constants", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/constants")>();
  return { ...actual, DISCORD_BOT_TOKEN: "test-token" };
});

describe.sequential("reliable Discord delivery", () => {
  beforeEach(async () => {
    discord.fetch.mockReset();
    logs.warn.mockReset();
    const { initDiscordClient } = await import("../src/services/discord/bot");
    await initDiscordClient();
  });

  afterEach(async () => {
    const { shutdownDiscordClient } = await import("../src/services/discord/bot");
    await shutdownDiscordClient();
  });

  it("marks notifications, enforces a stable nonce, and applies tags", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const setAppliedTags = vi.fn().mockResolvedValue(undefined);
    const thread = { isThread: () => true, parentId: "forum-1", send, setAppliedTags };
    const forum = { type: 15, availableTags: [{ id: "tag-1", name: "En cours" }] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));

    const { deliverThreadNotification } = await import("../src/services/discord/bot");
    const embed = new EmbedBuilder().setFooter({ text: "Existing", iconURL: "https://example.com/icon.png" });
    await expect(
      deliverThreadNotification({
        eventId: "job-progress-10",
        threadId: "thread-1",
        embed,
        tags: ["En cours"],
        reconcileOnly: false
      })
    ).resolves.toEqual({ status: "sent", value: { messageId: "message-1" } });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: expect.stringMatching(/^.{25}$/), enforceNonce: true })
    );
    expect(embed.data.footer).toEqual({
      text: "Existing [event:job-progress-10]",
      icon_url: "https://example.com/icon.png"
    });
    expect(setAppliedTags).toHaveBeenCalledWith(["tag-1"]);
  });

  it("preserves exact embed limits and truncates +1 values without splitting Unicode", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const thread = {
      isThread: () => true,
      parentId: "forum-1",
      send,
      setAppliedTags: vi.fn().mockResolvedValue(undefined)
    };
    const forum = { type: 15, availableTags: [] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));
    const { deliverThreadNotification } = await import("../src/services/discord/bot");

    await deliverThreadNotification({
      eventId: "exact-limits",
      threadId: "thread-1",
      embed: EmbedBuilder.from({
        description: "d".repeat(DISCORD_EMBED_DESCRIPTION_LIMIT),
        fields: [{ name: "Field", value: "v".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT) }]
      }),
      tags: [],
      reconcileOnly: false
    });
    await deliverThreadNotification({
      eventId: "unicode-plus-one",
      threadId: "thread-1",
      embed: EmbedBuilder.from({
        description: `${"d".repeat(DISCORD_EMBED_DESCRIPTION_LIMIT - 1)}🧪`,
        fields: [{ name: "Field", value: `${"v".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT - 1)}🧪` }]
      }),
      tags: [],
      reconcileOnly: false
    });

    const exactEmbed = send.mock.calls[0]?.[0].embeds[0].toJSON();
    expect(exactEmbed.description).toHaveLength(DISCORD_EMBED_DESCRIPTION_LIMIT);
    expect(exactEmbed.fields[0]?.value).toHaveLength(DISCORD_EMBED_FIELD_VALUE_LIMIT);
    const unicodeEmbed = send.mock.calls[1]?.[0].embeds[0].toJSON();
    expect(unicodeEmbed.description).toBe("d".repeat(DISCORD_EMBED_DESCRIPTION_LIMIT - 1));
    expect(unicodeEmbed.fields[0]?.value).toBe("v".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT - 1));
  });

  it("bounds aggregate embed text at 6000 while preserving the deduplication marker", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const thread = {
      isThread: () => true,
      parentId: "forum-1",
      send,
      setAppliedTags: vi.fn().mockResolvedValue(undefined)
    };
    const forum = { type: 15, availableTags: [] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));
    const { deliverThreadNotification } = await import("../src/services/discord/bot");

    await deliverThreadNotification({
      eventId: "aggregate-limit",
      threadId: "thread-1",
      embed: EmbedBuilder.from({
        title: "t".repeat(256),
        description: "d".repeat(DISCORD_EMBED_DESCRIPTION_LIMIT),
        fields: [
          { name: "First", value: "1".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT) },
          { name: "Second", value: "2".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT) }
        ]
      }),
      tags: [],
      reconcileOnly: false
    });

    const deliveredEmbed = send.mock.calls[0]?.[0].embeds[0].toJSON();
    expect(discordEmbedTextLength(deliveredEmbed)).toBe(DISCORD_EMBED_TEXT_LIMIT);
    expect(deliveredEmbed.footer?.text).toContain("[event:aggregate-limit]");
  });

  it("keeps a 10 MiB attachment and omits a +1 byte attachment with its embed reference", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const thread = {
      isThread: () => true,
      parentId: "forum-1",
      send,
      setAppliedTags: vi.fn().mockResolvedValue(undefined)
    };
    const forum = { type: 15, availableTags: [] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));
    const { deliverThreadNotification } = await import("../src/services/discord/bot");

    await deliverThreadNotification({
      eventId: "attachment-limits",
      threadId: "thread-1",
      embed: EmbedBuilder.from({
        description: "Notification text",
        image: { url: "attachment://exact.jpg" },
        thumbnail: { url: "attachment://oversized.jpg" }
      }),
      files: [
        { name: "exact.jpg", buffer: Buffer.alloc(DISCORD_ATTACHMENT_SIZE_LIMIT) },
        { name: "oversized.jpg", buffer: Buffer.alloc(DISCORD_ATTACHMENT_SIZE_LIMIT + 1) }
      ],
      tags: [],
      reconcileOnly: false
    });

    const payload = send.mock.calls[0]?.[0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("exact.jpg");
    expect(payload.files[0].attachment).toHaveLength(DISCORD_ATTACHMENT_SIZE_LIMIT);
    expect(payload.embeds[0].toJSON()).toMatchObject({
      description: "Notification text",
      image: { url: "attachment://exact.jpg" }
    });
    expect(payload.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith(
      { attachmentSize: DISCORD_ATTACHMENT_SIZE_LIMIT + 1, limit: DISCORD_ATTACHMENT_SIZE_LIMIT },
      "Discord attachment omitted; delivering notification text without it"
    );
  });

  it("delivers notification text when its only media is oversized", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const thread = {
      isThread: () => true,
      parentId: "forum-1",
      send,
      setAppliedTags: vi.fn().mockResolvedValue(undefined)
    };
    const forum = { type: 15, availableTags: [] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));
    const { deliverThreadNotification } = await import("../src/services/discord/bot");

    await expect(
      deliverThreadNotification({
        eventId: "text-only-fallback",
        threadId: "thread-1",
        embed: EmbedBuilder.from({
          description: "Text remains deliverable",
          image: { url: "attachment://oversized.jpg" }
        }),
        files: [{ name: "oversized.jpg", buffer: Buffer.alloc(DISCORD_ATTACHMENT_SIZE_LIMIT + 1) }],
        tags: [],
        reconcileOnly: false
      })
    ).resolves.toEqual({ status: "sent", value: { messageId: "message-1" } });

    expect(send.mock.calls[0]?.[0].files).toEqual([]);
    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      description: "Text remains deliverable"
    });
    expect(send.mock.calls[0]?.[0].embeds[0].toJSON().image).toBeUndefined();
  });

  it.each([
    ["a printer name matching a canonical tag", ["En cours", "Monocolor", "En cours"]],
    ["mixed-case duplicate names", ["En cours", "Monocolor", " en COURS "]]
  ])("deduplicates %s before applying delivery tags", async (_description, tags) => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const setAppliedTags = vi.fn().mockResolvedValue(undefined);
    const thread = { isThread: () => true, parentId: "forum-1", send, setAppliedTags };
    const forum = {
      type: 15,
      availableTags: [
        { id: "running", name: "En cours" },
        { id: "single-color", name: "Monocolor" }
      ]
    };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));
    const { deliverThreadNotification } = await import("../src/services/discord/bot");

    await expect(
      deliverThreadNotification({
        eventId: "duplicate-tags",
        threadId: "thread-1",
        embed: new EmbedBuilder(),
        tags,
        reconcileOnly: false
      })
    ).resolves.toEqual({ status: "sent", value: { messageId: "message-1" } });
    expect(setAppliedTags).toHaveBeenCalledWith(["running", "single-color"]);
  });

  it("classifies missing channels as blocked and uncertain creates as ambiguous", async () => {
    const { deliverPrintThread, deliverThreadNotification } = await import("../src/services/discord/bot");
    discord.fetch.mockRejectedValueOnce({ code: 10003 });
    await expect(
      deliverThreadNotification({
        eventId: "missing",
        threadId: "gone",
        embed: new EmbedBuilder(),
        tags: [],
        reconcileOnly: false
      })
    ).resolves.toEqual({
      status: "blocked",
      reason: { category: "discord-access-blocked", code: 10003, status: undefined }
    });

    discord.fetch.mockResolvedValueOnce({
      type: 15,
      availableTags: [],
      threads: { create: vi.fn().mockRejectedValue(new Error("socket closed")) }
    });
    await expect(
      deliverPrintThread({
        eventId: "create-1",
        printKey: "print-1",
        title: "Print",
        embed: new EmbedBuilder(),
        tags: [],
        forumChannelId: "forum-1",
        reconcileOnly: false
      })
    ).resolves.toEqual({
      status: "ambiguous",
      reason: { category: "discord-result-ambiguous", code: undefined, status: undefined }
    });
  });

  it("reconciles a previously accepted notification without sending it again", async () => {
    const send = vi.fn();
    const setAppliedTags = vi.fn().mockResolvedValue(undefined);
    const messages = new Map([
      ["message-accepted", { id: "message-accepted", embeds: [{ footer: { text: "Done [event:finish-1]" } }] }]
    ]);
    const thread = {
      isThread: () => true,
      parentId: "forum-1",
      send,
      setAppliedTags,
      messages: { fetch: vi.fn().mockResolvedValue(messages) }
    };
    const forum = { type: 15, availableTags: [{ id: "done", name: "Réussi" }] };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "thread-1" ? thread : forum));

    const { deliverThreadNotification } = await import("../src/services/discord/bot");
    await expect(
      deliverThreadNotification({
        eventId: "finish-1",
        threadId: "thread-1",
        embed: new EmbedBuilder(),
        tags: ["Réussi"],
        reconcileOnly: true
      })
    ).resolves.toEqual({ status: "sent", value: { messageId: "message-accepted" } });
    expect(send).not.toHaveBeenCalled();
    expect(setAppliedTags).toHaveBeenCalledWith(["done"]);
  });

  it("reconciles an ambiguously accepted forum post without creating a replacement", async () => {
    const create = vi.fn();
    const setAppliedTags = vi.fn().mockResolvedValue(undefined);
    const acceptedThread = {
      id: "thread-accepted",
      fetchStarterMessage: vi.fn().mockResolvedValue({
        embeds: [{ footer: { text: "Started [event:create-accepted]" } }]
      })
    };
    const forum = {
      type: 15,
      availableTags: [{ id: "running", name: "En cours" }],
      threads: {
        create,
        fetchActive: vi.fn().mockResolvedValue({ threads: new Map([[acceptedThread.id, acceptedThread]]) }),
        fetchArchived: vi.fn()
      }
    };
    const thread = { isThread: () => true, parentId: "forum-1", setAppliedTags };
    discord.fetch.mockImplementation((id: string) => Promise.resolve(id === "forum-1" ? forum : thread));

    const { deliverPrintThread } = await import("../src/services/discord/bot");
    await expect(
      deliverPrintThread({
        eventId: "create-accepted",
        printKey: "print-1",
        title: "Print",
        embed: new EmbedBuilder(),
        tags: ["En cours"],
        forumChannelId: "forum-1",
        reconcileOnly: true
      })
    ).resolves.toEqual({ status: "sent", value: { threadId: "thread-accepted" } });
    expect(create).not.toHaveBeenCalled();
    expect(setAppliedTags).toHaveBeenCalledWith(["running"]);
  });

  it("bounds forum titles and classifies Discord validation errors as permanent", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "thread-1" })
      .mockRejectedValueOnce({ code: 50035, status: 400 })
      .mockRejectedValueOnce({ code: 40_000, status: 400 });
    const forum = { type: 15, availableTags: [], threads: { create } };
    discord.fetch.mockResolvedValue(forum);
    const { deliverPrintThread } = await import("../src/services/discord/bot");
    const input = {
      eventId: "long-title",
      printKey: "print-1",
      title: "🧪".repeat(101),
      embed: new EmbedBuilder(),
      tags: [],
      forumChannelId: "forum-1",
      reconcileOnly: false
    };

    await expect(deliverPrintThread(input)).resolves.toEqual({
      status: "sent",
      value: { threadId: "thread-1" }
    });
    expect(Array.from(create.mock.calls[0]?.[0].name ?? "")).toHaveLength(100);
    await expect(deliverPrintThread({ ...input, eventId: "invalid-form" })).resolves.toEqual({
      status: "blocked",
      reason: { category: "discord-validation-failed", code: 50035, status: 400 }
    });
    await expect(deliverPrintThread({ ...input, eventId: "other-bad-request" })).resolves.toEqual({
      status: "retryable",
      reason: { category: "discord-transient", code: 40_000, status: 400 }
    });
  });
});
