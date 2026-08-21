import { EmbedBuilder } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe.sequential("reliable Discord delivery", () => {
  beforeEach(async () => {
    discord.fetch.mockReset();
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
