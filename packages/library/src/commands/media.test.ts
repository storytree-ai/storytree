/**
 * Capability 17 · The library's commands: contract 17.18, the `media` family, through both of its faces' declarations,
 * run with a caller on a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { LIBRARY_FAMILIES, type LibraryVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.18 · media attach keeps a file from the caller's folder beside a record, its type read from its extension unless given, media list names a record's files with their type, size and hash, and media get saves one back exactly; each is also a tool (attach_media, list_media, fetch_media), and the library's refusals are said", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-media-verbs-"));
  t.after(async () => {
    rmSync(folder, { recursive: true, force: true });
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "media");
  assert.ok(family !== undefined, "the library declares the media family");
  const faces = family.verbs.map((one) => [mounted(one.command) ? one.command.name : undefined, mounted(one.tool) ? one.tool.name : undefined]);
  assert.deepEqual(faces, [["attach", "attach_media"], ["list", "list_media"], ["get", "fetch_media"]]);
  const verbOf = (name: string) => family.verbs.find((one) => mounted(one.command) && one.command.name === name)! as Verb<VerbInputs, LibraryVerbContext>;
  const context: LibraryVerbContext = { library, project, session: "lane", folder, writer: { actor: "session:lane" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };

  const note = await library.defineTerm({ term: "Approved look", meaning: "The forest at dusk." });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
  writeFileSync(path.join(folder, "dusk.png"), png);
  writeFileSync(path.join(folder, "notes.bin"), Buffer.from("raw"));

  const attached = await verbOf("attach").act({ record: note.id, file: "dusk.png", name: undefined, type: undefined, replace: false }, context, WORDS);
  assert.match(attached.text, new RegExp(`Attached dusk\\.png \\(image/png, 11 bytes, sha256 [0-9a-f]{12}…\\) to ${note.id}`));
  const [entry] = await library.media(note.id);
  assert.deepEqual([entry?.name, entry?.type, entry?.addedBy], ["dusk.png", "image/png", "session:lane"]);
  await verbOf("attach").act({ record: note.id, file: "notes.bin", name: "notes.json", type: "application/json", replace: false }, context, WORDS);
  assert.equal((await library.media(note.id)).find((one) => one.name === "notes.json")?.type, "application/json", "a given name and type are kept");

  const listed = await verbOf("list").act({ record: note.id }, context, WORDS);
  assert.ok(listed.text.includes(`dusk.png  image/png  11 bytes  ${entry!.sha256.slice(0, 12)}`), listed.text);
  assert.ok(listed.text.includes("notes.json"), listed.text);
  assert.equal((await verbOf("list").act({ record: "glossary_000000000000" }, context, WORDS)).text, "glossary_000000000000 holds no media.");

  const got = await verbOf("get").act({ record: note.id, name: "dusk.png", out: "back/dusk.png" }, context, WORDS);
  assert.deepEqual(readFileSync(path.join(folder, "back", "dusk.png")), png, "saved back exactly, its folder made");
  assert.ok(got.text.includes(path.join(folder, "back", "dusk.png")), got.text);

  // The library's refusals and the caller's mistakes are said, not thrown as they are.
  writeFileSync(path.join(folder, "dusk.png"), Buffer.from("redrawn"));
  await assert.rejects(verbOf("attach").act({ record: note.id, file: "dusk.png", name: undefined, type: undefined, replace: false }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && /other bytes/.test(error.message));
  assert.match((await verbOf("attach").act({ record: note.id, file: "dusk.png", name: undefined, type: undefined, replace: true }, context, WORDS)).text, /^Replaced dusk\.png/);
  await assert.rejects(verbOf("attach").act({ record: "glossary_000000000000", file: "dusk.png", name: undefined, type: undefined, replace: false }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && /no live record/.test(error.message));
  await assert.rejects(verbOf("attach").act({ record: note.id, file: "missing.png", name: undefined, type: undefined, replace: false }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes("missing.png"));
  await assert.rejects(verbOf("get").act({ record: note.id, name: "dawn.png", out: "dawn.png" }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && /dawn\.png/.test(error.message) && /dusk\.png/.test(error.message), "names the files it does hold");
});
