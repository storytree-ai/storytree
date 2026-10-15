import assert from "node:assert/strict";
import test from "node:test";
import { type CandidatePorts, type PublishedBuild, stableCandidate } from "./stable-candidate.js";
import { releasePlatforms, releaseRunPassed } from "./stable-github.js";
import type { StableManifest } from "./stable-pin.js";

const NOW = "2026-10-16T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();
const pin = { version: "0.3.10", pin: { covers: ["windows", "mac", "linux"] } } as unknown as StableManifest;

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
