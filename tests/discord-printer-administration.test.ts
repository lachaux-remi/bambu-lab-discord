import { ChannelType, MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";

const mocks = vi.hoisted(() => ({
  addPrinter: vi.fn(),
  ensurePrinterTag: vi.fn(),
  getPrinter: vi.fn(),
  updatePrinter: vi.fn(),
  getPrinterStatus: vi.fn(),
  startPrinter: vi.fn(),
  stopPrinter: vi.fn(),
  restartPrinter: vi.fn()
}));

vi.mock("../src/services/database", () => ({
  addPrinter: mocks.addPrinter,
  getPrinter: mocks.getPrinter,
  updatePrinter: mocks.updatePrinter
}));
vi.mock("../src/services/printer-manager", () => ({
  printerManager: {
    getPrinterStatus: mocks.getPrinterStatus,
    startPrinter: mocks.startPrinter,
    stopPrinter: mocks.stopPrinter,
    restartPrinter: mocks.restartPrinter
  }
}));
vi.mock("../src/services/discord/bot", () => ({ ensurePrinterTag: mocks.ensurePrinterTag }));

const printer: PrinterConfig = {
  id: "printer-1",
  name: "Atelier P1S",
  ip: "192.0.2.1",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL",
  accessCode: "secret",
  forumChannelId: "forum-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1
};

const interaction = (values: Record<string, unknown> = {}) => ({
  options: {
    getString: vi.fn((name: string) => values[name] ?? (name === "name" ? printer.id : null)),
    getInteger: vi.fn((name: string) => values[name] ?? null),
    getBoolean: vi.fn((name: string) => values[name] ?? null),
    getChannel: vi.fn((name: string) => values[name] ?? null)
  },
  reply: vi.fn(),
  deferReply: vi.fn(),
  editReply: vi.fn()
});

describe("printer administration commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrinter.mockReturnValue(printer);
    mocks.getPrinterStatus.mockReturnValue({ running: true, connected: true });
    mocks.updatePrinter.mockImplementation((_id: string, updates: Partial<PrinterConfig>) => ({
      ...printer,
      ...updates
    }));
    mocks.addPrinter.mockReturnValue(printer);
    mocks.ensurePrinterTag.mockResolvedValue({ status: "ready", created: [] });
    mocks.startPrinter.mockResolvedValue(true);
    mocks.stopPrinter.mockResolvedValue(true);
    mocks.restartPrinter.mockResolvedValue(true);
  });

  it("affiche l'état MQTT et les informations d'impression disponibles", async () => {
    mocks.getPrinterStatus.mockReturnValue({
      running: true,
      connected: true,
      print: {
        state: PrintState.RUNNING,
        project: "Benchy",
        progressPercent: 42,
        currentLayer: 21,
        maxLayers: 50,
        remainingTime: 75
      }
    });
    const { handlePrinterStatus } = await import("../src/services/discord/commands/printer-status");
    const request = interaction();

    await handlePrinterStatus(request as never);

    expect(request.reply).toHaveBeenCalledWith({ embeds: [expect.anything()], flags: MessageFlags.Ephemeral });
    const embed = request.reply.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Gestionnaire", value: "Démarré" }),
        expect.objectContaining({ name: "MQTT", value: "Connecté" }),
        expect.objectContaining({ name: "État d'impression", value: "Impression en cours" }),
        expect.objectContaining({ name: "Projet", value: "Benchy" }),
        expect.objectContaining({ name: "Progression", value: "42 %" }),
        expect.objectContaining({ name: "Couche", value: "21 / 50" }),
        expect.objectContaining({ name: "Temps restant", value: "1 heure 15 minutes" })
      ])
    );
  });

  it("crée le nouveau tag lors d'un renommage sans supprimer ni redémarrer", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ new_name: "Atelier X1C" });

    await handlePrinterEdit(request as never);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { name: "Atelier X1C" });
    expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-1", "Atelier X1C");
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).not.toHaveBeenCalled();
  });

  it("n'ajoute ni ne démarre une imprimante si son tag ne peut pas être préparé", async () => {
    mocks.ensurePrinterTag.mockResolvedValue({ status: "failed" });
    const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
    const request = interaction({
      name: "Atelier X1C",
      ip: "192.0.2.2",
      serial: "SERIAL-2",
      access_code: "secret-2",
      channel: { id: "forum-2", type: ChannelType.GuildForum }
    });

    await handlePrinterAdd(request as never);

    expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-2", "Atelier X1C");
    expect(mocks.addPrinter).not.toHaveBeenCalled();
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(request.editReply).toHaveBeenCalledWith(
      "❌ Impossible de préparer les tags du forum. Aucune imprimante n'a été ajoutée."
    );
  });

  it("conserve la configuration et le runtime lors d'un échec de tags avant renommage et déplacement", async () => {
    mocks.ensurePrinterTag.mockResolvedValue({ status: "capacity", maximum: 20, required: 21 });
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({
      new_name: "Atelier X1C",
      channel: { id: "forum-2", type: ChannelType.GuildForum }
    });

    await handlePrinterEdit(request as never);

    expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-2", "Atelier X1C");
    expect(mocks.updatePrinter).not.toHaveBeenCalled();
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).not.toHaveBeenCalled();
    expect(request.editReply).toHaveBeenCalledWith(
      "❌ Le forum a atteint sa limite de 20 tags. Supprimez un tag avant de modifier l'imprimante."
    );
  });

  it("arrête immédiatement une imprimante désactivée", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ enabled: false });

    await handlePrinterEdit(request as never);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { enabled: false });
    expect(mocks.stopPrinter).toHaveBeenCalledWith(printer.id);
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).not.toHaveBeenCalled();
  });

  it("démarre immédiatement une imprimante réactivée", async () => {
    const disabledPrinter = { ...printer, enabled: false };
    mocks.getPrinter.mockReturnValue(disabledPrinter);
    mocks.getPrinterStatus.mockReturnValue({ running: false, connected: false });
    mocks.updatePrinter.mockImplementation((_id: string, updates: Partial<PrinterConfig>) => ({
      ...disabledPrinter,
      ...updates
    }));
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ enabled: true });

    await handlePrinterEdit(request as never);

    expect(mocks.startPrinter).toHaveBeenCalledWith(printer.id);
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).not.toHaveBeenCalled();
  });

  it("redémarre une imprimante active lorsque le port MQTT change", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ port: 1883 });

    await handlePrinterEdit(request as never);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { port: 1883 });
    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
  });

  it("refuse un port hors limites même avec une ancienne déclaration Discord", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ port: 65_536 });

    await handlePrinterEdit(request as never);

    expect(request.reply).toHaveBeenCalledWith({
      content: "❌ Les ports doivent être compris entre 1 et 65535",
      flags: MessageFlags.Ephemeral
    });
    expect(mocks.updatePrinter).not.toHaveBeenCalled();
  });
});
