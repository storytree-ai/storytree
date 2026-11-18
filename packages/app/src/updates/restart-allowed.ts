// Capability 4 · Updates

export function restartAllowed({ stopping, postgresUrl, seedWriting, backups }: {
  stopping(): boolean;
  postgresUrl(): string | undefined;
  seedWriting(url: string): Promise<boolean>;
  backups(): { canRestart(): boolean } | undefined;
}): () => Promise<boolean> {
  return async () => {
    if (stopping()) return false;
    const url = postgresUrl();
    if (url !== undefined && await seedWriting(url)) return false;
    return !stopping() && (backups()?.canRestart() ?? true);
  };
}
