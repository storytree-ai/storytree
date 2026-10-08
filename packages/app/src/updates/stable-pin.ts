/** Capability 4 · Updates. Contract 4.16: a stable pin is release metadata, never a second build. */
export interface LandedIncrement {
  id: string;
  fields: { title: string; status: string; outcome?: { disposition: string; pr?: string | undefined; note?: string | undefined } | undefined };
}
export interface StableManifest {
  schema: 1;
  channel: "stable";
  version: string;
  files: { url: string; sha512: string; size: number }[];
  releaseNotes: string;
  pin: {
    commit: string;
    at: string;
    previous?: string;
    increments: { id: string; title: string; pr: string; note?: string }[];
    /** Includes earlier pins, so closures recorded late are included next time, never silently lost. */
    includedIncrements: string[];
  };
}
export interface PinCandidate {
  version: string;
  commit: string;
  channelSchema: number;
  draft: boolean;
  prerelease: boolean;
  installer: { url: string; sha256: string; sha512: string; size: number };
  /** The release's one-line installers: Windows' always, the Mac's once releases publish it. */
  bootstrap: Bootstraps;
}
export interface Bootstraps { ps1: string; sh?: string }
export interface PinPorts {
  previous(): Promise<{ ref: string; manifest: StableManifest } | undefined>;
  /** The adapter checks the release tag is on main and its version matches that commit. */
  candidate(version: string): Promise<PinCandidate>;
  pullRequests(commit: string): Promise<ReadonlySet<string>>;
  increments(): Promise<readonly LandedIncrement[]>;
  /** Publish atomically only while the channel still has the expected ref. */
  publish(manifest: StableManifest, bootstrap: Bootstraps, expectedRef?: string): Promise<void>;
  now(): string;
}

function buildNumber(version: string): number {
  if (!/^0\.3\.[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version.slice(4)))) throw new Error("Name an existing 0.3.<n> release");
  return Number(version.slice(4));
}

/** Subjects of first-parent merges: a reference to another PR in prose is not evidence it shipped. */
export function mergedPullRequests(subjects: string): ReadonlySet<string> {
  return new Set(subjects.split(/\r?\n/).flatMap(subject => /^Merge pull request #([1-9]\d*) from \S+$/.exec(subject)?.[1] ?? []));
}

export function readStableManifest(value: unknown): StableManifest {
  const manifest = value as StableManifest | null;
  if (!manifest || manifest.schema !== 1 || manifest.channel !== "stable" || typeof manifest.version !== "string" ||
      !manifest.pin || !/^[a-f0-9]{40}$/.test(manifest.pin.commit) || !Array.isArray(manifest.pin.includedIncrements) ||
      !manifest.pin.includedIncrements.every(id => typeof id === "string") || !Array.isArray(manifest.pin.increments) ||
      !Array.isArray(manifest.files) || manifest.files.length !== 1 || typeof manifest.releaseNotes !== "string") throw new Error("The stable pin is unreadable; refusing to replace it");
  buildNumber(manifest.version);
  return manifest;
}

export async function pinStable(version: string, ports: PinPorts, preview = false): Promise<StableManifest> {
  const build = buildNumber(version);
  const previous = await ports.previous();
  if (previous) {
    readStableManifest(previous.manifest);
    if (build < buildNumber(previous.manifest.version)) throw new Error("An older release cannot replace the stable pin");
  }
  const candidate = await ports.candidate(version);
  const installer = candidate.installer;
  const expectedUrl = `https://github.com/storytree-ai/storytree/releases/download/v${version}/storytree-0.3-${version}-setup.exe`;
  if (candidate.version !== version || candidate.draft || candidate.prerelease || candidate.channelSchema !== 1 ||
      !/^[a-f0-9]{40}$/.test(candidate.commit) || !candidate.bootstrap.ps1 || installer.url !== expectedUrl ||
      !/^[a-f0-9]{64}$/i.test(installer.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(installer.sha512) ||
      !Number.isSafeInteger(installer.size) || installer.size < 1) {
    throw new Error("The release is incomplete or does not support stable installation channels; pin a complete channel-aware release");
  }
  if (previous?.manifest.version === version) {
    if (previous.manifest.pin.commit !== candidate.commit) throw new Error("The pinned release identity changed");
    return previous.manifest;
  }
  const reachable = await ports.pullRequests(candidate.commit);
  const included = new Set(previous?.manifest.pin.includedIncrements ?? []);
  const increments = (await ports.increments()).flatMap(({ id, fields }) => {
    const outcome = fields.outcome;
    if (included.has(id) || fields.status !== "closed" || outcome?.disposition !== "landed" || !outcome.pr) return [];
    const pr = /^(?:https:\/\/github\.com\/storytree-ai\/storytree\/pull\/|#)?([1-9]\d*)$/.exec(outcome.pr)?.[1];
    if (!pr || !reachable.has(pr)) return [];
    included.add(id);
    return [{ id, title: fields.title, pr, ...(outcome.note ? { note: outcome.note } : {}) }];
  });
  const releaseNotes = [`# storytree ${version}`, "", ...increments.flatMap(i => [
    `- ${i.title} ([#${i.pr}](https://github.com/storytree-ai/storytree/pull/${i.pr}))${i.note ? ` — ${i.note}` : ""}`,
  ]), ...(increments.length ? [] : ["No newly recorded landed increments in this build."])].join("\n");
  const manifest: StableManifest = {
    schema: 1, channel: "stable", version,
    files: [{ url: installer.url, sha512: installer.sha512, size: installer.size }], releaseNotes,
    pin: { commit: candidate.commit, at: ports.now(), ...(previous ? { previous: previous.manifest.version } : {}), increments, includedIncrements: [...included] },
  };
  if (!preview) await ports.publish(manifest, candidate.bootstrap, previous?.ref);
  return manifest;
}
