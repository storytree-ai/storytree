/**
 * Capability 1 · Lifecycle: how the desktop app stops what it holds, and when it may restart itself. Quitting stops
 * the journey, then the page reads, then the library, then Postgres (contract 1.43): each reads what it stands on
 * before that closes. A restart waits while the app is stopping, a seed is being written or a backup holds it
 * (contract 1.44). The desktop's main process hands its parts to these and wires them to Electron.
 */

/** Something the app holds, found when it is needed, and let go of once stopped. */
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
  /** Says a part that failed to stop; the next part stops all the same. */
  error(line: string): void;
}

export interface AppShutdown {
  /** Stops the app's parts in order. Safe to call more than once: every call answers the first's stop. */
  shutdown(): Promise<void>;
  /** Whether a shutdown has begun. */
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

/**
 * Whether the app may restart itself now: not while it is stopping, which is asked again once the seed check has
 * answered, not while a seed is being written to its own Postgres, and not while a backup holds it.
 */
export function restartAllowed({ stopping, postgresUrl, seedWriting, backups }: {
  stopping(): boolean;
  /** The app's own Postgres, when it started one. */
  postgresUrl(): string | undefined;
  seedWriting(url: string): Promise<boolean>;
  /** The backups, once kept; none hold a restart. */
  backups(): { canRestart(): boolean } | undefined;
}): () => Promise<boolean> {
  return async () => {
    if (stopping()) return false;
    const url = postgresUrl();
    if (url !== undefined && await seedWriting(url)) return false;
    return !stopping() && (backups()?.canRestart() ?? true);
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
