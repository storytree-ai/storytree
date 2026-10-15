import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { settingsActions } from "@storytree/project-and-caller/settings";
import { Window, type HTMLButtonElement } from "happy-dom";
import { mountAppMenu } from "./index.js";
import { fakeBridge } from "../../../../apps/desktop/src/capture/index.js";

test("2.7 clicking the mounted menu sections switches their content and preserves settings, updates and Help actions", async (t) => {
  const window = new Window();
  const home = mkdtempSync(path.join(tmpdir(), "storytree-menu-"));
  const globals = { document: window.document, CSSStyleSheet: window.CSSStyleSheet, HTMLElement: window.HTMLElement };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const host = window.document.createElement("header");
  const background = window.document.createElement("main");
  window.document.body.append(host, background);
  // Share the Desktop capture's typed bridge; the mounted App keeps the same section actions.
  const bridge = fakeBridge({
    standingDelegations: async () => "The owner chooses the design.",
    saveSurface: async () => { throw new Error("not changing surfaces in this test"); },
  });
  Object.assign(window, { storytree: {
    ...settingsActions(home),
    standingDelegations: (...args: unknown[]) => bridge.call("standingDelegations", args),
    readSurfaces: (...args: unknown[]) => bridge.call("readSurfaces", args),
    saveSurface: (...args: unknown[]) => bridge.call("saveSurface", args),
  } });
  const updates: string[] = [];
  const help: string[] = [];
  const sharing: string[] = [];
  const menu = mountAppMenu(host as unknown as HTMLElement, {
    background: background as unknown as HTMLElement,
    async chooseProject() { throw new Error("not switching projects in this test"); },
    onChosen() {}, onError(error) { throw error; }, onSurfacesChanged() {},
    mountJourney(target) {
      target.textContent = "The journey story mounts here";
      return { open() { sharing.push("open"); }, close() { sharing.push("close"); }, stop() { sharing.push("stop"); } };
    },
    mountHelp(target) {
      target.textContent = "The Help story mounts here";
      return { open() { help.push("open"); }, close() { help.push("close"); }, stop() { help.push("stop"); } };
    },
    async checkForUpdates(action) {
      updates.push(action);
      return { phase: action === "status" ? "idle" : "up-to-date", runningBuild: "0.3.test" };
    },
  });
  t.after(async () => {
    menu.stop();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
    rmSync(home, { recursive: true, force: true });
  });
  menu.update({ projects: ["first", "second"], current: "second" });
  assert.equal(host.querySelector("select")?.value, "second");
  // Native popover opening and dismissal remain exercised by the real browser capture.
  // This mounted test exercises the app's section wiring inside that frame.
  const section = async (name: string) => {
    const tab = host.querySelector<HTMLButtonElement>(`[data-app-section="${name}"]`)!;
    tab.click();
    await setImmediate();
    assert.equal(tab.getAttribute("aria-pressed"), "true");
    assert.deepEqual([...host.querySelectorAll(".app-menu-content > section")].filter((node) => !node.hasAttribute("hidden")).map((node) => node.id), [`app-${name}`]);
  };
  await section("sessions");
  assert.equal(host.querySelectorAll('#app-sessions form[data-setting]').length, 3);
  assert.match(host.querySelector("[data-delegations]")!.textContent, /The owner chooses the design/);
  await section("sharing");
  assert.equal(host.querySelector("[data-app-journey]")?.textContent, "The journey story mounts here");
  assert.deepEqual(sharing, ["open"]);
  await section("library");
  assert.deepEqual(sharing, ["open", "close"]);
  assert.equal(host.querySelectorAll('#app-library form[data-setting="library"]').length, 1);
  assert.equal(host.querySelector("#settings-panel-sessions")?.hasAttribute("hidden"), true);
  await section("help");
  assert.deepEqual(help, ["open"]);
  assert.equal(host.querySelector("[data-app-help]")?.textContent, "The Help story mounts here");
  await section("updates");
  assert.deepEqual(help, ["open", "close"]);
  host.querySelector<HTMLButtonElement>("[data-app-updates]")!.click();
  await setImmediate();
  assert.deepEqual(updates, ["status", "check"]);
  assert.match(host.querySelector("#app-update-status")!.textContent, /Up to date.*0\.3\.test/);
  await section("projects");
  assert.equal(host.querySelector("select")?.value, "second");
  menu.stop();
  assert.equal(host.children.length, 0);
  assert.equal(window.document.adoptedStyleSheets.length, 0);
  assert.equal(help.at(-1), "stop");
  assert.equal(sharing.at(-1), "stop");
});

test("2.15 the app bar switches the project on show to its factory and back, and says plainly when there is none", async (t) => {
  const window = new Window();
  const home = mkdtempSync(path.join(tmpdir(), "storytree-menu-"));
  const globals = { document: window.document, CSSStyleSheet: window.CSSStyleSheet, HTMLElement: window.HTMLElement };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const host = window.document.createElement("header");
  const background = window.document.createElement("main");
  window.document.body.append(host, background);
  const bridge = fakeBridge({});
  Object.assign(window, { storytree: {
    ...settingsActions(home),
    standingDelegations: (...args: unknown[]) => bridge.call("standingDelegations", args),
    readSurfaces: (...args: unknown[]) => bridge.call("readSurfaces", args),
    saveSurface: (...args: unknown[]) => bridge.call("saveSurface", args),
  } });
  const chosen: string[] = [];
  let shown = 0;
  const menu = mountAppMenu(host as unknown as HTMLElement, {
    background: background as unknown as HTMLElement,
    async chooseProject(name) { chosen.push(name); },
    onChosen() { shown++; }, onError(error) { throw error; }, onSurfacesChanged() {},
    mountHelp() { return { open() {}, close() {}, stop() {} }; },
    async checkForUpdates() { return { phase: "idle", runningBuild: "0.3.test" }; },
  });
  t.after(async () => {
    menu.stop();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
    rmSync(home, { recursive: true, force: true });
  });
  const bar = () => host.querySelector(".app-bar")!;
  const projects = ["my-factory", "my-site"];
  menu.update({ projects, current: "my-site", factory: { place: "product", factory: "my-factory" } });
  const toFactory = bar().querySelector<HTMLButtonElement>("[data-app-factory-switch]")!;
  assert.ok(toFactory, "the switch is in the always-visible bar, outside the gear's overlay");
  assert.match(toFactory.textContent, /Your factory/);
  toFactory.click();
  await setImmediate();
  assert.deepEqual(chosen, ["my-factory"], "the switch chooses the factory as the project on show");
  assert.equal(shown, 1);
  menu.update({ projects, current: "my-factory", factory: { place: "factory", product: "my-site" } });
  const back = bar().querySelector<HTMLButtonElement>("[data-app-factory-switch]")!;
  assert.match(back.textContent, /Back to my-site/);
  assert.match(bar().textContent, /Your factory/, "it says the factory is on show");
  back.click();
  await setImmediate();
  assert.deepEqual(chosen, ["my-factory", "my-site"]);
  menu.update({ projects, current: "my-site", factory: { place: "none" } });
  assert.equal(bar().querySelector("[data-app-factory-switch]"), null);
  assert.match(bar().textContent, /No factory yet/);
  // Without a reading of factories the bar still holds the gear and nothing breaks.
  menu.update({ projects, current: "my-site" });
  assert.ok(bar().querySelector(".app-gear"));
});
