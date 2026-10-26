import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { settingsActions } from "@storytree/project-and-caller/settings";
import { Window, type HTMLButtonElement, type HTMLSelectElement } from "happy-dom";
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

test("2.15 the app bar's factory icon switches straight to the factory, its Projects tab switches products and offers New project…, and the product on show is named with a copy button", async (t) => {
  const window = new Window();
  const home = mkdtempSync(path.join(tmpdir(), "storytree-menu-"));
  const copied: string[] = [];
  const globals = { document: window.document, CSSStyleSheet: window.CSSStyleSheet, HTMLElement: window.HTMLElement, navigator: { clipboard: { writeText: async (text: string) => { copied.push(text); } } } };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
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
  const errors: unknown[] = [];
  let refused = false;
  let shown = 0;
  let adds = 0;
  const menu = mountAppMenu(host as unknown as HTMLElement, {
    background: background as unknown as HTMLElement,
    async chooseProject(name) { if (refused) throw new Error("the library is not reachable"); chosen.push(name); },
    onChosen() { shown++; }, onError(error) { errors.push(error); }, onSurfacesChanged() {},
    mountHelp() { return { open() {}, close() {}, stop() {} }; },
    mountAddProject() { return { stop() {}, add() { adds++; } }; },
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
  // happy-dom has no popovers; the real browser capture opens the overlay itself.
  let opened = 0;
  Object.assign(host.querySelector("#app-menu")!, { showPopover() { opened++; }, hidePopover() {} });
  const bar = () => host.querySelector(".app-bar")!;
  const select = () => bar().querySelector<HTMLSelectElement>("select")!;
  const choose = async (value: string) => {
    select().value = value;
    select().dispatchEvent(new window.Event("change"));
    await setImmediate();
  };
  const factoryTab = () => bar().querySelector<HTMLButtonElement>("[data-app-factory-tab]")!;
  const projectsTab = () => bar().querySelector("[data-app-projects-tab]")!;
  const projects = ["my-factory", "my-site", "other-site"];
  menu.update({ projects, current: "my-site", factory: { place: "product", factory: "my-factory" } });
  assert.ok(select(), "the dropdown is in the always-visible bar, outside the gear's overlay");
  assert.equal(host.querySelectorAll("select#project").length, 1, "one switcher, not two");
  assert.equal(select().value, "my-site");
  assert.deepEqual([...select().options].map((option) => option.textContent), ["my-site", "other-site", "New project…"], "products only: the factory is its own tab");
  assert.doesNotMatch(bar().textContent, /your factory/i);
  assert.equal(projectsTab().getAttribute("aria-current"), "true", "on a product, Projects is the selected tab");
  assert.equal(factoryTab().hasAttribute("aria-current"), false);
  // The product on show is named after the Projects tab, and its copy button puts the name on the clipboard.
  assert.equal(bar().querySelector("[data-app-project-name]")!.textContent, "my-site");
  bar().querySelector<HTMLButtonElement>("[data-app-copy-project]")!.click();
  await setImmediate();
  assert.deepEqual(copied, ["my-site"]);
  assert.equal(bar().querySelector("[data-app-copy-project]")!.textContent, "Copied");
  factoryTab().click();
  await setImmediate();
  assert.deepEqual(chosen, ["my-factory"], "the factory icon switches straight to the factory, with no dropdown");
  assert.equal(shown, 1);
  // In the factory its icon is the selected tab, no product is selected, and any product is one choice away.
  menu.update({ projects, current: "my-factory", factory: { place: "factory", product: "my-site" } });
  assert.equal(factoryTab().getAttribute("aria-current"), "true");
  assert.equal(projectsTab().hasAttribute("aria-current"), false);
  assert.equal(select().selectedIndex, -1);
  assert.equal(bar().querySelector("[data-app-project-name]"), null, "no name on the factory");
  factoryTab().click();
  await setImmediate();
  assert.deepEqual(chosen, ["my-factory"], "the factory icon on the factory switches nothing");
  await choose("other-site");
  assert.deepEqual(chosen, ["my-factory", "other-site"]);
  // With no factory yet, the icon stays, greyed, and says so; every project is a product.
  menu.update({ projects, current: "other-site", factory: { place: "none" } });
  assert.equal(factoryTab().getAttribute("aria-disabled"), "true");
  assert.equal(factoryTab().title, "No factory yet");
  assert.deepEqual([...select().options].map((option) => option.textContent), ["my-factory", "my-site", "other-site", "New project…"]);
  factoryTab().click();
  await setImmediate();
  assert.deepEqual(chosen, ["my-factory", "other-site"], "a greyed factory icon switches nothing");
  // New project… opens the gear on Projects and starts Add project, leaving the project on show selected.
  select().selectedIndex = select().options.length - 1;
  select().dispatchEvent(new window.Event("change"));
  await setImmediate();
  assert.equal(adds, 1);
  assert.equal(opened, 1, "the gear's overlay opens");
  assert.equal(select().value, "other-site");
  assert.equal(host.querySelector("#app-projects")!.hasAttribute("hidden"), false);
  assert.deepEqual(chosen, ["my-factory", "other-site"], "New project… switches nothing by itself");
  // A refused choice says why beside the tabs and leaves them free, on the project still on show, to retry.
  refused = true;
  await choose("my-site");
  assert.equal(errors.length, 1);
  assert.match(bar().querySelector("[data-app-project-error]")!.textContent, /Couldn’t switch project: the library is not reachable/);
  assert.equal(select().disabled, false);
  assert.equal(select().value, "other-site");
  // New project… after a refusal puts the stale reason away.
  select().selectedIndex = select().options.length - 1;
  select().dispatchEvent(new window.Event("change"));
  await setImmediate();
  assert.equal(adds, 2);
  assert.equal(bar().querySelector("[data-app-project-error]")!.hasAttribute("hidden"), true, "New project… clears the refusal's reason");
  refused = false;
  await choose("my-site");
  assert.deepEqual(chosen, ["my-factory", "other-site", "my-site"]);
  assert.equal(bar().querySelector("[data-app-project-error]")!.hasAttribute("hidden"), true);
  // With no projects at all, the dropdown holds only New project…
  menu.update({ projects: [], current: undefined });
  assert.deepEqual([...select().options].map((option) => option.textContent), ["New project…"]);
  select().selectedIndex = 0;
  select().dispatchEvent(new window.Event("change"));
  await setImmediate();
  assert.equal(adds, 3);
});
