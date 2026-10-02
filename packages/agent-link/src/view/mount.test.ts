import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";
import { readSettings } from "../settings/settings.js";
import { withTempDir } from "../testing/folders.js";
import { mountSettings, type SettingsBridge } from "./index.js";

function page(t: TestContext, bridge: SettingsBridge) {
  const window = new Window();
  const globals = { document: window.document, CSSStyleSheet: window.CSSStyleSheet };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const host = window.document.createElement("main");
  const gear = window.document.createElement("button");
  window.document.body.append(gear, host);
  const panel = mountSettings(host as unknown as HTMLElement, bridge, { returnFocus: gear as unknown as HTMLElement, embedded: true, group: "sessions" });
  t.after(async () => {
    panel.stop();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
  });
  return { window, host, panel };
}

test("10.9 the mounted panel shows a failed read without rows, and clicking Retry reads again", async (t) => {
  await withTempDir(async (home) => {
    const readings = readSettings(home);
    let reads = 0;
    const { host, panel } = page(t, {
      async readSettings() {
        if (++reads === 1) throw new Error("the app did not answer");
        return { ok: true, value: readings };
      },
      async saveSetting() { throw new Error("not saving in this test"); },
    });
    panel.open();
    await setImmediate();
    assert.equal(host.querySelector("[data-read-error]")?.textContent, "the app did not answer");
    assert.equal(host.querySelector("[data-read-error]")?.hasAttribute("hidden"), false);
    assert.equal(host.querySelectorAll("form").length, 0);
    const retry = host.querySelector("[data-retry]")!;
    assert.equal(retry.hasAttribute("hidden"), false);
    retry.click();
    await setImmediate();
    assert.equal(reads, 2);
    assert.equal(retry.hasAttribute("hidden"), true);
    assert.equal(host.querySelector("[data-read-error]")?.hasAttribute("hidden"), true);
    assert.equal(host.querySelectorAll("form").length, 3);
    assert.equal(host.querySelector('input[name="value"]')?.getAttribute("value"), "600000");
  });
});

test("10.9 the mounted panel keeps Save available after transport failure, and clicking it again saves", async (t) => {
  await withTempDir(async (home) => {
    const readings = readSettings(home);
    const saves: { name: string; values: readonly string[] }[] = [];
    const { window, host, panel } = page(t, {
      async readSettings() { return { ok: true, value: readings }; },
      async saveSetting(name, values) {
        saves.push({ name, values });
        if (saves.length === 1) throw new Error("the app did not answer");
        return { ok: true, value: readings };
      },
    });
    panel.open();
    await setImmediate();
    const form = host.querySelector('form[data-setting="context-guidance"]')!;
    const value = form.querySelector("input")!;
    const save = form.querySelector('button[type="submit"]')!;
    assert.equal(save.disabled, true);
    value.value = "400000";
    value.dispatchEvent(new window.Event("input", { bubbles: true }));
    save.click();
    assert.equal(save.disabled, true);
    await setImmediate();
    assert.equal(form.querySelector(".settings-error")?.textContent, "the app did not answer");
    assert.equal(save.disabled, false);
    assert.equal(form.querySelector(".settings-source")?.textContent, "default");
    save.click();
    await setImmediate();
    assert.deepEqual(saves, [{ name: "context-guidance", values: ["400000"] }, { name: "context-guidance", values: ["400000"] }]);
    assert.equal(form.querySelector(".settings-error")?.textContent, "");
    assert.equal(form.querySelector(".settings-saved")?.textContent, "Saved");
    assert.equal(form.querySelector(".settings-source")?.textContent, "set by you");
    assert.equal(save.disabled, true);
  });
});
