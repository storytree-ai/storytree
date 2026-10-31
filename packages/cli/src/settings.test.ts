/** Settings' thin front door runs offline, outside a project, with a throwaway home. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { arcSurfaces } from "@storytree/arc-surface/surfaces";
import { forestSurfaces } from "@storytree/forest/surfaces";
import { readSettings } from "@storytree/project-and-caller";
import { projectRecords as qualityRecords } from "@storytree/quality-assurance/project-records";
import { removeTemp } from "@storytree/test-waits";
import unbundled from "./parts/surfaces.js";
import { projectRecords } from "./mount.js";

import { BuiltCommand, inWorld, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("settings 10.1–10.6: the offline CLI shows, persists and refuses invalid changes, the library location included", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const defaults = await invoke(["settings", "show"]);
  assert.equal(defaults.code, 0, defaults.stderr);
  assert.match(defaults.stdout, /context-guidance.*600000.*default/);
  assert.match(defaults.stdout, /idle-after.*30m.*default/);

  const set = await invoke(["settings", "set", "context-guidance", "400000"]);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /context-guidance.*400000.*set/);
  const file = path.join(home, "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "context-guidance": 400_000 });
  assert.equal(readSettings(home)["context-guidance"].value, 400_000);
  assert.equal(readSettings(home)["context-guidance"].source, "set");

  const show = await invoke(["settings", "show"]);
  assert.equal(show.code, 0, show.stderr);
  assert.match(show.stdout, /context-guidance.*400000.*set/);
  assert.match(show.stdout, /positive whole number/);
  assert.match(show.stdout, /tokens/);
  assert.match(show.stdout, /default.*600000/);
  assert.match(show.stdout, /soft/i);

  const help = await invoke([]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /^\s+settings\b/m);
  const family = await invoke(["settings"]);
  assert.match(family.stdout, /storytree settings show/);
  assert.match(family.stdout, /storytree settings set <name> <value>/);

  for (const args of [["show", "extra"], ["set", "context-guidance"], ["set", "context-guidance", "1", "extra"], ["show", "--unknown=yes"]]) {
    const refused = await invoke(["settings", ...args]);
    assert.equal(refused.code, 2, refused.stderr);
    assert.match(refused.stderr, /usage: storytree settings/);
    assert.equal(readSettings(home)["context-guidance"].value, 400_000);
  }

  const before = readFileSync(file, "utf8");
  for (const [name, value, reason] of [["quiet-time", "1", /unknown setting/i], ["context-guidance", "-1", /positive whole number/i]] as const) {
    const refused = await invoke(["settings", "set", name, value]);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, reason);
    assert.equal(readFileSync(file, "utf8"), before);
  }

  writeFileSync(file, '{"context-guidance":null}');
  for (const args of [["show"], ["set", "context-guidance", "400000"]]) {
    const refused = await invoke(["settings", ...args]);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, /invalid settings file/i);
    assert.ok(refused.stderr.includes(file), refused.stderr);
    assert.equal(readFileSync(file, "utf8"), '{"context-guidance":null}');
  }

  writeFileSync(file, "{}");
  assert.match((await invoke(["settings", "show"])).stdout, /library: local \(default\)/);
  const cloud = await invoke(["settings", "set", "library", "cloudsql", "my-project:australia-southeast1:my-instance", "you@example.com"]);
  assert.equal(cloud.code, 0, cloud.stderr);
  assert.match(cloud.stdout, /library: cloudsql my-project:australia-southeast1:my-instance as you@example.com \(set\)/);
  assert.match((await invoke(["settings", "show"])).stdout, /library: cloudsql .* \(set\)/);
  const saved = readFileSync(file, "utf8");
  const refused = await invoke(["settings", "set", "library", "cloudsql", "not-a-connection-name", "you@example.com"]);
  assert.equal(refused.code, 1, refused.stderr);
  assert.match(refused.stderr, /project:region:instance/);
  assert.equal(readFileSync(file, "utf8"), saved);
  const local = await invoke(["settings", "set", "library", "local"]);
  assert.equal(local.code, 0, local.stderr);
  assert.match(local.stdout, /library: local \(set\)/);
  const idle = await invoke(["settings", "set", "idle-after", "10m"]);
  assert.equal(idle.code, 0, idle.stderr);
  assert.match(idle.stdout, /idle-after.*10m.*set/);
  assert.equal(readSettings(home)["idle-after"].value, "10m");
  assert.match((await invoke(["settings", "show"])).stdout, /idle-after.*10m.*set/);
  const idleSaved = readFileSync(file, "utf8");
  for (const value of ["soon", "0m", "-5m"]) {
    const refused = await invoke(["settings", "set", "idle-after", value]);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, /idle-after.*positive duration/i);
    assert.equal(readFileSync(file, "utf8"), idleSaved);
  }
});

test("settings: the app's surfaces are listed and switched from the command line (ADR-0750)", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const shown = await invoke(["settings", "show"]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /Sessions \(sessions\): on \(default\)/);
  assert.match(shown.stdout, /Forest globe \(globe\): always on/);

  const off = await invoke(["settings", "set", "surface", "sessions", "off"]);
  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, /Sessions \(sessions\): off \(set\)/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")), { surfaces: { sessions: { on: false } } });

  const refused = await invoke(["settings", "set", "surface", "globe", "off"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /always on/);
});

test("1.20 · `storytree settings show` lists the surfaces its story packages' manifests name, composed into its bundle by the plugin loader, and the same run unbundled: the forest's, then the arc surface's", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shown = await storytree(command.script, ["settings", "show"], { cwd: dir, home: path.join(dir, "home") });
  assert.equal(shown.code, 0, shown.stderr);
  const expected = [...forestSurfaces, ...arcSurfaces];
  const listed = [...shown.stdout.split("Surfaces of the app")[1]!.matchAll(/^  .+ \(([\w-]+)\): /gm)].map((line) => line[1]);
  assert.deepEqual(listed, expected.map((surface) => surface.id), "the bundle's Surfaces, in the menu's order");
  assert.equal(import.meta.resolve("#parts/surfaces"), new URL("./parts/surfaces.ts", import.meta.url).href, "the command line's #parts/surfaces is its composing module");
  assert.deepEqual(unbundled.parts, expected);
});

test("1.37 · a family a switched-off part declares is not listed, and asking for it says it is switched off, because of which part, and how to switch it on; `settings` stays mounted, the way back", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-parts-off-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const off = await invoke(["settings", "set", "part", "arc-surface", "off"]);
  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, /Switched off on this computer: app \(with arc-surface, which it stands on\), arc-surface, forest \(with arc-surface/);

  const listed = await invoke([]);
  assert.equal(listed.code, 0, listed.stderr);
  for (const family of ["arc", "question", "app"]) assert.doesNotMatch(listed.stdout, new RegExp(`^  ${family}\\b`, "m"), family);
  assert.match(listed.stdout, /^  settings\b/m);
  assert.match(listed.stdout, /^  library\b/m);

  const arc = await invoke(["arc", "list"]);
  assert.equal(arc.code, 1, arc.stdout);
  assert.match(arc.stderr, /storytree arc is not mounted: arc-surface is switched off on this computer\. Switch it on with: storytree settings set part arc-surface on/);
  const app = await invoke(["app"]);
  assert.match(app.stderr, /app is switched off on this computer because arc-surface, which it stands on, is off/);

  const on = await invoke(["settings", "set", "part", "arc-surface", "on"]);
  assert.equal(on.code, 0, on.stderr);
  assert.match((await invoke([])).stdout, /^  arc\b/m);

  const mapOff = await invoke(["settings", "set", "part", "map", "off"]);
  assert.equal(mapOff.code, 0, mapOff.stderr);
  const withoutMap = await invoke([]);
  for (const family of ["map", "affected"]) assert.doesNotMatch(withoutMap.stdout, new RegExp(`^  ${family}\\b`, "m"), family);
  const map = await invoke(["map", "--select", "story:any"]);
  assert.equal(map.code, 1, map.stdout);
  assert.match(map.stderr, /storytree map is not mounted: map is switched off on this computer\. Switch it on with: storytree settings set part map on/);
});

test("1.41 · with code review and architecture checks switched off, `storytree` starts and lists every family but theirs, asking for one says it is switched off, and `project delete` is handed no project records of theirs; with both on it is handed the QA ledger's (ADR-1170 D2)", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-review-off-"));
  t.after(() => removeTemp(dir));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const listed = await invoke([]);
  for (const family of ["quality", "check"]) assert.match(listed.stdout, new RegExp(`^  ${family}\\b`, "m"), `${family} is listed with both on`);
  assert.deepEqual(await projectRecords(home), qualityRecords, "the QA ledger's records are handed to project delete");

  for (const part of ["quality-assurance", "guardrails"]) assert.equal((await invoke(["settings", "set", "part", part, "off"])).code, 0);
  const off = await invoke([]);
  assert.equal(off.code, 0, off.stderr);
  for (const family of ["quality", "check"]) assert.doesNotMatch(off.stdout, new RegExp(`^  ${family}\\b`, "m"), `${family} is not listed`);
  for (const family of ["library", "arc", "workspace", "project", "settings"]) assert.match(off.stdout, new RegExp(`^  ${family}\\b`, "m"), `${family} is still listed`);
  const quality = await invoke(["quality", "checks"]);
  assert.equal(quality.code, 1, quality.stdout);
  assert.match(quality.stderr, /storytree quality is not mounted: quality-assurance is switched off on this computer/);
  assert.deepEqual(await projectRecords(home), [], "no part mounted keeps project records");
});

/**
 * A factory folder with one plugin, `my-health`, that declares a `health` family of its own, as ready-to-run JavaScript
 * importing nothing of storytree's: its verb's work is handed its context by the door (ADR-1112 D2).
 */
function healthPlugin(dir: string): string {
  const folder = path.join(dir, "factory");
  const plugin = path.join(folder, "plugins", "my-health");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { interface: 1, verbs: [{ from: "./verbs", export: "families" }] } }));
  writeFileSync(path.join(plugin, "verbs.js"), `const check = {
  consumers: ["agent", "user"],
  command: { family: "health", name: "check", summary: "my own health check" },
  tool: { name: "my_health_check", description: "my own health check" },
  inputs: {},
  callerless: true,
  act: async (_input, place) => ({ text: "my health is fine in " + place.folder }),
};
export const families = [{ name: "health", summary: "my own health, from my factory", order: 18, verbs: [check] }];
`);
  return folder;
}

test("plugin-loader 4.3 · 5.15 · through the command line, `settings set part ci-health plugin my-health` names what ci-health takes away and what my-health adds in its place, and `plugin check my-health --for ci-health` lists ci-health's commands my-health lacks", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-taken-")));
  t.after(() => removeTemp(dir));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });
  assert.equal((await invoke(["settings", "set", "factory", healthPlugin(dir)])).code, 0);

  const switched = await invoke(["settings", "set", "part", "ci-health", "plugin", "my-health"]);
  assert.equal(switched.code, 0, switched.stderr);
  assert.match(switched.stdout, /^ci-health takes away the command family health: health worklist, health ci\b/m);
  assert.match(switched.stdout, /^my-health adds in its place the command family health: health check; and the tool my_health_check\.$/m);
  const checked = await invoke(["plugin", "check", "my-health", "--for", "ci-health"]);
  assert.equal(checked.code, 0, checked.stderr);
  assert.match(checked.stdout, /^my-health stands in for ci-health, which provides what my-health does not: the commands health worklist, health ci\b/m);
});

test("1.40 · with a factory folder chosen and `settings set part ci-health plugin my-health`, the command line lists and runs the factory plugin's family where ci-health's was, its verb handed the door's place; `settings set part ci-health on` mounts ci-health's own again", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-stand-in-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });
  const folder = healthPlugin(dir);

  assert.equal((await invoke(["settings", "set", "factory", folder])).code, 0);
  const standIn = await invoke(["settings", "set", "part", "ci-health", "plugin", "my-health"]);
  assert.equal(standIn.code, 0, standIn.stderr);
  assert.match(standIn.stdout, /ci-health \(my-health stands in for it\)/);

  assert.match((await invoke([])).stdout, /^  health\s+my own health, from my factory$/m);
  const ran = await invoke(["health", "check"]);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout.trim().split("\n")[0], `my health is fine in ${dir}`);
  assert.match((await invoke(["settings", "show"])).stdout, /^  ci-health: off, my-health stands in for it \(switched (by session \S+ )?from the command line, \d{4}-\d\d-\d\dT[^)]*\)$/m);

  assert.equal((await invoke(["settings", "set", "part", "ci-health", "on"])).code, 0);
  const restored = (await invoke([])).stdout;
  assert.doesNotMatch(restored, /my own health/);
  assert.match(restored, /^  health\s+the health worklist, and reading a project's CI/m, "ci-health's own family is mounted again");
  assert.notEqual((await invoke(["health", "check"])).code, 0, "and the plugin's verb is gone with it");
});

test("plugin-loader 5.13 · a fresh `plugin new my-extra`, with no --for, is added with `settings set part my-extra plugin my-extra`: the command line lists and runs its verb, `settings show` says the plugin adds it, and `settings set part my-extra on` takes it away again", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-added-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const made = await invoke(["plugin", "new", "my-extra"]);
  assert.equal(made.code, 0, made.stderr);
  const added = await invoke(["settings", "set", "part", "my-extra", "plugin", "my-extra"]);
  assert.equal(added.code, 0, added.stderr);
  assert.match(added.stdout, /^Added on this computer: my-extra \(by the factory plugin my-extra\)\./m);

  assert.match((await invoke([])).stdout, /^  my-extra\s+what my-extra adds$/m);
  const ran = await invoke(["my-extra", "hello"]);
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout.trim().split("\n")[0], `my-extra is mounted, called in ${dir}`);
  assert.match((await invoke(["settings", "show"])).stdout, /^  my-extra: added by the factory plugin my-extra \(switched /m);

  assert.equal((await invoke(["settings", "set", "part", "my-extra", "on"])).code, 0);
  assert.doesNotMatch((await invoke([])).stdout, /what my-extra adds/);
  assert.notEqual((await invoke(["my-extra", "hello"])).code, 0, "and its verb is gone with it");
});

test("1.44 · a factory plugin mounted in a switched-off part's place writes its own kind of record through the command line, which opens the project with the kinds the plugin declares, and library read reads it live; with the part switched on again it reads dormant (ADR-1178 D3)", async () => {
  await inWorld(command, async (world) => {
    const folder = path.join(world.elsewhere, "factory");
    const plugin = path.join(folder, "plugins", "my-health");
    mkdirSync(plugin, { recursive: true });
    const reading = { kind: "my-health.reading", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["my_health"] };
    writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { interface: 1, verbs: [{ from: "./verbs", export: "families" }], recordKinds: [reading] } }));
    writeFileSync(path.join(plugin, "verbs.js"), `const note = {
  consumers: ["agent", "user"],
  command: { family: "health", name: "note", summary: "keep a health reading" },
  tool: { name: "my_health_note", description: "keep a health reading" },
  inputs: { words: { kind: "text", word: 0, describe: "the reading" } },
  act: async ({ words }, { library, writer }) => ({ text: (await library.createPluginRecord("my-health.reading", { words }, writer)).id }),
};
export const families = [{ name: "health", summary: "my own health, from my factory", order: 18, verbs: [note] }];
`);
    assert.equal((await world.run(["settings", "set", "factory", folder])).code, 0);
    assert.equal((await world.run(["settings", "set", "part", "ci-health", "plugin", "my-health"])).code, 0);

    const noted = await world.run(["health", "note", "steady"]);
    assert.equal(noted.code, 0, noted.stderr);
    const id = noted.stdout.trim().split("\n")[0]!;
    const live = await world.run(["library", "read", id]);
    assert.equal(live.code, 0, live.stderr);
    assert.match(live.stdout, /^my-health\.reading_\S+  \[my-health\.reading\]  schema 1$/m);
    assert.match(live.stdout, /^words: steady$/m);

    assert.equal((await world.run(["settings", "set", "part", "ci-health", "on"])).code, 0);
    const dormant = await world.run(["library", "read", id]);
    assert.equal(dormant.code, 0, dormant.stderr);
    assert.match(dormant.stdout, /\[my-health\.reading\]  schema 1  dormant: its plugin is not mounted on this computer$/m);
  });
});

test("1.39 · `settings set system roles off` leaves the project's roles out of what `library list` and `library search` give at the next command, and `library read` still reads one by its id; a role switched on by its title shows again; `settings show` lists what is off and on (ADR-1092 D2)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const note = await library.writeKnowledge("principle", { title: "Mail kindly", description: "Mail kindly", statement: "Send kind mail", why: "Why", howToApply: "How" });
    const role = await library.writeKnowledge("agent", { title: "Mailer", description: "Sends mail", oneLine: "Sends mail", role: "Mailer", outcome: "Mail sent", context: [note.id], tools: "Mailgun", workflow: "Send the mail" });

    const off = await world.run(["settings", "set", "system", "roles", "off"]);
    assert.equal(off.code, 0, off.stderr);
    assert.match(off.stdout, /^  off: roles$/m);
    const roles = await world.run(["library", "list", "agent"]);
    assert.equal(roles.code, 0, roles.stderr);
    assert.ok(!roles.stdout.includes(role.id), roles.stdout);
    const notes = await world.run(["library", "list", "principle"]);
    assert.ok(notes.stdout.includes(note.id), notes.stdout);
    const searched = await world.run(["library", "search", "mail"]);
    assert.equal(searched.code, 0, searched.stderr);
    assert.ok(!searched.stdout.includes(role.id) && searched.stdout.includes(note.id), searched.stdout);
    const read = await world.run(["library", "read", role.id]);
    assert.equal(read.code, 0, read.stderr);
    assert.ok(read.stdout.includes("Send the mail"), read.stdout);

    const on = await world.run(["settings", "set", "system", "Mailer", "on"]);
    assert.equal(on.code, 0, on.stderr);
    assert.ok((await world.run(["library", "list", "agent"])).stdout.includes(role.id));
    const shown = await world.run(["settings", "show"]);
    assert.match(shown.stdout, /^  off: roles\n  on: Mailer$/m);
  });
});
