import { readFile } from "node:fs/promises";
import { type Server, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { getLogger } from "../../libs/logger";
import { DISCORD_ATTACHMENT_SIZE_LIMIT } from "../../services/discord/payload";
import type { DiscordE2EOptions } from "./session";
import { type PlaceholderKind, WebBenchController } from "./web-controller";

const logger = getLogger("MQTT-MockPrinter-Web");
const STATIC_DIRECTORY = join(__dirname, "web");
const JSON_BODY_LIMIT = 2 * 1024 * 1024;
const MUTATION_HEADER = "x-mock-printer-ui";

export interface WebBenchServerOptions {
  controller?: WebBenchController;
  discord?: DiscordE2EOptions;
  host?: string;
  port?: number;
}

export interface RunningWebBenchServer {
  close: () => Promise<void>;
  controller: WebBenchController;
  host: string;
  port: number;
  server: Server;
}

const contentTypeFor = (path: string): string => {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/html; charset=utf-8";
  }
};

const imageContentType = (buffer: Buffer): "image/jpeg" | "image/png" =>
  buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png" : "image/jpeg";

const writeJson = (response: ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
};

const readBody = async (request: NodeJS.ReadableStream, maximum: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value: unknown = chunk;
    const buffer =
      typeof value === "string"
        ? Buffer.from(value)
        : value instanceof Uint8Array
          ? Buffer.from(value)
          : (() => {
              throw new Error("request body contained an unsupported chunk");
            })();
    length += buffer.length;
    if (length > maximum) {
      throw new Error(`request body exceeds ${maximum} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const readJson = async (request: NodeJS.ReadableStream): Promise<unknown> => {
  const body = await readBody(request, JSON_BODY_LIMIT);
  if (body.length === 0) {
    return {};
  }
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new Error("request body must be valid JSON");
  }
};

const ensureMutationRequest = (request: { headers: Record<string, string | string[] | undefined> }): void => {
  if (request.headers[MUTATION_HEADER] !== "1") {
    throw new Error(`mutating requests require ${MUTATION_HEADER}: 1`);
  }
};

const serveStatic = async (pathname: string, response: ServerResponse): Promise<void> => {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = normalize(requested);
  if (path.startsWith("..") || path.includes("/..")) {
    writeJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(join(STATIC_DIRECTORY, path));
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "content-type": contentTypeFor(path),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    });
    response.end(content);
  } catch {
    writeJson(response, 404, { error: "Not found" });
  }
};

export const startWebBenchServer = async (options: WebBenchServerOptions = {}): Promise<RunningWebBenchServer> => {
  const controller = options.controller ?? new WebBenchController({ discord: options.discord });
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = request.method ?? "GET";
      const placeholderKind: PlaceholderKind | undefined =
        path === "/api/placeholder/project" ? "project" : path === "/api/placeholder/camera" ? "camera" : undefined;

      if (method === "GET" && path === "/api/health") {
        writeJson(response, 200, { status: "ok" });
        return;
      }
      if (method === "GET" && path === "/api/state") {
        writeJson(response, 200, controller.state());
        return;
      }
      if (method === "GET" && placeholderKind) {
        const placeholder = controller.getPlaceholder(placeholderKind);
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": placeholder.length,
          "content-type": imageContentType(placeholder),
          "x-content-type-options": "nosniff"
        });
        response.end(placeholder);
        return;
      }
      if (method === "GET" && path === "/api/scenario/export") {
        const scenario = JSON.stringify(controller.exportScenario(), null, 2);
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="mock-printer-scenario.json"',
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff"
        });
        response.end(`${scenario}\n`);
        return;
      }
      if (method === "PUT" && placeholderKind) {
        ensureMutationRequest(request);
        const body = await readBody(request, DISCORD_ATTACHMENT_SIZE_LIMIT + 1);
        controller.upload(placeholderKind, body, request.headers["content-type"] ?? "");
        writeJson(response, 200, controller.state());
        return;
      }
      if (method === "POST") {
        ensureMutationRequest(request);
        const body = await readJson(request);
        switch (path) {
          case "/api/discord/inspect":
            writeJson(response, 200, await controller.inspectDiscordTarget());
            return;
          case "/api/session/start":
            await controller.start(body);
            break;
          case "/api/session/stop":
            await controller.stop();
            break;
          case "/api/actions":
            await controller.execute(body);
            break;
          case "/api/auto/start":
            await controller.startAuto(body);
            break;
          case "/api/controls/pause":
            await controller.pause();
            break;
          case "/api/controls/resume":
            await controller.resume();
            break;
          case "/api/controls/finish":
            await controller.finish(body);
            break;
          case "/api/mqtt/disconnect":
            await controller.disconnect(body);
            break;
          case "/api/mqtt/reconnect":
            await controller.reconnect(body);
            break;
          case "/api/scenario/import":
            controller.importScenario(body);
            break;
          case "/api/scenario/replay":
            await controller.replay();
            break;
          case "/api/discord/thread/delete":
            await controller.deleteThread(body);
            break;
          default:
            writeJson(response, 404, { error: "Not found" });
            return;
        }
        writeJson(response, 200, controller.state());
        return;
      }
      if (method === "GET") {
        await serveStatic(path, response);
        return;
      }
      writeJson(response, 404, { error: "Not found" });
    })().catch(error => {
      const message = error instanceof Error ? error.message : "Internal server error";
      logger.warn({ method: request.method, path: request.url, message }, "Web bench request rejected");
      if (!response.headersSent) {
        writeJson(response, error instanceof Error ? 400 : 500, { error: message });
      } else {
        response.destroy();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, host);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Web bench server did not receive a TCP port");
  }

  return {
    server,
    controller,
    host,
    port: address.port,
    close: async () => {
      await controller.close();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  };
};
