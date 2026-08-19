interface ApplicationModule {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ApplicationDependencies {
  discord: ApplicationModule;
  printers: ApplicationModule;
}

export class Application {
  private shutdownPromise?: Promise<void>;

  public constructor(private readonly dependencies: ApplicationDependencies) {}

  public async start(): Promise<void> {
    await this.dependencies.discord.start();
    try {
      await this.dependencies.printers.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public stop(): Promise<void> {
    this.shutdownPromise ??= this.performStop();
    return this.shutdownPromise;
  }

  private async performStop(): Promise<void> {
    try {
      await this.dependencies.printers.stop();
    } finally {
      await this.dependencies.discord.stop();
    }
  }
}
