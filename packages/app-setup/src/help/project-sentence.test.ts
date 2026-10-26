import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { setupHelpActions } from "./actions.js";
import { saveProjectSentence } from "../view/project-sentence.js";

test("3.9 Settings → Projects reads the selected project's sentence (what it is, who it is for) and saves each half through the library; a half left empty is unsaid, and a project not in the library is refused", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const shop = `shop-t-${randomBytes(4).toString("hex")}`;
  const home = mkdtempSync(path.join(tmpdir(), "storytree-app-sentence-"));
  const library = await connect({ url });
  t.after(async () => {
    await library.close();
    await dropTestDatabases([`storytree_${shop}`]);
    rmSync(home, { recursive: true, force: true });
  });
  await (await library.openProject(shop)).close();
  const actions = setupHelpActions({
    licenseFile: "", storytreeHome: home, chooseFolder: async () => undefined,
    openExternal: async () => {}, copyText: async () => {}, library: () => library,
  });

  assert.deepEqual(await actions.projectSentence(shop), {}, "nothing said yet");
  assert.deepEqual(await saveProjectSentence(actions, shop, { what: "  a shop builder ", audience: "" }), { saved: { what: "a shop builder" } });
  assert.deepEqual(await actions.projectSentence(shop), { what: "a shop builder" }, "the half typed is kept, trimmed; the empty one stays unsaid");
  assert.deepEqual(await saveProjectSentence(actions, shop, { what: "a shop builder", audience: "small shops" }), { saved: { what: "a shop builder", audience: "small shops" } });
  const anchored = await library.openProject(shop, { create: false });
  try {
    assert.deepEqual(await anchored.anchor(), { what: "a shop builder", audience: "small shops" }, "saved as the project's anchor in the library");
  } finally {
    await anchored.close();
  }
  assert.deepEqual(await saveProjectSentence(actions, shop, { what: "", audience: "small shops" }), { saved: { audience: "small shops" } }, "emptying a half unsays it");

  const missing = `nothing-${shop}`;
  await assert.rejects(actions.projectSentence(missing));
  const refused = await saveProjectSentence(actions, missing, { what: "a blog", audience: "" });
  assert.ok("failed" in refused && refused.failed.startsWith("The sentence could not be saved: "), "a refusal is said, not reported as saved");
  assert.equal((await library.listProjects()).includes(missing), false, "saving makes no project");
});
