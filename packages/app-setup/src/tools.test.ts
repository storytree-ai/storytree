/** Capability 12 · Import an existing project: the import_project tool, as App setup's tool part serves it on the MCP server. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect } from "@storytree/library";

import { setUpProject } from "./project/making.js";
import { setupToolParts } from "./tools.js";

type Tool = (args: Record<string, unknown>, call: never) => Promise<{ text: string; refused?: boolean }>;

/** The tools App setup's part registers, by name. */
function setupTools(): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const part of setupToolParts) part({}).registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  return tools;
}

test("12.3 · the import_project tool answers a folder that does not exist with the refusal saying there is nothing to import, marked refused, reading nothing", async () => {
  const tools = setupTools();
  // A call whose library and connection throw on any read: the refusal comes first.
  const unread = () => { throw new Error("read"); };
  const call = { library: new Proxy({}, { get: unread }), storytree: new Proxy({}, { get: unread }), project: "shop", folder: path.resolve("/nowhere-here") } as never;
  const answered = await tools.import_project!({ folder: "gone" }, call);
  assert.equal(answered.refused, true);
  assert.match(answered.text, /gone does not exist, so there is nothing to import\.$/);
});

test("12.8, 12.9 · import_project's reply on a folder it maps tells the agent to run `storytree health local` now, in its own shell, and says that run's reply names the capabilities left red, and asks for one arc fixing them, each increment naming its capability, with the user's own requests on it (ADR-1271)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const trunk = path.join(dir, "storytree-project");
    const shop = path.join(dir, "shop");
    mkdirSync(trunk);
    mkdirSync(shop);
    writeFileSync(path.join(shop, "package.json"), JSON.stringify({ name: "shop" }));
    const storytree = await connect({ url: testServerUrl() });
    try {
      await setUpProject({ folder: trunk, project, storytree, storytreeHome: path.join(dir, "home") });
      const library = await storytree.openProject(project);
      try {
        const answered = await setupTools().import_project!({ folder: "../shop" }, { library, storytree, project, folder: trunk } as never);
        assert.equal(answered.refused, undefined, answered.text);
        assert.match(answered.text, /Run `storytree health local` now, in your shell/);
        assert.match(answered.text, /names the capabilities it leaves red/);
        assert.match(answered.text, /plan one arc/);
        assert.match(answered.text, /capabilities list naming it/);
        assert.match(answered.text, /the user's own requests/);
      } finally {
        await library.close();
      }
    } finally {
      try {
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
});

test("12.1 · import_project's reply asks the agent to name and describe the capabilities storytree drew, never to merge, split or redraw them, and to map by reading only a story whose code storytree cannot read, naming it", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const trunk = path.join(dir, "storytree-project");
    const shop = path.join(dir, "shop");
    mkdirSync(trunk);
    mkdirSync(path.join(shop, "packages", "cart"), { recursive: true });
    mkdirSync(path.join(shop, "packages", "tool"), { recursive: true });
    writeFileSync(path.join(shop, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFileSync(path.join(shop, "packages", "cart", "package.json"), JSON.stringify({ name: "cart" }));
    writeFileSync(path.join(shop, "packages", "cart", "index.js"), "export const cart = 1;\n");
    writeFileSync(path.join(shop, "packages", "tool", "package.json"), JSON.stringify({ name: "tool" }));
    writeFileSync(path.join(shop, "packages", "tool", "main.go"), "package main\n");
    const storytree = await connect({ url: testServerUrl() });
    try {
      await setUpProject({ folder: trunk, project, storytree, storytreeHome: path.join(dir, "home") });
      const library = await storytree.openProject(project);
      try {
        const answered = await setupTools().import_project!({ folder: "../shop" }, { library, storytree, project, folder: trunk } as never);
        assert.equal(answered.refused, undefined, answered.text);
        const stories = await library.list("story");
        const id = (title: string) => stories.find((story) => story.fields.title === title)!.id;
        assert.ok(answered.text.includes(`: "cart" (${id("cart")}), capabilities drawn: 1`), answered.text);
        assert.match(answered.text, /Name and describe each capability storytree drew with edit_plan/);
        assert.match(answered.text, /Do not merge, split or redraw them/);
        assert.ok(answered.text.includes(`storytree cannot read the code of "tool" (${id("tool")}): map its capabilities by reading it`), answered.text);
        assert.ok(!answered.text.includes(`"cart" (${id("cart")}): map`), answered.text);
      } finally {
        await library.close();
      }
    } finally {
      try {
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
});
