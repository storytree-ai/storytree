/** App capability 4 · Updates: what the gear's Updates section says for each state of an update. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window, type HTMLInputElement } from "happy-dom";

import type { InstallChoice, InstallChoiceState } from "../updates/install-choice.js";
import { renderAppMenu } from "./render.js";
import { mountInstallChoice, updateText } from "./updates.js";

const at = { runningBuild: "0.3.400 (abc1234)", nextBuild: "0.3.401 (def5678)" };

test("4.8 the Updates section says when a new build is building, ready and restarting, naming that build", () => {
  const said = (["building", "ready", "restarting"] as const).map((phase) => updateText({ ...at, phase }));
  assert.equal(new Set(said.map(([title]) => title)).size, 3, "each state reads differently");
  for (const [title, detail] of said) {
    assert.notEqual(title, "");
    assert.match(detail, /0\.3\.401/);
  }
});

test("4.9 a failed update says its reason and that the running app is unchanged", () => {
  const [title, detail] = updateText({ ...at, phase: "failed", reason: "The build stopped at typecheck." });
  assert.notEqual(title, "");
  assert.match(detail, /The build stopped at typecheck\./);
  assert.match(detail, /unchanged/);
});

test("4.10 an app not running from a runtime slot says it does not update itself", () => {
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
  const mounted = mountInstallChoice(host as unknown as HTMLElement, {
    async read(): Promise<InstallChoiceState> { return { available: true, choice: kept }; },
    async set(choice) {
      asked.push(choice);
      if (refuse) throw new Error("Say a time as HH:MM.");
      kept = choice;
      return { available: true, choice: kept };
    },
  }, () => new Date(2026, 9, 2, 12, 0));
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

  refuse = true;
  radio("quiet").checked = true;
  radio("quiet").dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.deepEqual(asked.at(-1), { mode: "quiet" });
  assert.equal(radio("manual").checked, true, "a refused change keeps the old choice");
  const error = field.querySelector("[data-app-install-error]")!;
  assert.equal(error.hasAttribute("hidden"), false);
  assert.match(error.textContent, /Say a time as HH:MM/);
  mounted.stop();
});

test("4.14 the install choice is hidden where the app does not install releases", async () => {
  const window = new Window();
  const host = window.document.createElement("div");
  host.innerHTML = renderAppMenu();
  mountInstallChoice(host as unknown as HTMLElement, {
    async read() { return { available: false, choice: { mode: "quiet" } }; },
    async set() { throw new Error("unused"); },
  });
  await setImmediate();
  assert.equal(host.querySelector("[data-app-install-choice]")!.hasAttribute("hidden"), true);
});
