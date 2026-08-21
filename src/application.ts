interface ApplicationModule {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ApplicationDependencies {
  discord: ApplicationModule;
  printers: ApplicationModule;
}

export class Application {
  private startupPromise?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private stopRequested = false;

  public constructor(private readonly dependencies: ApplicationDependencies) {}

  public start(): Promise<void> {
    if (this.stopRequested) {
      return Promise.resolve();
    }

    this.startupPromise ??= this.performStart();
    return this.startupPromise;
  }

  private async performStart(): Promise<void> {
    try {
      await this.dependencies.discord.start();
      if (this.stopRequested) {
        return;
      }

      await this.dependencies.printers.start();
    } catch (error) {
      if (this.stopRequested) {
        throw error;
      }

      this.stopRequested = true;
      this.shutdownPromise = this.stopModules();
      await this.shutdownPromise;
      throw error;
    }
  }

  public stop(): Promise<void> {
    this.stopRequested = true;
    this.shutdownPromise ??= this.performStop();
    return this.shutdownPromise;
  }

  private async performStop(): Promise<void> {
    if (this.startupPromise) {
      try {
        await this.startupPromise;
      } catch {
        // Startup errors are reported by start(); shutdown must still complete.
      }
    }

    await this.stopModules();
  }

  private async stopModules(): Promise<void> {
    try {
      await this.dependencies.printers.stop();
    } finally {
      await this.dependencies.discord.stop();
    }
  }
}
