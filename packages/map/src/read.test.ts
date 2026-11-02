import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { AnnotatedTree } from "@storytree/library";
import { capabilitiesCommand, incrementOfBranch, mapCommand } from "./read.js";

test("3.4 the map command reads the current plan and survey and exposes counts, dry-run, show and refusal as text or JSON", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-command-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] }] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async () => plan };
    for (const mode of ["counts", "dry_run", "show"] as const) {
      const options = { select: "file:packages/app/src/view.ts", up: 1, mode };
      const json = JSON.parse(await mapCommand(library, folder, options, true));
      const text = await mapCommand(library, folder, options);
      assert.equal(json.rowCount, 4);
      assert.match(text, /4 rows/);
      assert.equal(json.rows !== undefined, mode === "show");
      if (mode === "show") assert.ok(json.rows.some((row: { id: string }) => row.id === "empty"));
    }
    plan.stories[0]!.capabilities[0]!.contracts = Array.from({ length: 201 }, (_, n) => ({ id: `promise-${n}`, title: `2.${n + 1} promise`, health: health as never }));
    const options = { select: "cap:projects", down: 1, mode: "show" as const };
    const refused = JSON.parse(await mapCommand(library, folder, options, true));
    assert.equal(refused.refused, true);
    assert.equal(refused.rows, undefined);
    assert.match(await mapCommand(library, folder, options), /Show refused/);
  } finally {
    await removeTemp(folder);
  }
});

test("3.6 in a branch's checkout the map reads the plan with that branch's increment's pending changes laid over; elsewhere the live plan", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-branch-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: folder, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "base");
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const capability = { id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] };
    const live = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [capability] }] } as unknown as AnnotatedTree;
    const pending = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ ...capability, contracts: [] }] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async (options?: { pendingOf?: string | undefined }) => (options?.pendingOf === "increment_ca8ba53211b7" ? pending : live) };
    const promises = async (): Promise<number> => {
      const answer = JSON.parse(await mapCommand(library, folder, { select: "cap:projects", down: 1, mode: "show" }, true));
      return answer.rows.filter((row: { kind: string }) => row.kind === "promise").length;
    };
    assert.equal(await promises(), 1, "main reads the live plan");
    git("checkout", "-q", "-b", "claude/increment-ca8ba53211b7-f8f424");
    assert.equal(await promises(), 0, "the increment's branch reads its pending retirement");
    assert.equal(incrementOfBranch("claude/dazzling-jones-f96c61"), undefined);
  } finally {
    await removeTemp(folder);
  }
});

test("3.11 with --capabilities, the map answers a selected story's capabilities in one read: each with its health word and reason, its contracts, the capabilities it depends on, and its source files with their lines of code, tests left out; --json gives it as data", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-capabilities-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;\n\nexport const more = 2;\n");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    await writeFile(path.join(folder, "packages/app/src/lone.ts"), "export const lone = 1;\n");
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const why = { reason: "no test names it", mover: "agent", contracts: ["save"] };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [
      { id: "projects", title: "2 · Projects", health, status: "healthy", dependsOn: ["saving"], contracts: [{ id: "empty", title: "2.5 · empty view", health }] },
      { id: "saving", title: "3 · Saving", health, status: "untested", why, dependsOn: [], contracts: [{ id: "save", title: "3.1 · saves", health }] },
    ] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async () => plan };

    const data = JSON.parse(await capabilitiesCommand(library, folder, "story:The app", true));

    assert.deepEqual(data, {
      story: { id: "app", title: "The app" },
      capabilities: [
        { id: "projects", title: "2 · Projects", health: "healthy", dependsOn: ["saving"], contracts: [{ id: "empty", number: "2.5", title: "2.5 · empty view" }], files: [{ path: "packages/app/src/view.ts", lines: 2 }], lines: 2 },
        { id: "saving", title: "3 · Saving", health: "untested", why, dependsOn: [], contracts: [{ id: "save", number: "3.1", title: "3.1 · saves" }], files: [], lines: 0 },
      ],
      unclaimed: [{ path: "packages/app/src/lone.ts", lines: 1 }],
    });
    const text = await capabilitiesCommand(library, folder, "app");
    assert.match(text, /2 · Projects  \[projects\]  healthy; 2 lines in 1 file; 1 contract; depends on saving/);
    assert.match(text, /3 · Saving  \[saving\]  untested — no test names it, the agent's to move: 3\.1; 0 lines in 0 files/);
    assert.match(text, /packages\/app\/src\/view\.ts  2/);
    await assert.rejects(capabilitiesCommand(library, folder, "story:Nothing"), /Map selection not found: story:Nothing/);
  } finally {
    await removeTemp(folder);
  }
});
