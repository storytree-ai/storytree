// Capability 1 · Lifecycle

export interface Held<T> {
  held(): T | undefined;
  letGo?(): void;
}

export interface AppParts {
  backups: Held<{ stop(): void }>;
  journey: Held<{ finish(): Promise<void> }>;
  reads: Held<{ close(): Promise<void> }>;
  library: Held<{ close(): Promise<void> }>;
  postgres: Held<{ stop(): Promise<void> }>;
  error(line: string): void;
}

export interface AppShutdown {
  shutdown(): Promise<void>;
  stopping(): boolean;
}

export function appShutdown(parts: AppParts): AppShutdown {
  let shutDown: Promise<void> | undefined;
  const close = async (part: Held<{ close(): Promise<void> }>, what: string): Promise<void> => {
    await part.held()?.close().catch((error: unknown) => parts.error(`closing ${what}: ${messageOf(error)}`));
    part.letGo?.();
  };
  return {
    shutdown() {
      parts.backups.held()?.stop();
      shutDown ??= (async () => {
        await parts.journey.held()?.finish();
        await close(parts.reads, "the projects");
        await close(parts.library, "the library");
        await parts.postgres.held()?.stop().catch((error: unknown) => parts.error(`stopping Postgres: ${messageOf(error)}`));
        parts.postgres.letGo?.();
      })();
      return shutDown;
    },
    stopping: () => shutDown !== undefined,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
