import assert from "node:assert/strict";
import { test } from "node:test";
import { readSettings } from "../settings/settings.js";
import { withTempDir } from "../testing/folders.js";
import { renderSettings } from "./render.js";

test("10.7 the panel renders every reading with its value, source, meaning and labelled control", async () => {
  await withTempDir((home) => {
    const readings = readSettings(home);
    const html = renderSettings(readings);
    assert.match(html, /Context guidance/);
    assert.match(html, /value="600000"/);
    assert.match(html, /Time before a session is considered idle/);
    assert.match(html, /input[^>]+inputmode="text"[^>]+value="30m"/);
    assert.match(html, /default/);
    assert.ok(html.includes(readings["context-guidance"].meaning));
    assert.match(html, /Library/);
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
