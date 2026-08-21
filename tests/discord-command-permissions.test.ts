import { MessageFlags, PermissionsBitField } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  client: { on: vi.fn() },
  loggerError: vi.fn(),
  add: vi.fn(),
  edit: vi.fn(),
  list: vi.fn(),
  reconnect: vi.fn(),
  remove: vi.fn(),
  screenshot: vi.fn(),
  status: vi.fn()
}));

vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ error: seams.loggerError, info: vi.fn() })
}));
vi.mock("../src/services/discord/bot", () => ({ getDiscordClient: () => seams.client }));
vi.mock("../src/services/discord/commands/printer-add", () => ({ handlePrinterAdd: seams.add }));
vi.mock("../src/services/discord/commands/printer-edit", () => ({ handlePrinterEdit: seams.edit }));
vi.mock("../src/services/discord/commands/printer-list", () => ({ handlePrinterList: seams.list }));
vi.mock("../src/services/discord/commands/printer-reconnect", () => ({ handlePrinterReconnect: seams.reconnect }));
vi.mock("../src/services/discord/commands/printer-remove", () => ({ handlePrinterRemove: seams.remove }));
vi.mock("../src/services/discord/commands/printer-screenshot", () => ({ handlePrinterScreenshot: seams.screenshot }));
vi.mock("../src/services/discord/commands/printer-status", () => ({ handlePrinterStatus: seams.status }));

const getInstalledHandler = (index: number): ((interaction: unknown) => void) => {
  const handler = seams.client.on.mock.calls[index]?.[1];
  if (typeof handler !== "function") {
    throw new Error(`Expected Discord interaction handler at index ${index}`);
  }
  return handler as (interaction: unknown) => void;
};

describe("printer slash command permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const installHandler = async () => {
    const { setupCommandHandlers } = await import("../src/services/discord/commands");
    setupCommandHandlers();
    return getInstalledHandler(0);
  };

  const installAutocompleteHandler = async () => {
    const { setupCommandHandlers } = await import("../src/services/discord/commands");
    setupCommandHandlers();
    return getInstalledHandler(1);
  };

  const interaction = (permissions: PermissionsBitField, subcommand = "list") => ({
    commandName: "printer",
    isChatInputCommand: () => true,
    memberPermissions: permissions,
    options: { getSubcommand: vi.fn(() => subcommand) },
    reply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    replied: false,
    deferred: false
  });

  it("rejects before dispatch when the member lacks ManageGuild", async () => {
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField([]));

    await handler(request);

    expect(request.reply).toHaveBeenCalledWith({
      content: "❌ Vous devez avoir la permission **Gérer le serveur** pour utiliser cette commande.",
      flags: MessageFlags.Ephemeral
    });
    expect(request.options.getSubcommand).not.toHaveBeenCalled();
    expect(seams.list).not.toHaveBeenCalled();
  });

  it.each(["ManageGuild", "Administrator"] as const)("dispatches for %s", async permission => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits[permission]));

    await handler(request);

    expect(seams.list).toHaveBeenCalledWith(request);
    expect(request.reply).not.toHaveBeenCalled();
  });

  it("dispatches the screenshot subcommand through the protected printer command", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild), "screenshot");

    await handler(request);

    expect(seams.screenshot).toHaveBeenCalledWith(request);
  });

  it("dispatches the status subcommand through the protected printer command", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild), "status");

    await handler(request);

    expect(seams.status).toHaveBeenCalledWith(request);
  });

  it("dispatches reconnect for a member with ManageGuild", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild), "reconnect");

    await handler(request);

    expect(seams.reconnect).toHaveBeenCalledWith(request);
  });

  it("uses the global deferred error response when reconnect throws", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild), "reconnect");
    request.deferred = true;
    seams.reconnect.mockRejectedValueOnce(new Error("reconnect failed"));

    handler(request);

    await vi.waitFor(() => expect(request.editReply).toHaveBeenCalledWith("Une erreur est survenue"));
    expect(request.reply).not.toHaveBeenCalled();
  });

  it("edits a deferred reply when the command fails after deferReply", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild));
    request.deferred = true;
    seams.list.mockRejectedValueOnce(new Error("failure after defer"));

    handler(request);

    await vi.waitFor(() => expect(request.editReply).toHaveBeenCalledWith("Une erreur est survenue"));
    expect(request.reply).not.toHaveBeenCalled();
    expect(request.followUp).not.toHaveBeenCalled();
  });

  it("sends one follow-up when a command fails after an initial reply", async () => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild));
    request.replied = true;
    seams.list.mockRejectedValueOnce(new Error("failure after reply"));

    handler(request);

    await vi.waitFor(() =>
      expect(request.followUp).toHaveBeenCalledWith({
        content: "Une erreur est survenue",
        flags: MessageFlags.Ephemeral
      })
    );
    expect(request.reply).not.toHaveBeenCalled();
    expect(request.editReply).not.toHaveBeenCalled();
  });

  it.each([
    { responseMethod: "reply", replied: false, deferred: false },
    { responseMethod: "editReply", replied: false, deferred: true },
    { responseMethod: "followUp", replied: true, deferred: false }
  ] as const)("handles rejection from both a command and $responseMethod", async state => {
    const { PermissionFlagsBits } = await import("discord.js");
    const handler = await installHandler();
    const request = interaction(new PermissionsBitField(PermissionFlagsBits.ManageGuild));
    const commandError = new Error("command failed");
    const responseError = new Error("error response failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    request.replied = state.replied;
    request.deferred = state.deferred;
    seams.list.mockRejectedValueOnce(commandError);
    request[state.responseMethod].mockRejectedValueOnce(responseError);
    process.on("unhandledRejection", onUnhandled);

    try {
      handler(request);
      await vi.waitFor(() =>
        expect(seams.loggerError).toHaveBeenCalledWith(
          { error: responseError, commandError, subcommand: "list" },
          "Failed to send command error response"
        )
      );
      await new Promise(resolve => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("handles and logs a rejected empty autocomplete response", async () => {
    const handler = await installAutocompleteHandler();
    const responseError = new Error("autocomplete response failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    const request = {
      commandName: "printer",
      isAutocomplete: () => true,
      memberPermissions: new PermissionsBitField([]),
      respond: vi.fn().mockRejectedValue(responseError)
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      handler(request);
      await vi.waitFor(() =>
        expect(seams.loggerError).toHaveBeenCalledWith({ error: responseError }, "Error handling autocomplete")
      );
      await new Promise(resolve => setImmediate(resolve));

      expect(request.respond).toHaveBeenCalledWith([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
