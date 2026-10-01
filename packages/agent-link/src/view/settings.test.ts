import assert from "node:assert/strict";
import { test } from "node:test";
import { readSettings } from "../settings/settings.js";
import { withTempDir } from "../testing/folders.js";
import { readState, renderSettings, saveState, settle } from "./render.js";

test("10.7 the panel renders every reading with its value, source, meaning and labelled control", async () => {
  await withTempDir((home) => {
    const readings = readSettings(home);
    const html = renderSettings(readings);
    assert.match(html, /Context guidance/);
    assert.match(html, /value="600000"/);
    assert.match(html, /Time before a quiet claim can be taken over/);
    assert.match(html, /input[^>]+inputmode="text"[^>]+value="30m"/);
    assert.match(html, /default/);
    assert.ok(html.includes(readings["context-guidance"].meaning));
    assert.match(html, /<label for="[^"]+">Where the library lives<\/label>/);
    assert.match(html, /<option value="local" selected>/);
    // An additional numeric reading needs no view change; metadata also stays inert as HTML.
    const additional = { ...readings["context-guidance"], name: "next-setting", meaning: '<img src=x onerror="bad()">', value: 42, source: "set" as const };
    const more = renderSettings({ ...readings, "next-setting": additional });
    assert.match(more, /Next setting/);
    assert.match(more, /value="42"/);
    assert.match(more, /set by you/);
    assert.match(more, /&lt;img/);
    assert.doesNotMatch(more, /<img/);
  });
});

test("10.7 each settings tab shows the settings that declare its group, and a new one joins by its group alone", async () => {
  await withTempDir((home) => {
    const readings = readSettings(home);
    const names = (html: string) => [...html.matchAll(/data-setting="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names(renderSettings(readings, "sessions")), ["context-guidance", "idle-after", "leave-after"]);
    assert.deepEqual(names(renderSettings(readings, "library")), ["library"]);
    const quiet = { ...readings["context-guidance"], name: "quiet-after" };
    assert.deepEqual(names(renderSettings({ ...readings, "quiet-after": quiet }, "sessions")).at(-1), "quiet-after");
  });
});

test("10.9 a failed read shows its reason and Retry, and no rows: never defaults in its place", async () => {
  const refused = readState({ ok: false, error: "settings.json is not valid JSON" });
  assert.deepEqual(refused, { rows: "", error: "settings.json is not valid JSON", retry: true });
  const lost = readState(await settle(Promise.reject(new Error("the app did not answer"))));
  assert.deepEqual(lost, { rows: "", error: "the app did not answer", retry: true });
  await withTempDir((home) => {
    const readings = readSettings(home);
    assert.deepEqual(readState({ ok: true, value: readings }, "sessions"), { rows: renderSettings(readings, "sessions"), error: undefined, retry: false });
  });
});

test("10.9 a save whose transport fails shows its reason and leaves Save available for retry; a saved one reads set by you", async () => {
  const lost = saveState("context-guidance", await settle(Promise.reject(new Error("the app did not answer"))));
  assert.deepEqual(lost, { error: "the app did not answer", status: "", saveAvailable: true, set: false });
  const saved = saveState("context-guidance", { ok: true, value: {} });
  assert.deepEqual(saved, { error: "", status: "Saved", saveAvailable: false, set: true });
  assert.equal(saveState("library", { ok: true, value: {} }).status, "Saved · applies when storytree next opens");
});
