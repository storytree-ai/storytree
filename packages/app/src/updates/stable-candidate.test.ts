import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CandidatePorts, type LagVerdict, type PublishedBuild, stableCandidate } from "./stable-candidate.js";
import { appCode, lagVerdicts, releaseCommit, releasePlatforms, releaseRunPassed, sameAppCode } from "./stable-github.js";
import type { StableManifest } from "./stable-pin.js";

const NOW = "2026-10-16T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();
const pin = { version: "0.3.10", pin: { covers: ["windows", "mac", "linux"] } } as unknown as StableManifest;

const lagWithin = (commit: string, run = 7): LagVerdict[] => [
  { contract: "contract_island", state: "passing", commit, note: `open-most-island within the margin of its baseline c10; close-panel within the margin of its baseline c10, evidence pnpm lag:box, run ${run}, at commit ${commit}` },
  { contract: "contract_start", state: "passing", commit, note: `open-app-kept within the margin of its baseline c10, evidence pnpm lag:box, run ${run}, at commit ${commit}` },
];

function fixture() {
  const state = {
    builds: [
      { version: "0.3.15", publishedAt: hoursAgo(2), platforms: ["windows", "mac", "linux"] },
      { version: "0.3.14", publishedAt: hoursAgo(30), platforms: ["windows", "linux"] },
      { version: "0.3.13", publishedAt: hoursAgo(40), platforms: ["windows", "mac", "linux"] },
      { version: "0.3.12", publishedAt: hoursAgo(50), platforms: ["windows", "mac", "linux"] },
      { version: "0.3.11", publishedAt: hoursAgo(60), platforms: ["windows", "mac", "linux"] },
    ] as PublishedBuild[],
    failed: new Set(["0.3.13"]),
    concerns: [] as { id: string; title: string; text: string }[],
    checked: [] as string[],
    // The box's lag run measured every build's own commit and found each catalogue action within its baseline.
    lag: [11, 12, 13, 14, 15].flatMap(n => lagWithin(`c${n}`)),
    /** Pairs `<commit>><later>` whose app code is the same. */
    sameApp: new Set<string>(),
  };
  const ports: CandidatePorts = {
    pinned: async () => pin,
    builds: async () => state.builds,
    runs: async build => {
      state.checked.push(build.version);
      return state.failed.has(build.version)
        ? { passed: false, evidence: `release run 3${build.version.slice(4)} failed in mac-acceptance` }
        : { passed: true, evidence: `release run 3${build.version.slice(4)} passed, mac-acceptance included` };
    },
    concerns: async () => state.concerns,
    lag: async () => ({ contracts: ["contract_island", "contract_start"], verdicts: state.lag }),
    commit: async build => `c${build.version.slice(4)}`,
    sameApp: async (commit, later) => commit === later || state.sameApp.has(`${commit}>${later}`),
    notes: async version => `# storytree ${version}\n- Stable updates (#532)`,
    now: () => NOW,
  };
  return { state, ports };
}

test("4.23 the stable candidate is the newest build that covers the pin's platforms, passed its release and acceptance runs and has run for a day, with its evidence and notes", async () => {
  const { state, ports } = fixture();
  const found = await stableCandidate(ports);
  assert.equal(found.candidate?.version, "0.3.12");
  assert.deepEqual(found.passedOver.map(b => b.version), ["0.3.15", "0.3.14", "0.3.13"]);
  assert.match(found.passedOver[0]!.reasons.join(" "), /published 2 hours ago/);
  assert.match(found.passedOver[1]!.reasons.join(" "), /no Mac build/);
  assert.match(found.passedOver[2]!.reasons.join(" "), /failed in mac-acceptance/);
  assert.match(found.candidate!.evidence.join("\n"), /Windows, Mac and Linux/);
  assert.match(found.candidate!.evidence.join("\n"), /passed, mac-acceptance included/);
  assert.match(found.candidate!.evidence.join("\n"), /50 hours/);
  assert.match(found.candidate!.notes, /Stable updates/);
  // Runs are read only for a build the cheaper rules have not already passed over.
  assert.deepEqual(state.checked, ["0.3.13", "0.3.12"]);
});

test("4.23 GitHub's release says which platforms it carries, and a release run passes only when it published and its Mac acceptance run passed", () => {
  const asset = (name: string) => ({ name, browser_download_url: "", id: 1, size: 1 });
  assert.deepEqual(releasePlatforms({ tag_name: "v0.3.5", assets: ["storytree-0.3-0.3.5-setup.exe", "storytree-0.3-0.3.5-linux-x86_64.AppImage", "latest-linux.yml", "latest.yml"].map(asset) }), ["windows", "linux"]);
  assert.deepEqual(releasePlatforms({ tag_name: "v0.3.5", assets: ["storytree-0.3-0.3.4-setup.exe", "storytree-0.3-0.3.5-mac-arm64.zip", "latest-mac.yml"].map(asset) }), ["mac"]);
  // Windows' build is its two installers, one per architecture; one alone is not a build.
  const split = (...arches: string[]) => arches.map(arch => `storytree-0.3-0.3.5-windows-${arch}-setup.exe`);
  assert.deepEqual(releasePlatforms({ tag_name: "v0.3.5", assets: [...split("x64", "arm64"), "latest.yml"].map(asset) }), ["windows"]);
  assert.deepEqual(releasePlatforms({ tag_name: "v0.3.5", assets: [...split("x64"), "latest.yml"].map(asset) }), []);
  // A feed carried from an earlier build (4.6) is not this release's build of its platform.
  assert.deepEqual(releasePlatforms({ tag_name: "v0.3.5", assets: ["storytree-0.3-0.3.5-setup.exe", "latest.yml", "latest-mac.yml", "latest-linux.yml"].map(asset) }), ["windows"]);
  const run = (id: number, publish: string, acceptance: string | null) => ({ id, jobs: [{ name: "source", conclusion: "success" }, { name: "publish", conclusion: publish }, { name: "mac-acceptance / run", conclusion: acceptance }] });
  assert.equal(releaseRunPassed([]).passed, false);
  assert.equal(releaseRunPassed([run(1, "skipped", "skipped")]).passed, false);
  const failed = releaseRunPassed([run(1, "success", "failure")]);
  assert.equal(failed.passed, false);
  assert.match(failed.evidence, /acceptance.*did not pass.*runs\/1/);
  const rerun = releaseRunPassed([run(1, "success", "failure"), run(2, "success", "success")]);
  assert.equal(rerun.passed, true);
  assert.match(rerun.evidence, /Release run 2 published it.*acceptance run passed/);
});

test("4.23 an open friction or question naming a regression in a build passes over it and every later build; nothing fit names no candidate", async () => {
  const { state, ports } = fixture();
  state.concerns.push({ id: "friction_a", title: "The forest is blank", text: "Regression since 0.3.11: the forest draws nothing" });
  const found = await stableCandidate(ports);
  assert.equal(found.candidate, undefined);
  assert.deepEqual(found.passedOver.map(b => b.version), ["0.3.15", "0.3.14", "0.3.13", "0.3.12", "0.3.11"]);
  assert.match(found.passedOver[3]!.reasons.join(" "), /friction_a.*0\.3\.11/);
  assert.match(found.passedOver[4]!.reasons.join(" "), /friction_a/);
  // A report naming a build without a regression, or naming a longer build, passes over nothing.
  state.concerns.splice(0, 1, { id: "question_b", title: "Is 0.3.12 slow to start?", text: "It took a minute once" },
    { id: "friction_c", title: "Regression", text: "broke in 0.3.110" });
  assert.equal((await stableCandidate(ports)).candidate?.version, "0.3.12");
});

test("4.23 a concern naming a build more than once passes over each build for it once", async () => {
  const { state, ports } = fixture();
  state.concerns.push({ id: "friction_a", title: "Stable acceptance run: a regression in 0.3.11", text: "The run failed for 0.3.11.\nVERDICT: FAIL on 0.3.11" });
  const found = await stableCandidate(ports);
  assert.deepEqual(found.passedOver.map(b => b.reasons.filter(r => r.includes("friction_a")).length), [1, 1, 1, 1, 1]);
});

test("4.23 a build's tag is checked against its version from a shallow clone too, as a cloud session's checkout is", t => {
  const root = mkdtempSync(join(tmpdir(), "release-commit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitIn = (cwd: string) => (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const origin = join(root, "origin");
  mkdirSync(join(origin, "apps", "desktop"), { recursive: true });
  const og = gitIn(origin);
  og("init", "-q", "-b", "main");
  for (const n of [1, 2, 3]) {
    writeFileSync(join(origin, "apps", "desktop", "package.json"), JSON.stringify({ version: "0.3.0", releaseCountOffset: 10, n }));
    og("add", ".");
    og("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `build ${n}`);
  }
  og("tag", "v0.3.13");
  og("tag", "v0.3.14");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, join(root, "clone")]);
  const clone = gitIn(join(root, "clone"));
  assert.equal(releaseCommit(clone, "0.3.13"), og("rev-parse", "HEAD"));
  assert.throws(() => releaseCommit(clone, "0.3.14"), /Release tag and merged build version do not match/);
});

test("4.23 a build the lag run found an action slower in is passed over, naming that action", async () => {
  const { state, ports } = fixture();
  state.lag.push({ contract: "contract_island", state: "failing", commit: "c12",
    note: "open-most-island slower since c12 against its baseline c10, evidence pnpm lag:box, run 8, at commit c12" });
  const found = await stableCandidate(ports);
  assert.equal(found.candidate?.version, "0.3.11");
  assert.match(found.passedOver.find(b => b.version === "0.3.12")!.reasons.join(" "), /lag run.*open-most-island slower since c12.*run 8/);
});

test("4.23 a build the lag run has not measured, nor any later build with the same app code, is passed over until it has", async () => {
  const { state, ports } = fixture();
  state.lag = state.lag.filter(v => v.commit !== "c12");
  const found = await stableCandidate(ports);
  assert.equal(found.candidate?.version, "0.3.11");
  assert.match(found.passedOver.find(b => b.version === "0.3.12")!.reasons.join(" "), /lag run has not measured it/);
  // One action's contract measured is not enough: every catalogue action must have been measured.
  state.lag.push(lagWithin("c12")[0]!);
  const partly = await stableCandidate(ports);
  assert.equal(partly.candidate?.version, "0.3.11");
  assert.match(partly.passedOver.find(b => b.version === "0.3.12")!.reasons.join(" "), /not measured it.*for the actions of contract_start$/);
  // A later build measured counts for it only when its app code is the same.
  state.lag = state.lag.filter(v => v.commit !== "c12");
  state.sameApp.add("c12>c13");
  const later = await stableCandidate(ports);
  assert.equal(later.candidate?.version, "0.3.12");
  assert.match(later.candidate!.evidence.join("\n"), /at commit c13/);
});

test("4.23 the candidate is a build whose lag run found nothing slower, printing the run, its commit and each action's verdict", async () => {
  const { ports } = fixture();
  const found = await stableCandidate(ports);
  assert.equal(found.candidate?.version, "0.3.12");
  const evidence = found.candidate!.evidence.join("\n");
  assert.match(evidence, /open-most-island within the margin.*close-panel within the margin.*run 7, at commit c12/);
  assert.match(evidence, /open-app-kept within the margin.*run 7, at commit c12/);
});

test("4.23 a later build has the same app code when it changed nothing the desktop app reaches, and the lag run's verdicts are read with the commit each measured", () => {
  const app = appCode([
    { folder: "apps/desktop", json: { name: "@storytree/desktop", devDependencies: { "@storytree/forest": "workspace:*" } } },
    { folder: "packages/forest", json: { name: "@storytree/forest", dependencies: { "@storytree/library": "workspace:*" }, devDependencies: { "@storytree/cli": "workspace:*" } } },
    { folder: "packages/library", json: { name: "@storytree/library" } },
    { folder: "packages/cli", json: { name: "@storytree/cli", dependencies: { "@storytree/forest": "workspace:*" } } },
  ]);
  assert.equal(app("packages/library/src/api/library.ts"), true);
  assert.equal(app("apps/desktop/src/main.ts"), true);
  assert.equal(app("pnpm-lock.yaml"), true);
  assert.equal(app("packages/cli/src/main.ts"), false);
  assert.equal(app("packages/forest-world/src/globe.ts"), false);
  const sha = "3fc702fdeb51528568d627e98cd84be20d407696";
  assert.deepEqual(lagVerdicts("contract_island", [
    { column: "verified", state: "passing", note: `open-most-island within the margin of its baseline 3fc702fd, evidence pnpm lag:box, run 251, at commit ${sha}` },
    { column: "verified", state: "not-checked", note: "NOT RUN: the box is busy" },
    { column: "reported", state: "failing", note: `at commit ${sha}` },
  ]), [{ contract: "contract_island", state: "passing", commit: sha, note: `open-most-island within the margin of its baseline 3fc702fd, evidence pnpm lag:box, run 251, at commit ${sha}` }]);
});

test("4.23 a later main commit measures the same app only when it follows the build and changed nothing the app reaches, read from a shallow clone too", async t => {
  const root = mkdtempSync(join(tmpdir(), "same-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitIn = (cwd: string) => (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const origin = join(root, "origin");
  const og = gitIn(origin);
  const write = (path: string, text: string) => {
    mkdirSync(join(origin, path, ".."), { recursive: true });
    writeFileSync(join(origin, path), text);
  };
  const commit = (message: string) => {
    og("add", ".");
    og("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message);
    return og("rev-parse", "HEAD");
  };
  mkdirSync(origin, { recursive: true });
  og("init", "-q", "-b", "main");
  write("apps/desktop/package.json", JSON.stringify({ name: "@storytree/desktop", devDependencies: { "@storytree/forest": "workspace:*" } }));
  write("packages/forest/package.json", JSON.stringify({ name: "@storytree/forest" }));
  write("packages/forest/src/a.ts", "1");
  write("packages/cli/package.json", JSON.stringify({ name: "@storytree/cli", dependencies: { "@storytree/forest": "workspace:*" } }));
  write("packages/cli/src/a.ts", "1");
  const build = commit("build");
  write("packages/cli/src/a.ts", "2");
  const cliOnly = commit("cli");
  og("branch", "side");
  write("packages/forest/src/a.ts", "2");
  const forest = commit("forest");
  og("checkout", "-q", "side");
  write("packages/cli/src/b.ts", "3");
  const offMain = commit("off main");
  og("checkout", "-q", "main");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, join(root, "clone")]);
  const same = sameAppCode(gitIn(join(root, "clone")));
  assert.equal(await same(build, build), true);
  assert.equal(await same(build, cliOnly), true);
  assert.equal(await same(build, forest), false);
  assert.equal(await same(cliOnly, build), false);
  assert.equal(await same(build, offMain), false);
});
