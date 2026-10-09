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

test("3.8 the mounted guide explains a Smart App Control block: what it is, where to see it, how to turn it off and what that costs", () => {
  const mounted = mountSetupHelp(document.body, helpBridge());
  try {
    const step = [...document.querySelectorAll("#setup-help-panel details")]
      .find((details) => /Smart App Control/.test(details.querySelector("summary")!.textContent!));
    assert.ok(step, "a Smart App Control step beside the SmartScreen one");
    const text = step.textContent!;
    assert.match(text, /no Run anyway/);
    assert.match(text, /unsigned/);
    assert.match(text, /Windows Security → App & browser control → Smart App Control/);
    assert.match(text, /turn it off/i);
    assert.match(text, /April 2026/);
    assert.match(text, /reset/i);
  } finally { mounted.stop(); }
});

test("5.5 feedback sign-in is optional and only explicitly added identity enters the editable draft", async () => {
  let statuses = 0;
  let signIns = 0;
  const drafts: unknown[] = [];
  const copied: string[] = [];
  const user = { id: "76c80829-6cfd-4f1e-95e8-9a9c781529ce", email: "me@example.test" };
  const mounted = mountSetupHelp(document.body, helpBridge({
    feedbackIdentity: {
      status: async () => { statuses++; return null; },
      signIn: async () => { signIns++; return user; },
      signOut: async () => {},
    },
    openFeedbackDraft: async draft => { drafts.push(draft); return { status: "opened" }; },
    copyHelpText: async text => { copied.push(text); },
  }));
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const message = document.querySelector<HTMLTextAreaElement>("[name=body]")!;
  const title = document.querySelector<HTMLInputElement>("[name=title]")!;
  try {
    await setImmediate();
    assert.equal(statuses, 0, "first run never asks identity");
    click('[data-page="feedback"]');
    await setImmediate();
    assert.equal(statuses, 1);
    assert.equal(signIns, 0);
    title.value = "Suggestion"; message.value = "Please add this.";
    click('[type="submit"]'); await setImmediate();
    assert.deepEqual(drafts, [{ title: "Suggestion", body: "Please add this." }]);
    click("[data-feedback-sign-in]"); await setImmediate();
    assert.equal(signIns, 1);
    assert.equal(message.value, "Please add this.", "sign-in alone attaches nothing");
    click("[data-feedback-include-identity]");
    assert.match(message.value, /me@example.test/);
    assert.match(message.value, /76c80829-6cfd-4f1e-95e8-9a9c781529ce/);
    const reviewed = message.value;
    click("[data-feedback-include-identity]");
    assert.equal(message.value, reviewed, "does not repeat attribution");
    click("[data-copy-feedback]"); await setImmediate();
    assert.equal(copied[0], `Suggestion\n\n${reviewed}`);
    message.value = "Only this text now.";
    click('[type="submit"]'); await setImmediate();
    assert.deepEqual(drafts[1], { title: "Suggestion", body: "Only this text now." });
    click("[data-feedback-sign-out]"); await setImmediate();
    assert.equal(document.querySelector<HTMLElement>("[data-feedback-include-identity]")!.hidden, true);
  } finally { mounted.stop(); }
});

test("5.5 unavailable sign-in leaves feedback open and does not expose private errors", async () => {
  const mounted = mountSetupHelp(document.body, helpBridge({
    feedbackIdentity: {
      status: async () => null,
      signIn: async () => { throw new Error("private-token"); },
      signOut: async () => {},
    },
  }));
  try {
    document.querySelector<HTMLButtonElement>('[data-page="feedback"]')!.click(); await setImmediate();
    document.querySelector<HTMLButtonElement>("[data-feedback-sign-in]")!.click(); await setImmediate();
    const status = document.querySelector<HTMLElement>("[data-feedback-identity-status]")!;
    assert.match(status.textContent!, /without signing in/i);
    assert.doesNotMatch(status.textContent!, /private-token/);
    assert.equal(document.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, false);
  } finally { mounted.stop(); }
});
