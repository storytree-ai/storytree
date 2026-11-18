import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { mountedPartsFor, unmountedParts } from "./mounted-parts.mjs";

const git = (root, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" });

function write(root, name, pkg) {
  mkdirSync(path.join(root, "packages", name), { recursive: true });
  writeFileSync(path.join(root, "packages", name, "package.json"), JSON.stringify({ name: `@storytree/${name}`, ...pkg }));
}

function workspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mounted-parts-"));
  t.after(() => removeTemp(root));
  git(root, "init", "-q", "-b", "main");
  write(root, "library", { storytree: {} });
  write(root, "agent-pool", { dependencies: { "@storytree/library": "workspace:*" }, storytree: { services: [] } });
  write(root, "glue", { dependencies: { "@storytree/library": "workspace:*" }, storytree: { verbs: [] } });
  write(root, "ci-health", { dependencies: { "@storytree/library": "workspace:*", pg: "^8" }, storytree: { verbs: [] } });
  write(root, "reports", { dependencies: { "@storytree/glue": "workspace:*" }, storytree: { verbs: [] } });
  write(root, "repo-checks", { dependencies: { "@storytree/ci-health": "workspace:*" }, storytree: { gateSteps: [] } });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "main");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

test("8.15 · pnpm gate fails a branch under which a part mounted on origin/main's parts graph is switched off by this computer's switched-off parts, naming the part and the new edge that took it off", (t) => {
  const root = workspace(t);
  assert.deepEqual(mountedPartsFor({ root }, () => []), { run: false, reason: "this computer switches no part off" });
  assert.deepEqual(mountedPartsFor({ root }, () => ["agent-pool"]), { run: true, reason: "this computer switches off agent-pool" });
  assert.deepEqual(unmountedParts(root, ["agent-pool"]), []);

  write(root, "ci-health", { dependencies: { "@storytree/library": "workspace:*", "@storytree/agent-pool": "workspace:*" }, storytree: { verbs: [] } });
  assert.deepEqual(unmountedParts(root, ["agent-pool"]), [
    "ci-health mounts on origin/main but is switched off here on this branch: its new edge ci-health → agent-pool stands it on agent-pool, which this computer switches off",
    "repo-checks mounts on origin/main but is switched off here on this branch: its new edge ci-health → agent-pool stands it on agent-pool, which this computer switches off",
  ]);
  assert.deepEqual(unmountedParts(root, ["voice"]), [], "a set that switches off nothing the new edge reaches passes");

  write(root, "ci-health", { dependencies: { "@storytree/library": "workspace:*" }, devDependencies: { "@storytree/agent-pool": "workspace:*" }, storytree: { verbs: [] } });
  assert.deepEqual(unmountedParts(root, ["agent-pool"]), [], "a services part taken as a development dependency draws no edge");

  write(root, "glue", { dependencies: { "@storytree/library": "workspace:*", "@storytree/agent-pool": "workspace:*" }, storytree: { verbs: [] } });
  assert.deepEqual(unmountedParts(root, ["agent-pool"]), [
    "glue mounts on origin/main but is switched off here on this branch: its new edge glue → agent-pool stands it on agent-pool, which this computer switches off",
    "reports mounts on origin/main but is switched off here on this branch: its new edge glue → agent-pool stands it on agent-pool, which this computer switches off",
  ], "a part reaching the switched-off one through a part it already stood on is named with the edge one hop further on");
});
