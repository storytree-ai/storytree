// Capability 4 · Updates
import { FEED_PLATFORMS, type FeedPlatform, type StableManifest } from "./stable-pin.js";

type Platform = "windows" | FeedPlatform;
export interface PublishedBuild { version: string; publishedAt: string; platforms: Platform[] }
export interface Concern { id: string; title: string; text: string }
export interface LagVerdict { contract: string; state: "passing" | "failing" | "not-checked"; note: string; commit: string }
export interface CandidatePorts {
  pinned(): Promise<StableManifest | undefined>;
  builds(after: string | undefined): Promise<readonly PublishedBuild[]>;
  runs(build: PublishedBuild): Promise<{ passed: boolean; evidence: string }>;
  concerns(): Promise<readonly Concern[]>;
  lag(): Promise<{ contracts: readonly string[]; verdicts: readonly LagVerdict[] }>;
  commit(build: PublishedBuild): Promise<string>;
  sameApp(commit: string, later: string): Promise<boolean>;
  notes(version: string): Promise<string>;
  now(): string;
}
export interface StableCandidate {
  pinned?: string;
  candidate?: { version: string; evidence: string[]; notes: string };
  passedOver: { version: string; reasons: string[] }[];
}

const SOAK_HOURS = 24;
const build = (version: string) => Number(version.slice(4));
const nameOf = (p: Platform) => p === "windows" ? "Windows" : FEED_PLATFORMS[p].name;
const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

function regressed(concern: Concern): number[] {
  const words = `${concern.title}\n${concern.text}`;
  if (!/regress/i.test(words)) return [];
  return [...new Set([...words.matchAll(/(?<![\d.])0\.3\.([1-9]\d*)(?![\d])/g)].map(m => Number(m[1])))];
}

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
