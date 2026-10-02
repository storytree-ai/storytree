import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { focusProject, mapCommand } from "./read.js";

async function repository(t: TestContext) {
  const folder = await mkdtemp(path.join(tmpdir(), "map-affected-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  const write = async (name: string, text: string) => { await mkdir(path.dirname(path.join(folder, name)), { recursive: true }); await writeFile(path.join(folder, name), text); };
  const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
  const names = ["core", "importer", "downstream", "unrelated"];
  const plan = { arcs: [], stories: [{ id: "shop", title: "Shop", health, capabilities: names.map((name, i) => ({ id: name, title: `${i + 1} · ${name}`, health, dependsOn: name === "downstream" ? ["importer"] : [], contracts: [{ id: `${name}-promise`, title: `${i + 1}.1 ${name} works`, health }] })) }] } as unknown as AnnotatedTree;
  await write("packages/shop/package.json", '{"name":"@example/shop"}');
  for (const [i, name] of names.entries()) {
    await write(`packages/shop/src/${name}.ts`, name === "importer" ? 'import { core } from "./core.js";\nexport const importer = core;\n' : `export const ${name} = 1;\n`);
    await write(`packages/shop/src/${name}.test.ts`, `import { ${name} } from "./${name}.js";\ntest("${i + 1}.1 ${name} works", () => ${name});\n`);
  }
  git("init"); git("add", ".");
  const commit = (message: string) => git("-c", "user.name=Map test", "-c", "user.email=map@example.test", "-c", "commit.gpgsign=false", "commit", "-m", message);
  commit("baseline");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  let reads = 0;
  const library = { projectTree: async () => { reads++; return plan; } };
  return { folder, git, write, commit, base, library, reads: () => reads };
}

test("4.1 working changes reach reverse importers, owners, promises and dependents while counts stay bounded", async t => {
  const repo = await repository(t);
  await repo.write("packages/shop/src/core.ts", "export const core = 2;\n");
  await repo.write("packages/shop/src/unclaimed.ts", "export const unclaimed = 1;\n");
  await repo.write("notes/new file.md", "An unsurveyed change.\n");
  const options = { select: "diff:origin/main", mode: "show" as const };
  const shown = await focusProject(repo.library, path.join(repo.folder, "packages/shop/src"), options);
  assert.equal(repo.reads(), 1, "both code readings use one current plan");
  const ids = shown.rows!.map(row => row.id);
  for (const id of ["core", "core-promise", "importer", "importer-promise", "downstream", "downstream-promise", "file:packages/shop/src/importer.ts", "test:packages/shop/src/downstream.test.ts"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("unrelated"));
  assert.ok(!shown.rows!.some(row => row.kind === "story"));
  assert.equal(shown.rows!.find(row => row.id === "file:notes/new file.md")?.unresolved !== undefined, true);
  assert.equal(shown.rows!.find(row => row.id === "file:packages/shop/src/unclaimed.ts")?.unresolved !== undefined, true);
  assert.deepEqual(shown.selected, ["diff:origin/main"]);
  assert.equal(shown.diff?.changedPaths, 3);
  assert.equal(shown.diff?.unresolved, 2);
  assert.equal(shown.diff?.statuses.untracked, 2);
  assert.equal(shown.rows!.find(row => row.id === "core")?.snapshot, "both");
  for (const mode of ["counts", "dry_run"] as const) {
    const answer = await focusProject(repo.library, repo.folder, { ...options, mode });
    assert.equal(answer.rows, undefined);
    assert.equal(answer.rowCount, shown.rowCount);
    assert.equal(answer.estimatedTokens, shown.estimatedTokens);
  }
  const filtered = await focusProject(repo.library, repo.folder, { ...options, kind: ["capability"] });
  assert.deepEqual(filtered.rows!.map(row => row.id).sort(), ["core", "downstream", "importer"]);
  const shallow = await focusProject(repo.library, repo.folder, { ...options, down: 1 });
  assert.ok(shallow.rows!.some(row => row.id === "core"));
  assert.ok(!shallow.rows!.some(row => row.id === "importer"));
  const upstream = await focusProject(repo.library, repo.folder, { ...options, up: 1 });
  assert.ok(!upstream.rows!.some(row => row.id === "file:packages/shop/src/importer.ts"));
  assert.match(await mapCommand(repo.library, repo.folder, options), /untracked.*unresolved|unresolved.*untracked/);
});

test("4.1 historical ranges retain deleted and renamed proof, ignore dirty state, and reject bad refs", async t => {
  const repo = await repository(t);
  await rename(path.join(repo.folder, "packages/shop/src/core.ts"), path.join(repo.folder, "packages/shop/src/moved.ts"));
  await rm(path.join(repo.folder, "packages/shop/src/importer.test.ts"));
  repo.git("add", "-A"); repo.commit("rename and remove proof");
  const target = repo.git("rev-parse", "HEAD");
  await repo.write("packages/shop/src/unrelated.ts", "export const unrelated = 99;\n");
  await repo.write("not part of history.md", "dirty\n");
  for (const delimiter of ["..", "..."]) {
    const answer = await focusProject(repo.library, repo.folder, { select: `diff:${repo.base}${delimiter}${target}`, mode: "show" });
    assert.equal(answer.diff?.renames, 1);
    assert.equal(answer.diff?.changedPaths, 3);
    assert.ok(answer.rows!.some(row => row.id === "importer-promise"));
    assert.ok(!answer.rows!.some(row => row.id.includes("unrelated") || row.path === "not part of history.md"));
    assert.deepEqual(answer.rows!.find(row => row.path === "packages/shop/src/core.ts")?.changes, ["renamed-from"]);
    assert.equal(answer.rows!.find(row => row.path === "packages/shop/src/core.ts")?.snapshot, "base");
    assert.deepEqual(answer.rows!.find(row => row.path === "packages/shop/src/moved.ts")?.changes, ["renamed-to"]);
    assert.equal(answer.rows!.find(row => row.path === "packages/shop/src/moved.ts")?.snapshot, "target");
    assert.deepEqual(answer.rows!.find(row => row.path === "packages/shop/src/importer.test.ts")?.changes, ["deleted"]);
  }
  await assert.rejects(focusProject(repo.library, repo.folder, { select: "diff:no-such-ref" }), /ref|revision/i);
  const worktree = path.join(repo.folder, "linked");
  repo.git("worktree", "add", "--detach", worktree, "HEAD");
  await writeFile(path.join(worktree, "linked note.md"), "new\n");
  const linked = await focusProject(repo.library, path.join(worktree, "packages/shop"), { select: "diff:HEAD", mode: "show" });
  assert.deepEqual(linked.rows!.map(row => row.path), ["linked note.md"]);
});

test("4.1 unsurveyed paths share the show ceiling and do not expand counts metadata", async t => {
  const repo = await repository(t);
  await Promise.all(Array.from({ length: 205 }, (_, i) => repo.write(`notes/${i}.md`, "new\n")));
  const answer = await focusProject(repo.library, repo.folder, { select: "diff:", mode: "show" });
  assert.equal(answer.refused, true);
  assert.equal(answer.rows, undefined);
  assert.equal(answer.rowCount, 205);
  assert.equal(answer.diff?.unresolved, 205);
  assert.deepEqual(answer.selected, ["diff:origin/main"]);
  assert.ok(JSON.stringify(answer).length < 2000, "counts metadata does not list every changed path");
});

test("4.1 diverged refs distinguish two-dot endpoints from merge-base and current-worktree comparisons", async t => {
  const repo = await repository(t);
  repo.git("checkout", "-b", "side");
  await repo.write("packages/shop/src/unrelated.ts", "export const unrelated = 7;\n");
  repo.git("add", "-A"); repo.commit("side changes unrelated");
  repo.git("checkout", "--detach", repo.base);
  await repo.write("packages/shop/src/core.ts", "export const core = 7;\n");
  repo.git("add", "-A"); repo.commit("head changes core");
  await repo.write("dirty.md", "working only\n");
  const endpoints = await focusProject(repo.library, repo.folder, { select: "diff:side..HEAD", mode: "show" });
  assert.ok(endpoints.rows!.some(row => row.id === "unrelated"));
  assert.equal(endpoints.diff?.changedPaths, 2);
  const branch = await focusProject(repo.library, repo.folder, { select: "diff:side...HEAD", mode: "show" });
  assert.equal(branch.diff?.base, repo.base);
  assert.equal(branch.diff?.changedPaths, 1);
  assert.ok(!branch.rows!.some(row => row.id === "unrelated" || row.path === "dirty.md"));
  const current = await focusProject(repo.library, repo.folder, { select: "diff:side", mode: "show" });
  assert.equal(current.diff?.base, repo.base);
  assert.equal(current.diff?.changedPaths, 2);
  assert.ok(current.rows!.some(row => row.path === "dirty.md"));
});
