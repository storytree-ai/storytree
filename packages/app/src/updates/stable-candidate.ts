/**
 * Capability 4 · Updates. Contract 4.23: the newest published build fit to be stable, with its evidence (ADR-1032 D6).
 * It reads and changes nothing; the owner pins (4.16).
 */
import { FEED_PLATFORMS, type FeedPlatform, type StableManifest } from "./stable-pin.js";

type Platform = "windows" | FeedPlatform;
export interface PublishedBuild { version: string; publishedAt: string; platforms: Platform[] }
/** An open friction report or question, its words joined in `text`. */
export interface Concern { id: string; title: string; text: string }
export interface CandidatePorts {
  pinned(): Promise<StableManifest | undefined>;
  /** Published development builds newer than the pin, newest first. */
  builds(after: string | undefined): Promise<readonly PublishedBuild[]>;
  /** Whether the build's release run passed, its acceptance run included, and the run that says so. */
  runs(build: PublishedBuild): Promise<{ passed: boolean; evidence: string }>;
  concerns(): Promise<readonly Concern[]>;
  /** The release notes a pin of this build would publish. */
  notes(version: string): Promise<string>;
  now(): string;
}
export interface StableCandidate {
  pinned?: string;
  candidate?: { version: string; evidence: string[]; notes: string };
  passedOver: { version: string; reasons: string[] }[];
}

/** A day on the development installs (the owner's machines, the Mint box) before a build may be stable. */
const SOAK_HOURS = 24;
const build = (version: string) => Number(version.slice(4));
const nameOf = (p: Platform) => p === "windows" ? "Windows" : FEED_PLATFORMS[p].name;
const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

/** The builds a concern names as regressed: it must say "regress…" and name the build whole, never a longer one. */
function regressed(concern: Concern): number[] {
  const words = `${concern.title}\n${concern.text}`;
  if (!/regress/i.test(words)) return [];
  return [...words.matchAll(/(?<![\d.])0\.3\.([1-9]\d*)(?![\d])/g)].map(m => Number(m[1]));
}

export async function stableCandidate(ports: CandidatePorts): Promise<StableCandidate> {
  const pinned = await ports.pinned();
  const covers: Platform[] = pinned?.pin.covers ?? ["windows"];
  const now = Date.parse(ports.now());
  const concerns = (await ports.concerns()).flatMap(c => regressed(c).map(at => ({ ...c, at })));
  const newer = (await ports.builds(pinned?.version)).filter(b => !pinned || build(b.version) > build(pinned.version))
    .sort((a, b) => build(b.version) - build(a.version));
  const passedOver: StableCandidate["passedOver"] = [];
  for (const b of newer) {
    const hours = Math.floor((now - Date.parse(b.publishedAt)) / 3600_000);
    const reasons: string[] = [];
    const missing = covers.filter(p => !b.platforms.includes(p));
    if (missing.length) reasons.push(`it has no ${list(missing.map(nameOf))} build, which the pin covers`);
    if (hours < SOAK_HOURS) reasons.push(`published ${hours} hour${hours === 1 ? "" : "s"} ago, under the ${SOAK_HOURS} the development installs run it first`);
    for (const c of concerns) {
      if (c.at <= build(b.version) && (!pinned || c.at > build(pinned.version))) reasons.push(`${c.id} names a regression in 0.3.${c.at}: ${c.title}`);
    }
    if (!reasons.length) {
      const runs = await ports.runs(b);
      if (runs.passed) {
        return { ...(pinned ? { pinned: pinned.version } : {}), passedOver, candidate: { version: b.version, notes: await ports.notes(b.version), evidence: [
          `Covers ${list(covers.map(nameOf))}, as the pin does.`,
          runs.evidence,
          `Published ${hours} hours ago: the development installs have run it or a later build for at least ${SOAK_HOURS}.`,
          `No open friction or question names a regression in it or an earlier unpinned build.`,
        ] } };
      }
      reasons.push(runs.evidence);
    }
    passedOver.push({ version: b.version, reasons });
  }
  return { ...(pinned ? { pinned: pinned.version } : {}), passedOver };
}
