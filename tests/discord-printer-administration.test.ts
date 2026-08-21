import { ChannelType, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";

const mocks = vi.hoisted(() => ({
  addPrinter: vi.fn(),
  ensurePrinterTag: vi.fn(),
  getAllPrinters: vi.fn(),
  getPrinter: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  removePrinter: vi.fn(),
  updatePrinter: vi.fn(),
  getPrinterStatus: vi.fn(),
  startPrinter: vi.fn(),
  stopPrinter: vi.fn(),
  restartPrinter: vi.fn()
}));

vi.mock("../src/services/database", () => ({
  addPrinter: mocks.addPrinter,
  getAllPrinters: mocks.getAllPrinters,
  getPrinter: mocks.getPrinter,
  removePrinter: mocks.removePrinter,
  updatePrinter: mocks.updatePrinter
}));
vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ error: mocks.loggerError, info: mocks.loggerInfo })
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

type MockInteraction = ChatInputCommandInteraction & {
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
};

const interaction = (values: Record<string, unknown> = {}): MockInteraction =>
  ({
    options: {
      getString: vi.fn((name: string) => values[name] ?? (name === "name" ? printer.id : null)),
      getInteger: vi.fn((name: string) => values[name] ?? null),
      getBoolean: vi.fn((name: string) => values[name] ?? null),
      getChannel: vi.fn((name: string) => values[name] ?? null)
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn()
  }) as unknown as MockInteraction;

describe("printer administration commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrinter.mockReturnValue(printer);
    mocks.getAllPrinters.mockReturnValue([]);
    mocks.getPrinterStatus.mockReturnValue({ running: true, connected: true });
    mocks.updatePrinter.mockImplementation((_id: string, updates: Partial<PrinterConfig>) => ({
      ...printer,
      ...updates
    }));
    mocks.addPrinter.mockReturnValue(printer);
    mocks.removePrinter.mockReturnValue(true);
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

    await handlePrinterStatus(request);

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

  it("répartit 26 imprimantes sur plusieurs embeds valides", async () => {
    const printers = Array.from({ length: 26 }, (_, index) => ({
      ...printer,
      id: `printer-${index + 1}`,
      name: `Printer ${index + 1}`
    }));
    mocks.getAllPrinters.mockReturnValue(printers);
    const { handlePrinterList } = await import("../src/services/discord/commands/printer-list");
    const request = interaction();

    await handlePrinterList(request);

    expect(request.reply).toHaveBeenCalledWith({
      embeds: [expect.anything(), expect.anything()],
      flags: MessageFlags.Ephemeral
    });
    const embeds = request.reply.mock.calls[0][0].embeds.map((embed: { toJSON: () => { fields?: unknown[] } }) =>
      embed.toJSON()
    );
    expect(embeds.map((embed: { fields?: unknown[] }) => embed.fields?.length)).toEqual([25, 1]);
    expect(embeds.every((embed: { fields?: unknown[] }) => (embed.fields?.length ?? 0) <= 25)).toBe(true);
    expect(request.followUp).not.toHaveBeenCalled();
  });

  it("reconnecte immédiatement une imprimante active", async () => {
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction();

    await handlePrinterReconnect(request);

    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
    expect(request.editReply).toHaveBeenCalledWith(`✅ Imprimante **${printer.name}** reconnectée.`);
  });

  it("démarre un nouveau cycle via restart quand l'instance activée est indisponible", async () => {
    mocks.getPrinterStatus.mockReturnValue({ running: false, connected: false });
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction();

    await handlePrinterReconnect(request);

    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
    expect(request.editReply).toHaveBeenCalledWith(`✅ Imprimante **${printer.name}** reconnectée.`);
  });

  it("refuse de démarrer implicitement une imprimante désactivée", async () => {
    mocks.getPrinter.mockReturnValue({ ...printer, enabled: false });
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction();

    await handlePrinterReconnect(request);

    expect(mocks.restartPrinter).not.toHaveBeenCalled();
    expect(request.deferReply).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith({
      content: `❌ L'imprimante **${printer.name}** est désactivée. Réactivez-la avec \`/printer edit\` avant de demander une reconnexion.`,
      flags: MessageFlags.Ephemeral
    });
  });

  it("signale clairement une imprimante inexistante", async () => {
    mocks.getPrinter.mockReturnValue(undefined);
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction({ name: "missing" });

    await handlePrinterReconnect(request);

    expect(mocks.restartPrinter).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith({
      content: "❌ Imprimante **missing** non trouvée",
      flags: MessageFlags.Ephemeral
    });
  });

  it("signale un échec de reconnexion retourné par le manager", async () => {
    mocks.restartPrinter.mockResolvedValue(false);
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction();

    await handlePrinterReconnect(request);

    expect(request.editReply).toHaveBeenCalledWith(
      `❌ La reconnexion immédiate de l'imprimante **${printer.name}** a échoué. Vérifiez sa configuration, sa disponibilité et les logs.`
    );
  });

  it("laisse le traitement global gérer une exception du manager après le defer", async () => {
    mocks.restartPrinter.mockRejectedValue(new Error("disconnect failed"));
    const { handlePrinterReconnect } = await import("../src/services/discord/commands/printer-reconnect");
    const request = interaction();

    await expect(handlePrinterReconnect(request)).rejects.toThrow("disconnect failed");

    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(request.editReply).not.toHaveBeenCalled();
  });

  it("redémarre après un renommage pour actualiser la configuration runtime", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ new_name: "Atelier X1C" });

    await handlePrinterEdit(request);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { name: "Atelier X1C" });
    expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-1", "Atelier X1C");
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
  });

  it("redémarre après un déplacement de forum pour actualiser la configuration runtime", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ channel: { id: "forum-2", type: ChannelType.GuildForum } });

    await handlePrinterEdit(request);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { forumChannelId: "forum-2" });
    expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-2", printer.name);
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
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

    await handlePrinterAdd(request);

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

    await handlePrinterEdit(request);

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

    await handlePrinterEdit(request);

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

    await handlePrinterEdit(request);

    expect(mocks.startPrinter).toHaveBeenCalledWith(printer.id);
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
    expect(mocks.restartPrinter).not.toHaveBeenCalled();
  });

  it("redémarre une imprimante active lorsque le port MQTT change", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ port: 1883 });

    await handlePrinterEdit(request);

    expect(mocks.updatePrinter).toHaveBeenCalledWith(printer.id, { port: 1883 });
    expect(mocks.restartPrinter).toHaveBeenCalledWith(printer.id);
    expect(mocks.startPrinter).not.toHaveBeenCalled();
    expect(mocks.stopPrinter).not.toHaveBeenCalled();
  });

  it("refuse un port hors limites même avec une ancienne déclaration Discord", async () => {
    const { handlePrinterEdit } = await import("../src/services/discord/commands/printer-edit");
    const request = interaction({ port: 65_536 });

    await handlePrinterEdit(request);

    expect(request.reply).toHaveBeenCalledWith({
      content: "❌ Les ports doivent être compris entre 1 et 65535",
      flags: MessageFlags.Ephemeral
    });
    expect(mocks.updatePrinter).not.toHaveBeenCalled();
  });

  describe("printer remove", () => {
    it("refuse une imprimante inconnue sans modifier le runtime ou la configuration", async () => {
      mocks.getPrinter.mockReturnValue(null);
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction({ name: "missing" });

      await handlePrinterRemove(request);

      expect(mocks.getPrinterStatus).not.toHaveBeenCalled();
      expect(mocks.stopPrinter).not.toHaveBeenCalled();
      expect(mocks.removePrinter).not.toHaveBeenCalled();
      expect(request.reply).toHaveBeenCalledWith({
        content: "❌ Imprimante **missing** non trouvée",
        flags: MessageFlags.Ephemeral
      });
    });

    it("ne supprime pas la configuration lorsque l'arrêt d'une imprimante active lève une exception", async () => {
      mocks.stopPrinter.mockRejectedValue(new Error("disconnect failed"));
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction();

      await expect(handlePrinterRemove(request)).rejects.toThrow("disconnect failed");

      expect(mocks.stopPrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.removePrinter).not.toHaveBeenCalled();
      expect(request.reply).not.toHaveBeenCalled();
    });

    it("ne supprime pas la configuration lorsque l'arrêt d'une imprimante active échoue", async () => {
      mocks.stopPrinter.mockResolvedValue(false);
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction();

      await handlePrinterRemove(request);

      expect(mocks.removePrinter).not.toHaveBeenCalled();
      expect(request.reply).toHaveBeenCalledWith({
        content: `❌ Impossible de supprimer l'imprimante **${printer.name}**`,
        flags: MessageFlags.Ephemeral
      });
    });

    it("supprime une imprimante déjà arrêtée même si le manager n'avait aucun runtime", async () => {
      mocks.getPrinterStatus.mockReturnValue({ running: false, connected: false });
      mocks.stopPrinter.mockResolvedValue(false);
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction();

      await handlePrinterRemove(request);

      expect(mocks.stopPrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.removePrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.startPrinter).not.toHaveBeenCalled();
      expect(request.reply).toHaveBeenCalledWith({
        content: `✅ Imprimante **${printer.name}** supprimée`,
        flags: MessageFlags.Ephemeral
      });
    });

    it("redémarre une imprimante active lorsque la suppression persistée échoue", async () => {
      mocks.removePrinter.mockReturnValue(false);
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction();

      await handlePrinterRemove(request);

      expect(mocks.stopPrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.removePrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.startPrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.stopPrinter.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.removePrinter.mock.invocationCallOrder[0]
      );
      expect(mocks.removePrinter.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.startPrinter.mock.invocationCallOrder[0]
      );
      expect(request.reply).toHaveBeenCalledWith({
        content: `❌ Impossible de supprimer l'imprimante **${printer.name}**`,
        flags: MessageFlags.Ephemeral
      });
    });

    it("arrête puis supprime une imprimante active avant de répondre et journaliser", async () => {
      const { handlePrinterRemove } = await import("../src/services/discord/commands/printer-remove");
      const request = interaction();

      await handlePrinterRemove(request);

      expect(mocks.stopPrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.removePrinter).toHaveBeenCalledWith(printer.id);
      expect(mocks.startPrinter).not.toHaveBeenCalled();
      expect(mocks.stopPrinter.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.removePrinter.mock.invocationCallOrder[0]
      );
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        { printerId: printer.id, name: printer.name },
        "Printer removed via command"
      );
      expect(request.reply).toHaveBeenCalledWith({
        content: `✅ Imprimante **${printer.name}** supprimée`,
        flags: MessageFlags.Ephemeral
      });
    });
  });

  describe("printer add", () => {
    const addValues = {
      name: "Atelier X1C",
      ip: "192.0.2.2",
      serial: "SERIAL-2",
      access_code: "secret-2",
      channel: { id: "forum-2", type: ChannelType.GuildForum }
    };

    it("refuse un salon non-forum avant toute préparation ou mutation", async () => {
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction({ ...addValues, channel: { id: "text-1", type: ChannelType.GuildText } });

      await handlePrinterAdd(request);

      expect(request.deferReply).not.toHaveBeenCalled();
      expect(mocks.ensurePrinterTag).not.toHaveBeenCalled();
      expect(mocks.addPrinter).not.toHaveBeenCalled();
      expect(mocks.startPrinter).not.toHaveBeenCalled();
      expect(request.reply).toHaveBeenCalledWith({
        content: "❌ Le channel doit être un **forum channel**",
        flags: MessageFlags.Ephemeral
      });
    });

    it("refuse l'ajout lorsque le forum n'a plus de capacité de tags", async () => {
      mocks.ensurePrinterTag.mockResolvedValue({ status: "capacity", maximum: 20, required: 21 });
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction(addValues);

      await handlePrinterAdd(request);

      expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(mocks.addPrinter).not.toHaveBeenCalled();
      expect(mocks.startPrinter).not.toHaveBeenCalled();
      expect(request.editReply).toHaveBeenCalledWith(
        "❌ Le forum a atteint sa limite de 20 tags. Supprimez un tag avant d'ajouter l'imprimante."
      );
    });

    it("signale un doublon ou échec de persistance sans démarrer de runtime", async () => {
      mocks.addPrinter.mockReturnValue(null);
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction(addValues);

      await handlePrinterAdd(request);

      expect(mocks.ensurePrinterTag).toHaveBeenCalledWith("forum-2", "Atelier X1C");
      expect(mocks.startPrinter).not.toHaveBeenCalled();
      expect(request.editReply).toHaveBeenCalledWith("❌ Une imprimante avec ce nom existe déjà");
    });

    it("persiste le payload exact avec les ports par défaut puis démarre l'imprimante", async () => {
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction(addValues);

      await handlePrinterAdd(request);

      expect(mocks.addPrinter).toHaveBeenCalledWith({
        name: "Atelier X1C",
        ip: "192.0.2.2",
        port: 8883,
        rtcPort: 6000,
        serial: "SERIAL-2",
        accessCode: "secret-2",
        forumChannelId: "forum-2",
        enabled: true
      });
      expect(mocks.ensurePrinterTag.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.addPrinter.mock.invocationCallOrder[0]
      );
      expect(mocks.addPrinter.mock.invocationCallOrder[0]).toBeLessThan(mocks.startPrinter.mock.invocationCallOrder[0]);
      expect(mocks.startPrinter).toHaveBeenCalledWith(printer.id);
      expect(request.editReply).toHaveBeenCalledWith(
        "✅ Imprimante **Atelier X1C** ajoutée et démarrée\n" +
          "📍 IP: `192.0.2.2:8883`\n" +
          "🏷️ Serial: `SERIAL-2`\n" +
          "📺 Forum: <#forum-2>"
      );
    });

    it("persiste et affiche les ports personnalisés", async () => {
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction({ ...addValues, port: 1883, rtc_port: 7000 });

      await handlePrinterAdd(request);

      expect(mocks.addPrinter).toHaveBeenCalledWith(expect.objectContaining({ port: 1883, rtcPort: 7000 }));
      expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining("📍 IP: `192.0.2.2:1883`"));
    });

    it("conserve la configuration et signale un démarrage retourné en échec", async () => {
      mocks.startPrinter.mockResolvedValue(false);
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction(addValues);

      await handlePrinterAdd(request);

      expect(mocks.addPrinter).toHaveBeenCalledOnce();
      expect(request.editReply).toHaveBeenCalledWith(
        "⚠️ Imprimante **Atelier X1C** ajoutée mais impossible de la démarrer\n" +
          "Vérifiez la configuration réseau et redémarrez le bot."
      );
    });

    it("laisse le traitement global répondre lorsqu'un démarrage lève une exception", async () => {
      mocks.startPrinter.mockRejectedValue(new Error("start failed"));
      const { handlePrinterAdd } = await import("../src/services/discord/commands/printer-add");
      const request = interaction(addValues);

      await expect(handlePrinterAdd(request)).rejects.toThrow("start failed");

      expect(mocks.addPrinter).toHaveBeenCalledOnce();
      expect(request.deferReply).toHaveBeenCalledOnce();
      expect(request.editReply).not.toHaveBeenCalled();
    });
  });

  describe("printer list", () => {
    it("répond avec l'état vide exact", async () => {
      const { handlePrinterList } = await import("../src/services/discord/commands/printer-list");
      const request = interaction();

      await handlePrinterList(request);

      expect(request.reply).toHaveBeenCalledWith({
        content: "📭 Aucune imprimante configurée\n\nUtilisez `/printer add` pour en ajouter une",
        flags: MessageFlags.Ephemeral
      });
      expect(request.followUp).not.toHaveBeenCalled();
    });

    it("affiche les états connecté, en connexion, arrêté et désactivé", async () => {
      mocks.getAllPrinters.mockReturnValue([
        { ...printer, id: "connected", name: "Connected" },
        { ...printer, id: "connecting", name: "Connecting" },
        { ...printer, id: "disabled", name: "Disabled", enabled: false }
      ]);
      mocks.getPrinterStatus.mockImplementation((id: string) => ({
        running: id !== "disabled",
        connected: id === "connected"
      }));
      const { handlePrinterList } = await import("../src/services/discord/commands/printer-list");
      const request = interaction();

      await handlePrinterList(request);

      const fields = request.reply.mock.calls[0][0].embeds[0].toJSON().fields;
      expect(fields?.map((field: { name: string }) => field.name)).toEqual([
        "🟢 Connected",
        "🟡 Connecting",
        "🔴 Disabled (désactivée)"
      ]);
    });

    it("tronque les champs longs sans couper une paire de substitution Unicode", async () => {
      mocks.getAllPrinters.mockReturnValue([
        {
          ...printer,
          name: `x${"😀".repeat(200)}`,
          ip: "i".repeat(1_100),
          serial: "s".repeat(1_100),
          forumChannelId: "f".repeat(1_100)
        }
      ]);
      const { handlePrinterList } = await import("../src/services/discord/commands/printer-list");
      const request = interaction();

      await handlePrinterList(request);

      const field = request.reply.mock.calls[0][0].embeds[0].toJSON().fields?.[0];
      expect(field?.name.length).toBeLessThanOrEqual(256);
      expect(field?.value.length).toBeLessThanOrEqual(1_024);
      expect(field?.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    });

    it("répartit un volume important sur plusieurs réponses dans toutes les limites Discord", async () => {
      mocks.getAllPrinters.mockReturnValue(
        Array.from({ length: 60 }, (_, index) => ({
          ...printer,
          id: `long-printer-${index}`,
          name: `Printer ${index}`,
          serial: `${index}-${"s".repeat(1_100)}`
        }))
      );
      const { handlePrinterList } = await import("../src/services/discord/commands/printer-list");
      const request = interaction();

      await handlePrinterList(request);

      const responses = [request.reply.mock.calls[0][0], ...request.followUp.mock.calls.map(call => call[0])];
      expect(request.followUp.mock.calls.length).toBeGreaterThan(1);
      expect(responses.every(response => response.flags === MessageFlags.Ephemeral)).toBe(true);
      for (const response of responses) {
        expect(response.embeds.length).toBeLessThanOrEqual(10);
        const embeds = response.embeds.map((embed: { toJSON: () => Record<string, unknown> }) => embed.toJSON());
        expect(
          embeds.reduce((total: number, embed: Record<string, unknown>) => {
            const fields = (embed.fields ?? []) as Array<{ name: string; value: string }>;
            expect(fields.length).toBeLessThanOrEqual(25);
            return (
              total +
              String(embed.title ?? "").length +
              String((embed.footer as { text?: string } | undefined)?.text ?? "").length +
              fields.reduce((fieldTotal, field) => fieldTotal + field.name.length + field.value.length, 0)
            );
          }, 0)
        ).toBeLessThanOrEqual(6_000);
      }
    });
  });
});
