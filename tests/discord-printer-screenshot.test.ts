import { MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrinter: vi.fn(),
  takeScreenshot: vi.fn(),
  createPrintThread: vi.fn()
}));

vi.mock("../src/services/database", () => ({ getPrinter: mocks.getPrinter }));
vi.mock("../src/services/printer-manager", () => ({
  printerManager: { takeScreenshot: mocks.takeScreenshot }
}));
vi.mock("../src/services/discord/bot", () => ({ createPrintThread: mocks.createPrintThread }));

describe("printer screenshot command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrinter.mockReturnValue({
      id: "printer-1",
      name: "Workshop P1S",
      forumChannelId: "forum-1"
    });
    mocks.takeScreenshot.mockResolvedValue(Buffer.from("jpeg"));
    mocks.createPrintThread.mockResolvedValue("thread-1");
  });

  const interaction = () => ({
    options: { getString: vi.fn(() => "printer-1") },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn()
  });

  it("creates a public forum notification with the captured image", async () => {
    const { handlePrinterScreenshot } = await import("../src/services/discord/commands/printer-screenshot");
    const request = interaction();

    await handlePrinterScreenshot(request as never);

    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.takeScreenshot).toHaveBeenCalledWith("printer-1");
    expect(mocks.createPrintThread).toHaveBeenCalledWith(
      expect.stringMatching(/^camera-test:printer-1:/),
      "📸 Test caméra — Workshop P1S",
      expect.anything(),
      [{ name: "screenshot.jpg", buffer: Buffer.from("jpeg") }],
      ["Attention", "Workshop P1S"],
      "forum-1"
    );
    const embed = mocks.createPrintThread.mock.calls[0]![2];
    expect(embed.data).toMatchObject({
      title: "📸 Test de capture — Workshop P1S",
      image: { url: "attachment://screenshot.jpg" }
    });
    expect(request.editReply).toHaveBeenCalledWith("✅ Notification de test créée dans <#thread-1>.");
  });

  it("reports capture failure without creating an empty forum post", async () => {
    mocks.takeScreenshot.mockResolvedValue(null);
    const { handlePrinterScreenshot } = await import("../src/services/discord/commands/printer-screenshot");
    const request = interaction();

    await handlePrinterScreenshot(request as never);

    expect(mocks.createPrintThread).not.toHaveBeenCalled();
    expect(request.editReply).toHaveBeenCalledWith(
      "❌ Impossible de capturer une image. Vérifiez la connexion, le port RTC et les logs TLS de l'imprimante."
    );
  });
});
