import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { mapCommand } from "./read.js";

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
      assert.equal(json.rowCount, 3);
      assert.match(text, /3 rows/);
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
    await rm(folder, { recursive: true, force: true });
  }
});
