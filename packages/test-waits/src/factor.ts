// Capability 1 · The environment's factor

const FACTORS: Readonly<Partial<Record<NodeJS.Platform, number>>> = { linux: 1, darwin: 2, win32: 4 };

export function factor(platform: NodeJS.Platform = process.platform): number {
  return FACTORS[platform] ?? 1;
}

export function scaled(ms: number, platform: NodeJS.Platform = process.platform): number {
  return ms * factor(platform);
}
