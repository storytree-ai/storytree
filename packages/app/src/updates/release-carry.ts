// Capability 4 · Updates
export type ReleasePlatform = "windows" | "mac" | "linux";
export const RELEASE_PLATFORMS: readonly ReleasePlatform[] = ["windows", "mac", "linux"];
export const PLATFORM_NAME: Record<ReleasePlatform, string> = { windows: "Windows", mac: "Mac", linux: "Linux" };
export const PLATFORM_FEED: Record<ReleasePlatform, string> = { windows: "latest.yml", mac: "latest-mac.yml", linux: "latest-linux.yml" };

interface Entry { name: string; sha256: string; size?: number; sha512?: string; version?: string }
export interface DeliveryManifest {
  schema: number;
  channelSchema?: number;
  version: string;
  architectures?: string[];
  installers?: Record<string, Entry>;
  installer?: Entry;
  macos?: Record<string, Entry>;
  linux?: Record<string, Entry>;
}
export type PlatformDelivery = { version: string } & Pick<DeliveryManifest, "macos" | "linux">;

export function feedVersion(text: string): string {
  const version = /^version: '?(\d+\.\d+\.\d+)'?\r?$/m.exec(text)?.[1];
  if (!version) throw new Error("A release feed names no version");
  return version;
}

export function carriedFeed(text: string): string {
  const version = feedVersion(text);
  return text.replace(/^(\s*(?:- )?(?:url|path): )'?([^'\s/]+)'?(\r?)$/gm, `$1../v${version}/$2$3`);
}

interface ListedRelease { tag_name: string; draft: boolean; prerelease: boolean }

export function carrySource<R extends ListedRelease>(releases: readonly R[], tag: string): R | undefined {
  const candidates = releases.filter((r) => !r.draft && !r.prerelease && r.tag_name !== tag && /^v\d+\.\d+\.\d+$/.test(r.tag_name));
  return candidates.sort((a, b) => b.tag_name.localeCompare(a.tag_name, "en", { numeric: true }))[0];
}

const own = (entry: Entry, version: string): Entry => ({ ...entry, version: entry.version ?? version });

export function carriedEntry(platform: ReleasePlatform, earlier: DeliveryManifest): Partial<DeliveryManifest> {
  const each = (entries: Record<string, Entry>) => Object.fromEntries(Object.entries(entries).map(([arch, entry]) => [arch, own(entry, earlier.version)]));
  if (platform === "windows") {
    const architectures = earlier.architectures ?? [];
    if (earlier.installers && Object.keys(earlier.installers).length) return { architectures, installers: each(earlier.installers) };
    if (!earlier.installer) throw new Error(`Release ${earlier.version} has no Windows build to carry`);
    return { architectures, installer: own(earlier.installer, earlier.version) };
  }
  const key = platform === "mac" ? "macos" : "linux";
  const entries = earlier[key];
  if (!entries || !Object.keys(entries).length) throw new Error(`Release ${earlier.version} has no ${PLATFORM_NAME[platform]} build to carry`);
  return { [key]: each(entries) };
}

export function releaseDelivery(version: string, mine: { windows?: DeliveryManifest; mac?: PlatformDelivery; linux?: PlatformDelivery }, earlier?: DeliveryManifest): DeliveryManifest {
  const need = (platform: ReleasePlatform) => {
    if (!earlier) throw new Error(`No earlier release carries a ${PLATFORM_NAME[platform]} build, so this release cannot publish without one`);
    return carriedEntry(platform, earlier);
  };
  const base = mine.windows ?? { schema: 1, channelSchema: earlier?.channelSchema ?? 1, version, ...need("windows") };
  if (base.version !== version) throw new Error(`The Windows delivery manifest is for ${base.version}, not ${version}`);
  let manifest: DeliveryManifest = { ...base };
  for (const platform of ["mac", "linux"] as const) {
    const entry = mine[platform];
    if (entry === undefined) { manifest = { ...manifest, ...need(platform) }; continue; }
    const { version: built, ...systems } = entry;
    if (built !== version) throw new Error(`The ${Object.keys(systems).join(", ")} delivery entry is for ${built}, not ${version}`);
    manifest = { ...manifest, ...systems };
  }
  return manifest;
}

const MARK = "**Platforms.**";

export function platformsNote(body: string, carried: Partial<Record<ReleasePlatform, string>>): string {
  const kept = body.split(/\n\n/).filter(paragraph => !paragraph.startsWith(MARK)).join("\n\n");
  const absent = RELEASE_PLATFORMS.filter(p => carried[p] !== undefined);
  if (!absent.length) return kept;
  const each = absent.map(p => `${PLATFORM_NAME[p]} stays on ${carried[p]}`);
  return `${kept}\n\n${MARK} This release has no new ${absent.map(p => PLATFORM_NAME[p]).join(" or ")} build: ${each.join(", ")}, the last that built. Its installs and one-liners take that build until a release carries a new one.`;
}
