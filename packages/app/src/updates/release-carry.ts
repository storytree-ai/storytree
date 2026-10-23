/**
 * Capability 4 · Updates. Contract 4.6: one platform's failure holds only that platform (ADR-1032 D4).
 * A release publishes with the platforms whose builds are in it. A platform whose build is not carries its last good
 * build forward instead: its update feed and its delivery manifest entry are copied from the newest earlier release,
 * naming that build's own version and files, so every reader of GitHub's "latest" release (the alpha updater,
 * the one-liners, a stable pin's candidate) still finds the platform's files, and an install on that build sees no
 * update. Nothing is rebuilt or re-uploaded but these small files. Imported by apps/desktop/release.mjs under plain
 * Node, so it imports nothing relative.
 */
export type ReleasePlatform = "windows" | "mac" | "linux";
export const RELEASE_PLATFORMS: readonly ReleasePlatform[] = ["windows", "mac", "linux"];
export const PLATFORM_NAME: Record<ReleasePlatform, string> = { windows: "Windows", mac: "Mac", linux: "Linux" };
/** The update feed each platform's updater reads from the latest release. */
export const PLATFORM_FEED: Record<ReleasePlatform, string> = { windows: "latest.yml", mac: "latest-mac.yml", linux: "latest-linux.yml" };

interface Entry { name: string; sha256: string; size?: number; sha512?: string; version?: string }
export interface DeliveryManifest {
  schema: number;
  channelSchema?: number;
  version: string;
  architectures?: string[];
  /** Each Windows architecture's own installer; `version` is set when it is an earlier build's, carried. */
  installers?: Record<string, Entry>;
  /** The one Windows installer, for both architectures, of a build from before they were split. */
  installer?: Entry;
  macos?: Record<string, Entry>;
  linux?: Record<string, Entry>;
}
/** A Mac or Linux runner's entry, merged into the release's manifest when it publishes. */
export type PlatformDelivery = { version: string } & Pick<DeliveryManifest, "macos" | "linux">;

/** The version an electron-builder update feed names. */
export function feedVersion(text: string): string {
  const version = /^version: '?(\d+\.\d+\.\d+)'?\r?$/m.exec(text)?.[1];
  if (!version) throw new Error("A release feed names no version");
  return version;
}

/**
 * A platform's update feed carried into a later release. Its version stays the build's own, and each file name becomes
 * a path from the later release's download folder back to the build's own (`../v<version>/<name>`): the updater
 * resolves a feed's file names against the release it read the feed from, so these reach the original files. A feed
 * already carried names its files that way and is copied unchanged.
 */
export function carriedFeed(text: string): string {
  const version = feedVersion(text);
  return text.replace(/^(\s*(?:- )?(?:url|path): )'?([^'\s/]+)'?(\r?)$/gm, `$1../v${version}/$2$3`);
}

const own = (entry: Entry, version: string): Entry => ({ ...entry, version: entry.version ?? version });

/** The part of an earlier release's manifest a platform's one-liner reads, each entry naming the build it really is. */
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

/**
 * The release's delivery manifest: each platform's own entry where its build is in this release (Windows' manifest is
 * the base, the Mac's and Linux's entries join it), and the earlier release's entry, carried, where it is not.
 * Another version's own entry is refused.
 */
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

/** The release page's text with one paragraph saying which platforms stay on an earlier build, or none when all are new. */
export function platformsNote(body: string, carried: Partial<Record<ReleasePlatform, string>>): string {
  const kept = body.split(/\n\n/).filter(paragraph => !paragraph.startsWith(MARK)).join("\n\n");
  const absent = RELEASE_PLATFORMS.filter(p => carried[p] !== undefined);
  if (!absent.length) return kept;
  const each = absent.map(p => `${PLATFORM_NAME[p]} stays on ${carried[p]}`);
  return `${kept}\n\n${MARK} This release has no new ${absent.map(p => PLATFORM_NAME[p]).join(" or ")} build: ${each.join(", ")}, the last that built. Its installs and one-liners take that build until a release carries a new one.`;
}
