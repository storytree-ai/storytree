/** App capability 4 · Updates: what the gear's Updates section says for each state of an update. */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window, type HTMLInputElement } from "happy-dom";

import type { InstallChoice, InstallChoiceState } from "../updates/install-choice.js";
import { renderAppMenu } from "./render.js";
import { appMenuStyles } from "./styles.js";
import { mountInstallChoice, mountReleaseChannel, mountSignIn, mountUpdates, updateText } from "./updates.js";

const at = { runningBuild: "0.3.400 (abc1234)", nextBuild: "0.3.401 (def5678)" };

test("4.8 the Updates section says when a new build is ready and restarting, naming that build", () => {
  const said = (["ready", "restarting"] as const).map((phase) => updateText({ ...at, phase }));
  assert.equal(new Set(said.map(([title]) => title)).size, 2, "each state reads differently");
  for (const [title, detail] of said) {
    assert.notEqual(title, "");
    assert.match(detail, /0\.3\.401/);
  }
});

test("4.13 a ready update says when it installs under the user's choice", () => {
  const said = (choice?: InstallChoice) => updateText({ ...at, phase: "pending" }, choice)[1];
  assert.match(said(), /next quiet moment/);
  assert.match(said({ mode: "hours", from: "01:00", to: "06:00" }), /quiet hours, 01:00 to 06:00/);
  assert.match(said({ mode: "manual" }), /when you click Restart to update/);
  assert.match(said(), /0\.3\.401/);
});

test("4.4 a restart held by the library's writing says it waits for a snapshot or a seed, then restarts by itself", () => {
  const [title, detail] = updateText({ ...at, phase: "ready", reason: "Waiting for the library to finish writing before restarting." });
  assert.notEqual(title, "");
  assert.match(detail, /snapshot/);
  assert.match(detail, /seed/);
  assert.match(detail, /restarts/);
  assert.doesNotMatch(detail, /quiet moment/);
});

test("4.9 a failed update says its reason and that the running app is unchanged", () => {
  const [title, detail] = updateText({ ...at, phase: "failed", reason: "The build stopped at typecheck." });
  assert.notEqual(title, "");
  assert.match(detail, /The build stopped at typecheck\./);
  assert.match(detail, /unchanged/);
});

test("4.10 a copy that does not install releases says it does not update itself", () => {
  const [, detail] = updateText({ ...at, phase: "unavailable" });
  assert.match(detail, /does not update itself/);
});

test("4.14 the Updates section shows the install choice that is on, saves a change, and keeps the old one when a change is refused", async () => {
  const window = new Window();
  const host = window.document.createElement("div");
  host.innerHTML = renderAppMenu();
  let kept: InstallChoice = { mode: "hours", from: "01:00", to: "06:00" };
  const asked: unknown[] = [];
  let refuse = false;
  let changes = 0;
  const mounted = mountInstallChoice(host as unknown as HTMLElement, {
    async read(): Promise<InstallChoiceState> { return { available: true, choice: kept }; },
    async set(choice) {
      asked.push(choice);
      if (refuse) throw new Error("Say a time as HH:MM.");
      kept = choice;
      return { available: true, choice: kept };
    },
  }, () => new Date(2026, 9, 2, 12, 0), () => { changes += 1; });
  await setImmediate();
  const field = host.querySelector("[data-app-install-choice]")!;
  const radio = (mode: string) => field.querySelector(`input[value="${mode}"]`) as HTMLInputElement;
  const next = () => field.querySelector("[data-app-install-next]")!.textContent;
  assert.equal(field.hasAttribute("hidden"), false);
  assert.equal(radio("hours").checked, true);
  assert.match(next(), /01:00/);
  assert.match(next(), /tomorrow/);

  radio("manual").checked = true;
  radio("manual").dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.deepEqual(asked.at(-1), { mode: "manual" });
  assert.equal(radio("manual").checked, true);
  assert.match(next(), /Check for updates/);
  assert.equal(changes, 1, "a saved change is announced, so the pending update's line follows it");

  refuse = true;
  radio("quiet").checked = true;
  radio("quiet").dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.deepEqual(asked.at(-1), { mode: "quiet" });
  assert.equal(radio("manual").checked, true, "a refused change keeps the old choice");
  assert.equal(changes, 1);
  const error = field.querySelector("[data-app-install-error]")!;
  assert.equal(error.hasAttribute("hidden"), false);
  assert.match(error.textContent, /Say a time as HH:MM/);
  mounted.stop();
});

test("4.14 the install choice is hidden where the app does not install releases", async () => {
  const window = new Window();
  const host = window.document.createElement("div");
  host.innerHTML = renderAppMenu();
  const mounted = mountInstallChoice(host as unknown as HTMLElement, {
    async read() { return { available: false, choice: { mode: "quiet" } }; },
    async set() { throw new Error("unused"); },
  });
  await setImmediate();
  assert.equal(host.querySelector("[data-app-install-choice]")!.hasAttribute("hidden"), true);
  mounted.stop();
});

test("4.24 the Updates section shows the update channel, stable by default, saves an explicit move to alpha, and keeps the old one when a change is refused", async () => {
  const window = new Window();
  const host = window.document.createElement("div");
  host.innerHTML = renderAppMenu();
  let kept: "stable" | "alpha" = "stable";
  let refuse = false;
  const mounted = mountReleaseChannel(host as unknown as HTMLElement, {
    async read() { return { available: true, channel: kept }; },
    async set(channel) {
      if (refuse) throw new Error("Choose alpha or stable.");
      kept = channel;
      return { available: true, channel: kept };
    },
  });
  await setImmediate();
  const field = host.querySelector("[data-app-release-channel]")!;
  const radio = (channel: string) => field.querySelector(`input[value="${channel}"]`) as HTMLInputElement;
  assert.equal(field.hasAttribute("hidden"), false);
  assert.equal(radio("stable").checked, true);
  assert.match(radio("alpha").closest("label")!.textContent, /opt in/i);

  radio("alpha").checked = true;
  radio("alpha").dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.equal(kept, "alpha");
  assert.equal(radio("alpha").checked, true);

  refuse = true;
  radio("stable").checked = true;
  radio("stable").dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.equal(radio("alpha").checked, true, "a refused change keeps the old channel");
  assert.match(field.querySelector("[data-app-release-channel-error]")!.textContent, /alpha or stable/);
  mounted.stop();

  const hidden = window.document.createElement("div");
  hidden.innerHTML = renderAppMenu();
  const elsewhere = mountReleaseChannel(hidden as unknown as HTMLElement, { async read() { return { available: false, channel: "stable" }; }, async set() { throw new Error("unused"); } });
  await setImmediate();
  assert.equal(hidden.querySelector("[data-app-release-channel]")!.hasAttribute("hidden"), true);
  elsewhere.stop();
});

/** The menu's Updates section in a fresh window, and every console error the page writes (app.log, lifecycle 1.19). */
function updatesSection(t: TestContext) {
  const window = new Window();
  const host = window.document.createElement("div");
  host.innerHTML = renderAppMenu();
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  return { window, host, logged };
}

test("4.29 a failed first read shows the Update channel, When updates install and Open at sign-in with the failure, and logs it, instead of hiding them", async (t) => {
  const { host, logged } = updatesSection(t);
  const refused = new Error("the main process did not answer");
  const signIn = mountSignIn(host as unknown as HTMLElement, { read: async () => { throw refused; }, set: async () => { throw new Error("unused"); } });
  const install = mountInstallChoice(host as unknown as HTMLElement, { read: async () => { throw refused; }, set: async () => { throw new Error("unused"); } });
  const channel = mountReleaseChannel(host as unknown as HTMLElement, { read: async () => { throw refused; }, set: async () => { throw new Error("unused"); } });
  await setImmediate();
  for (const [field, error] of [["[data-app-sign-in]", ".app-sign-in-error"], ["[data-app-install-choice]", "[data-app-install-error]"], ["[data-app-release-channel]", "[data-app-release-channel-error]"]] as const) {
    const control = host.querySelector(field)!;
    assert.equal(control.hasAttribute("hidden"), false, `${field} is shown`);
    const said = control.querySelector(error)!;
    assert.equal(said.hasAttribute("hidden"), false, `${field} shows its failure`);
    assert.match(said.textContent, /did not answer/);
    assert.ok([...control.querySelectorAll("input")].every((input) => (input as HTMLInputElement).disabled), `${field} cannot be changed`);
  }
  assert.equal(logged.filter((args) => args.includes(refused)).length, 3, "each failed read reaches the console");
  signIn.stop(); install.stop(); channel.stop();
});

test("4.29 a refused change in the Updates section and a failed update check are logged as well as shown", async (t) => {
  const { window, host, logged } = updatesSection(t);
  const refused = new Error("the settings file is read-only");
  const signIn = mountSignIn(host as unknown as HTMLElement, { read: async () => ({ available: true, on: false }), set: async () => { throw refused; } });
  const install = mountInstallChoice(host as unknown as HTMLElement, { read: async () => ({ available: true, choice: { mode: "quiet" } }), set: async () => { throw refused; } });
  const channel = mountReleaseChannel(host as unknown as HTMLElement, { read: async () => ({ available: true, channel: "stable" }), set: async () => { throw refused; } });
  const checked = new Error("the feed is unreachable");
  // The status line is drawn with the page's own document.
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.assign(globalThis, { document: window.document });
  t.after(() => { if (had === undefined) delete (globalThis as { document?: unknown }).document; else Object.defineProperty(globalThis, "document", had); });
  const updates = mountUpdates(host as unknown as HTMLElement, async () => { throw checked; });
  await setImmediate();
  const change = (selector: string) => {
    const input = host.querySelector(selector) as HTMLInputElement;
    input.checked = !input.checked;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  change("[data-app-sign-in] input");
  change('input[name="app-install-mode"][value="manual"]');
  change('input[name="app-release-channel"][value="alpha"]');
  await setImmediate();
  assert.equal(logged.filter((args) => args.includes(refused)).length, 3, "each refused change reaches the console");
  assert.equal(logged.filter((args) => args.includes(checked)).length, 1, "the failed check reaches the console");
  assert.match(host.querySelector("#app-update-status")!.textContent, /feed is unreachable/);
  signIn.stop(); install.stop(); channel.stop(); updates.stop();
});

test("4.29 Open at sign-in and its error line are not displayed while hidden", async (t) => {
  const { window, host } = updatesSection(t);
  const style = window.document.createElement("style");
  style.textContent = appMenuStyles;
  window.document.head.append(style);
  window.document.body.append(host);
  const signIn = mountSignIn(host as unknown as HTMLElement, { read: async () => ({ available: false, on: false }), set: async () => { throw new Error("unused"); } });
  await setImmediate();
  const label = host.querySelector("[data-app-sign-in]")!;
  assert.equal(label.hasAttribute("hidden"), true);
  assert.equal(window.getComputedStyle(label).display, "none", "an unavailable switch is not on show");
  assert.equal(window.getComputedStyle(label.querySelector(".app-sign-in-error")!).display, "none", "no old failure stays on show");
  signIn.stop();
});
