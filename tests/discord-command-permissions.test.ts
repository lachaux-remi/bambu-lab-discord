import { MessageFlags, PermissionsBitField } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  client: { on: vi.fn() },
  add: vi.fn(),
  edit: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  screenshot: vi.fn()
}));

vi.mock("../src/services/discord/bot", () => ({ getDiscordClient: () => seams.client }));
vi.mock("../src/services/discord/commands/printer-add", () => ({ handlePrinterAdd: seams.add }));
vi.mock("../src/services/discord/commands/printer-edit", () => ({ handlePrinterEdit: seams.edit }));
vi.mock("../src/services/discord/commands/printer-list", () => ({ handlePrinterList: seams.list }));
vi.mock("../src/services/discord/commands/printer-remove", () => ({ handlePrinterRemove: seams.remove }));
vi.mock("../src/services/discord/commands/printer-screenshot", () => ({ handlePrinterScreenshot: seams.screenshot }));

describe("printer slash command permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const installHandler = async () => {
    const { setupCommandHandlers } = await import("../src/services/discord/commands");
    setupCommandHandlers();
    return seams.client.on.mock.calls[0][1] as (interaction: unknown) => Promise<void>;
  };

  const interaction = (permissions: PermissionsBitField, subcommand = "list") => ({
    commandName: "printer",
    isChatInputCommand: () => true,
    memberPermissions: permissions,
    options: { getSubcommand: vi.fn(() => subcommand) },
    reply: vi.fn(),
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
});
