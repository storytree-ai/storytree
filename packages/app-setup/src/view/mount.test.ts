import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";

import type { SetupHelpBridge } from "../help/bridge.js";
import { mountAddProject, mountSetupHelp } from "./index.js";

let window: Window;
let originals: Record<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  window = new Window({ url: "https://storytree.test" });
  originals = Object.fromEntries(["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: window.document },
    localStorage: { configurable: true, value: window.localStorage },
  });
});
afterEach(async () => {
  await window.happyDOM.close();
  for (const [key, original] of Object.entries(originals)) {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const unused = async (): Promise<never> => { throw new Error("Unexpected help bridge call"); };
function helpBridge(overrides: Partial<SetupHelpBridge> = {}): SetupHelpBridge {
  return {
    agentConnections: async () => [], readSetupLicense: unused, checkSetupFolder: unused,
    addProject: unused, removeProject: unused, deletableProjects: unused, deleteProject: unused,
    openFeedbackDraft: unused, copyHelpText: unused, ...overrides,
  };
}

test("3.1 the mounted guide opens with no project and its Help entry reopens it after dismissal", () => {
  const mounted = mountSetupHelp(document.body, helpBridge());
  try {
    const panel = document.querySelector<HTMLElement>("#setup-help-panel")!;
    const launch = document.querySelector<HTMLButtonElement>("[aria-controls=setup-help-panel]")!;
    assert.equal(panel.hidden, false);
    assert.equal(document.activeElement, panel.querySelector("h2"));
    assert.match(panel.textContent!, /Start your first project/);

    panel.querySelector<HTMLButtonElement>("[data-close-help]")!.click();
    assert.equal(panel.hidden, true);
    assert.equal(document.activeElement, launch);
    launch.click();
    assert.equal(panel.hidden, false);
    assert.equal(launch.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, panel.querySelector("h2"));
  } finally { mounted.stop(); }
});

test("3.2 the mounted guide checks a folder and copies its recovery request when setup is incomplete", async () => {
  const copied: string[] = [];
  let checks = 0;
  const mounted = mountSetupHelp(document.body, helpBridge({
    checkSetupFolder: async () => {
      checks++;
      return [{ check: "hooks", state: "needs-attention", message: "Hooks have not reached storytree.", fix: "Run check_setup in your agent." }];
    },
    copyHelpText: async (text) => { copied.push(text); },
  }));
  try {
    document.querySelector<HTMLButtonElement>("[data-check]")!.click();
    await setImmediate();
    assert.equal(checks, 1);
    const diagnostics = document.querySelector<HTMLElement>("[data-diagnostics]")!;
    assert.equal(diagnostics.hidden, false);
    assert.match(diagnostics.textContent!, /Hooks have not reached storytree/);
    assert.match(diagnostics.textContent!, /Run check_setup in your agent/);
    document.querySelector<HTMLButtonElement>("[data-recover]")!.click();
    await setImmediate();
    assert.deepEqual(copied, [document.querySelector("[data-request]")!.textContent]);
    assert.match(copied[0]!, /check_setup/);
    assert.match(document.querySelector("[data-check-status]")!.textContent!, /Copied/);
  } finally { mounted.stop(); }
});

test("3.4 Add project asks the picker bridge, shows the chosen project and leaves selection alone on cancellation", async () => {
  const selected: string[] = [];
  let picks = 0;
  const mounted = mountAddProject(document.body, {
    addProject: async () => ++picks === 1 ? { status: "set up", project: "second", folder: "/work/second" } : null,
  }, { onAdded: async (project) => { selected.push(project); } });
  try {
    const button = document.querySelector<HTMLButtonElement>("[data-add-project]")!;
    button.click();
    assert.equal(button.disabled, true);
    await setImmediate();
    assert.equal(picks, 1);
    assert.deepEqual(selected, ["second"]);
    assert.match(document.querySelector("[data-add-project-status]")!.textContent!, /second/);
    assert.equal(button.disabled, false);
    button.click();
    await setImmediate();
    assert.equal(picks, 2);
    assert.deepEqual(selected, ["second"]);
    assert.equal(document.querySelector("[data-add-project-status]")!.textContent, "");
    assert.equal(button.disabled, false);
  } finally { mounted.stop(); }
});
