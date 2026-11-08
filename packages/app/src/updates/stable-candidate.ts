/**
 * Capability 4 · Updates. Contract 4.23: the newest published build fit to be stable, with its evidence (ADR-1032 D6), once
 * the Mint box's lag run has measured it and found no action slower (ADR-1290). It reads and changes nothing; the owner pins (4.16).
 */
import { FEED_PLATFORMS, type FeedPlatform, type StableManifest } from "./stable-pin.js";

type Platform = "windows" | FeedPlatform;
export interface PublishedBuild { version: string; publishedAt: string; platforms: Platform[] }
/** An open friction report or question, its words joined in `text`. */
export interface Concern { id: string; title: string; text: string }
/** A verdict the box's lag run wrote on a catalogue action's budget contract, and the main commit it measured. */
export interface LagVerdict { contract: string; state: "passing" | "failing" | "not-checked"; note: string; commit: string }
export interface CandidatePorts {
  pinned(): Promise<StableManifest | undefined>;
  /** Published alpha builds newer than the pin, newest first. */
  builds(after: string | undefined): Promise<readonly PublishedBuild[]>;
  /** Whether the build's release run passed, its acceptance run included, and the run that says so. */
  runs(build: PublishedBuild): Promise<{ passed: boolean; evidence: string }>;
  concerns(): Promise<readonly Concern[]>;
  /** The lag catalogue's budget contracts, and every verdict the lag run wrote on them that names its commit, oldest first. */
  lag(): Promise<{ contracts: readonly string[]; verdicts: readonly LagVerdict[] }>;
  /** The commit the build was made from. */
  commit(build: PublishedBuild): Promise<string>;
  /** Whether main's commit `later` is `commit`, or comes after it with the same app code. */
  sameApp(commit: string, later: string): Promise<boolean>;
  /** The release notes a pin of this build would publish. */
  notes(version: string): Promise<string>;
  now(): string;
}
export interface StableCandidate {
  pinned?: string;
  candidate?: { version: string; evidence: string[]; notes: string };
  passedOver: { version: string; reasons: string[] }[];
}

/** A day on the alpha installs (the owner's machines, the Mint box) before a build may be stable. */
const SOAK_HOURS = 24;
const build = (version: string) => Number(version.slice(4));
const nameOf = (p: Platform) => p === "windows" ? "Windows" : FEED_PLATFORMS[p].name;
const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

/** The builds a concern names as regressed, each once: it must say "regress…" and name the build whole, never a longer one. */
function regressed(concern: Concern): number[] {
  const words = `${concern.title}\n${concern.text}`;
  if (!/regress/i.test(words)) return [];
  return [...new Set([...words.matchAll(/(?<![\d.])0\.3\.([1-9]\d*)(?![\d])/g)].map(m => Number(m[1])))];
}

/**
 * The lag run's reading of `build` (ADR-1290 D1): each budget contract's latest verdict at the build's commit or a later one with the
 * same app code. Fit only when every contract has one and none is slower; a slower one is passed over with the action it names.
 */
async function lagOf(ports: CandidatePorts, lag: Awaited<ReturnType<CandidatePorts["lag"]>>, build: PublishedBuild): Promise<{ fit: boolean; lines: string[] }> {
  const commit = await ports.commit(build);
  const same = new Map<string, boolean>();
  const standing = new Map<string, LagVerdict>();
  for (const verdict of lag.verdicts) {
    if (!lag.contracts.includes(verdict.contract)) continue;
    if (!same.has(verdict.commit)) same.set(verdict.commit, await ports.sameApp(commit, verdict.commit));
    if (same.get(verdict.commit)) standing.set(verdict.contract, verdict);
  }
  const slower = [...standing.values()].filter(v => v.state === "failing");
  if (slower.length) return { fit: false, lines: slower.map(v => `the lag run found an action slower: ${v.note}`) };
  const unmeasured = lag.contracts.filter(c => standing.get(c)?.state !== "passing");
  if (unmeasured.length) {
    const which = unmeasured.length < lag.contracts.length ? ` for the actions of ${unmeasured.join(", ")}` : "";
    return { fit: false, lines: [`the lag run has not measured it, nor a later build with the same app code${which}`] };
  }
  return { fit: true, lines: lag.contracts.map(c => `The lag run found no action slower: ${standing.get(c)!.note}.`) };
}

export async function stableCandidate(ports: CandidatePorts): Promise<StableCandidate> {
  const pinned = await ports.pinned();
  const covers: Platform[] = pinned?.pin.covers ?? ["windows"];
  const now = Date.parse(ports.now());
  const concerns = (await ports.concerns()).flatMap(c => regressed(c).map(at => ({ ...c, at })));
  const newer = (await ports.builds(pinned?.version)).filter(b => !pinned || build(b.version) > build(pinned.version))
    .sort((a, b) => build(b.version) - build(a.version));
  const passedOver: StableCandidate["passedOver"] = [];
  let lag: Awaited<ReturnType<CandidatePorts["lag"]>> | undefined;
  for (const b of newer) {
    const hours = Math.floor((now - Date.parse(b.publishedAt)) / 3600_000);
    const reasons: string[] = [];
    const missing = covers.filter(p => !b.platforms.includes(p));
    if (missing.length) reasons.push(`it has no ${list(missing.map(nameOf))} build, which the pin covers`);
    if (hours < SOAK_HOURS) reasons.push(`published ${hours} hour${hours === 1 ? "" : "s"} ago, under the ${SOAK_HOURS} the alpha installs run it first`);
    for (const c of concerns) {
      if (c.at <= build(b.version) && (!pinned || c.at > build(pinned.version))) reasons.push(`${c.id} names a regression in 0.3.${c.at}: ${c.title}`);
    }
    if (!reasons.length) {
      const runs = await ports.runs(b);
      const measured = runs.passed ? await lagOf(ports, lag ??= await ports.lag(), b) : undefined;
      if (measured?.fit) {
        return { ...(pinned ? { pinned: pinned.version } : {}), passedOver, candidate: { version: b.version, notes: await ports.notes(b.version), evidence: [
          `Covers ${list(covers.map(nameOf))}, as the pin does.`,
          runs.evidence,
          `Published ${hours} hours ago: the alpha installs have run it or a later build for at least ${SOAK_HOURS}.`,
          `No open friction or question names a regression in it or an earlier unpinned build.`,
          ...measured.lines,
        ] } };
      }
      reasons.push(...measured?.lines ?? [runs.evidence]);
    }
    passedOver.push({ version: b.version, reasons });
  }
  return { ...(pinned ? { pinned: pinned.version } : {}), passedOver };
}
