// Capability 1 · Base structure measures
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { packagesOf, type StoryNamed } from "@storytree/map/package-of";
import { VerbRefusal } from "@storytree/library/verbs";

import { churnOf, type ChurnReading } from "./churn.js";
import { complexityOf, type ComplexityReading } from "./complexity.js";
import { couplingOf, publicSurfaceOf, type CouplingReading, type WorkspacePackage } from "./coupling.js";
import { duplicationOf, type DuplicationReading } from "./duplication.js";
import { erosionOf, type ErosionReading } from "./erosion.js";
import { loosenessOf, type LoosenessReading } from "./looseness.js";
import { sizeOf, type Size, type SourceText } from "./source.js";
import { testsOf, type TestsReading } from "./tests.js";

export const DEFAULT_DAYS = 90;

export interface StoryMeasures {
  readonly id: string;
  readonly title: string;
  readonly packages: readonly string[];
  readonly missing?: string;
  readonly size?: Size;
  readonly complexity?: ComplexityReading;
  readonly duplication?: DuplicationReading;
  readonly erosion?: ErosionReading;
  readonly coupling?: CouplingReading;
  readonly surface?: number;
  readonly looseness?: LoosenessReading;
  readonly churn?: ChurnReading;
  readonly tests?: TestsReading;
}

export interface MeasuresReading {
  readonly commit: string;
  readonly committed: string;
  readonly window: { readonly days: number; readonly from: string; readonly to: string };
  readonly stories: readonly StoryMeasures[];
}

const run = promisify(execFile);
const CODE_FILE = /\.[cm]?[jt]sx?$/;

async function git(folder: string, args: readonly string[]): Promise<string> {
  return (await run("git", [...args], { cwd: folder, encoding: "utf8", maxBuffer: 1 << 30 })).stdout;
}

export async function commitOf(folder: string, commit: string | undefined): Promise<string> {
  const verify = (name: string) => git(folder, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${name}^{commit}`]).then((out) => out.trim());
  if (commit !== undefined) return verify(commit).catch(() => { throw new VerbRefusal(`Cannot read commit ${commit}: it is no commit in ${folder}.`); });
  const origin = await git(folder, ["config", "--get", "remote.origin.url"]).then((out) => out.trim(), () => "");
  if (origin === "") return verify("HEAD").catch(() => { throw new VerbRefusal(`Cannot read HEAD in ${folder}: give --commit.`); });
  return verify("refs/remotes/origin/main").catch(() => { throw new VerbRefusal(`Cannot read origin/main in ${folder}: it has not been fetched. Fetch it, or give --commit.`); });
}

function daysOf(since: string | undefined): number {
  if (since === undefined) return DEFAULT_DAYS;
  const match = /^(\d+)\s*([dw]?)$/i.exec(since.trim());
  const days = match === null ? Number.NaN : Number(match[1]) * (match[2]!.toLowerCase() === "w" ? 7 : 1);
  if (!(days > 0)) throw new VerbRefusal(`"${since}" is not a window: give days (90 or 90d) or weeks (12w).`, { misuse: true });
  return days;
}

function blobs(folder: string, oids: readonly string[]): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd: folder, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`git cat-file failed: ${error.trim()}`));
      const out = Buffer.concat(chunks);
      const texts = new Map<string, string>();
      let at = 0;
      while (at < out.length) {
        const end = out.indexOf(10, at);
        const [oid, type, size] = out.subarray(at, end).toString().split(" ");
        at = end + 1;
        if (type === "missing" || size === undefined) continue;
        texts.set(oid!, out.subarray(at, at + Number(size)).toString("utf8"));
        at += Number(size) + 1;
      }
      resolve(texts);
    });
    child.stdin.end(`${oids.join("\n")}\n`);
  });
}

async function workspaceAt(folder: string, commit: string): Promise<WorkspacePackage[]> {
  const entries = (await git(folder, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", "packages"])).split("\0").flatMap((entry) => {
    const tab = entry.indexOf("\t");
    if (tab < 0) return [];
    const [, type, oid] = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    return type === "blob" && !path.includes("/node_modules/") ? [{ oid: oid!, path }] : [];
  });
  const manifests = entries.filter(({ path }) => /^packages\/[^/]+\/package\.json$/.test(path));
  const code = entries.filter(({ path }) => CODE_FILE.test(path));
  const texts = await blobs(folder, [...new Set([...manifests, ...code].map(({ oid }) => oid))]);
  const files = new Map<string, SourceText[]>();
  for (const { oid, path } of code) {
    const own = path.split("/")[1]!;
    const list = files.get(own) ?? [];
    list.push({ path, text: texts.get(oid) ?? "" });
    files.set(own, list);
  }
  return manifests.map(({ oid, path }) => {
    const own = path.split("/")[1]!;
    let manifest: Record<string, unknown> = {};
    try {
      manifest = JSON.parse(texts.get(oid) ?? "{}") as Record<string, unknown>;
    } catch {
    }
    return { folder: own, name: typeof manifest.name === "string" ? manifest.name : own, manifest, files: files.get(own) ?? [] };
  });
}

export async function readStoryMeasures({ folder, commit, since, stories, story }: {
  readonly folder: string;
  readonly commit?: string;
  readonly since?: string;
  readonly stories: readonly StoryNamed[];
  readonly story?: string;
}): Promise<MeasuresReading> {
  const chosen = story === undefined ? stories : stories.filter((one) => one.id === story || one.title.toLowerCase() === story.toLowerCase());
  if (chosen.length === 0 && story !== undefined) throw new VerbRefusal(`No story "${story}": give a story's id or its title.`);
  const days = daysOf(since);
  const sha = await commitOf(folder, commit);
  const committed = (await git(folder, ["show", "-s", "--format=%cI", sha])).trim();
  const to = new Date(committed);
  const from = new Date(to.getTime() - days * 86_400_000);
  const [workspace, numstat] = await Promise.all([
    workspaceAt(folder, sha),
    git(folder, ["log", "--numstat", "-M", "--format=", `--since=${from.toISOString().replace(/\.\d{3}Z$/, "Z")}`, sha, "--", "packages"]),
  ]);
  const byFolder = new Map(workspace.map((pkg) => [pkg.folder, pkg]));
  const measured = chosen.map((one): StoryMeasures => {
    const folders = packagesOf(one);
    const present = folders.flatMap((own) => byFolder.get(own) ?? []);
    const named = { id: one.id, title: one.title, packages: folders };
    if (present.length === 0) return { ...named, missing: `${folders.map((own) => `packages/${own}`).join(" and ")} is not in the checkout at ${sha.slice(0, 12)}` };
    const files = present.flatMap((pkg) => pkg.files);
    return {
      ...named,
      size: sizeOf(files),
      complexity: complexityOf(files),
      duplication: duplicationOf(files),
      erosion: erosionOf(files),
      coupling: couplingOf(present.map((pkg) => pkg.folder), workspace),
      surface: present.reduce((total, pkg) => total + publicSurfaceOf(pkg), 0),
      looseness: loosenessOf(files),
      churn: churnOf(numstat, files),
      tests: testsOf(files),
    };
  });
  return { commit: sha, committed: to.toISOString(), window: { days, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, stories: measured };
}
