/**
 * Capability 4 · Updates: when the app may restart itself into an update. A restart waits while the app is stopping,
 * a seed is being written or a backup holds it (contract 4.36). The desktop's main process hands it its parts.
 */

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
