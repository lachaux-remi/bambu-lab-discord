import { Aedes, type Client } from "aedes";
import { type Server, createServer } from "node:net";

import { BAMBU_USERNAME } from "../../constants";

export interface MockMqttPrinterOptions {
  accessCode: string;
  host: string;
  port: number;
  serial: string;
}

interface PushallWaiter {
  count: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class MockMqttPrinter {
  private broker?: Aedes;
  private server?: Server;
  private readonly clients = new Set<Client>();
  private readonly pushallListeners = new Set<() => void>();
  private readonly pushallWaiters = new Set<PushallWaiter>();
  private listening = false;
  private stopped = false;
  private assignedPort?: number;
  private receivedPushalls = 0;

  public constructor(private readonly options: MockMqttPrinterOptions) {}

  public get host(): string {
    return this.options.host;
  }

  public get port(): number {
    if (this.assignedPort === undefined) {
      throw new Error("Mock MQTT printer has not started");
    }
    return this.assignedPort;
  }

  public get serial(): string {
    return this.options.serial;
  }

  public get pushallCount(): number {
    return this.receivedPushalls;
  }

  public async start(): Promise<void> {
    if (this.broker) {
      return;
    }
    this.stopped = false;
    this.broker = await Aedes.createBroker({
      authenticate: (_client, username, password, done) => {
        done(null, username === BAMBU_USERNAME && password?.toString() === this.options.accessCode);
      }
    });
    this.server = createServer(this.broker.handle);
    this.broker.on("clientReady", client => this.clients.add(client));
    this.broker.on("clientDisconnect", client => this.clients.delete(client));
    this.broker.on("publish", (packet, client) => {
      if (!client || packet.topic !== `device/${this.options.serial}/request`) {
        return;
      }
      try {
        const request = JSON.parse(packet.payload.toString()) as { pushing?: { command?: unknown } };
        if (request.pushing?.command === "pushall") {
          this.receivedPushalls += 1;
          this.resolvePushallWaiters();
          for (const listener of this.pushallListeners) {
            listener();
          }
        }
      } catch {
        // A real printer ignores requests it does not understand.
      }
    });
    await this.listen(this.options.port);
  }

  public onPushall(listener: () => void): () => void {
    this.pushallListeners.add(listener);
    return () => this.pushallListeners.delete(listener);
  }

  public async waitForPushall(count: number, timeoutMs: number): Promise<void> {
    if (this.receivedPushalls >= count) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: PushallWaiter = {
        count,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pushallWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for pushall ${count}; received ${this.receivedPushalls}`));
        }, timeoutMs)
      };
      this.pushallWaiters.add(waiter);
    });
  }

  public async publish(payload: string): Promise<void> {
    const broker = this.broker;
    if (!broker || this.stopped) {
      throw new Error("Mock MQTT printer is stopped");
    }
    await new Promise<void>((resolve, reject) => {
      broker.publish(
        {
          cmd: "publish",
          topic: `device/${this.options.serial}/report`,
          payload: Buffer.from(payload),
          qos: 0,
          retain: false,
          dup: false
        },
        error => (error ? reject(error) : resolve())
      );
    });
  }

  public async pause(): Promise<void> {
    if (!this.server || !this.listening) {
      return;
    }
    const clients = Array.from(this.clients);
    await Promise.all(
      clients.map(
        client =>
          new Promise<void>(resolve => {
            client.close(resolve);
          })
      )
    );
    await new Promise<void>((resolve, reject) => {
      this.server?.close(error => (error ? reject(error) : resolve()));
    });
    this.listening = false;
  }

  public async resume(): Promise<void> {
    if (this.stopped) {
      throw new Error("Mock MQTT printer is stopped");
    }
    if (!this.listening) {
      await this.listen(this.port);
    }
  }

  public async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    await this.pause();
    const broker = this.broker;
    this.broker = undefined;
    this.server = undefined;
    this.clients.clear();
    if (broker) {
      await new Promise<void>(resolve => broker.close(resolve));
    }
    for (const waiter of this.pushallWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Mock MQTT printer stopped while waiting for pushall"));
    }
    this.pushallWaiters.clear();
  }

  private async listen(port: number): Promise<void> {
    const server = this.server;
    if (!server) {
      throw new Error("Mock MQTT printer broker is not initialized");
    }
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
      server.listen(port, this.options.host);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Mock MQTT printer did not receive a TCP port");
    }
    this.assignedPort = address.port;
    this.listening = true;
  }

  private resolvePushallWaiters(): void {
    for (const waiter of this.pushallWaiters) {
      if (this.receivedPushalls >= waiter.count) {
        clearTimeout(waiter.timeout);
        this.pushallWaiters.delete(waiter);
        waiter.resolve();
      }
    }
  }
}
