import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";

import type { SetupHelpBridge } from "../help/bridge.js";
import { deleteChosenProject } from "./delete-project.js";
import { mountAddProject, mountDeleteProject, mountFactory, mountProjectSentence, mountSetupHelp } from "./index.js";
import { removeCurrentProject } from "./remove-project.js";
import { saveProjectSentence } from "./project-sentence.js";

let window: Window;
let originals: Record<string, PropertyDescriptor | undefined>;
let logged: unknown[][];
beforeEach(() => {
  window = new Window({ url: "https://storytree.test" });
  originals = Object.fromEntries(["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: window.document },
    localStorage: { configurable: true, value: window.localStorage },
  });
  logged = [];
  mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
});
afterEach(async () => {
  mock.restoreAll();
  await window.happyDOM.close();
  for (const [key, original] of Object.entries(originals)) {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const failing = (message: string) => async (): Promise<never> => { throw new Error(message); };
/** The console errors written so far, each as its where-and-what line and the message of the error it carries. */
const errors = (): [string, string][] => logged.map(([what, error]) => [String(what), error instanceof Error ? error.message : String(error)]);
function helpBridge(overrides: Partial<SetupHelpBridge> = {}): SetupHelpBridge {
  const unused = failing("Unexpected help bridge call");
  return {
    agentConnections: async () => [], agentsToConnect: async () => [], connectAgent: unused, readSetupLicense: unused, checkSetupFolder: unused,
    factoryFolder: unused, chooseFactory: unused, addProject: unused, removeProject: unused, projectSentence: unused, setProjectSentence: unused, deletableProjects: unused, deleteProject: unused,
    openFeedbackDraft: unused, copyHelpText: unused, ...overrides,
  };
}
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const text = (selector: string) => document.querySelector(selector)!.textContent!;
/** A failure said where it happens is said as an alert. */
const alerted = (selector: string) => assert.equal(document.querySelector(selector)!.getAttribute("role"), "alert", selector);

test("3.14 the guide's reads that fail, the connected agents and the agents to connect, are written to the console", async () => {
  const mounted = mountSetupHelp(document.body, helpBridge({ agentConnections: failing("no connections file"), agentsToConnect: failing("No delivery record") }));
  try {
    await setImmediate();
    assert.deepEqual(errors(), [
      ["app-setup guide: the connected agents could not be read", "no connections file"],
      ["app-setup guide: the coding agents on this computer could not be read", "No delivery record"],
    ]);
  } finally { mounted.stop(); }
});

test("3.14 the guide's actions that fail are written to the console, and Connect and the setup check say what failed", async () => {
  const mounted = mountSetupHelp(document.body, helpBridge({
    agentsToConnect: async () => [{ harness: "codex", agent: "Codex", connected: false }],
    connectAgent: failing("ipc closed"), addProject: failing("the library is not open"), checkSetupFolder: failing("folder unreadable"),
    copyHelpText: failing("clipboard refused"), readSetupLicense: failing("LICENSE missing"),
  }));
  try {
    await setImmediate();
    logged.length = 0;
    click("[data-connect-agent=codex]"); await setImmediate();
    assert.match(text("[data-connect]"), /Codex could not be connected: ipc closed\. Try again\./);
    click("[data-guide-add-project]"); await setImmediate();
    click("[data-check]"); await setImmediate();
    assert.match(text("[data-check-status]"), /The setup check could not finish: folder unreadable\./);
    alerted("[data-check-status]");
    click("[data-recover]"); await setImmediate();
    assert.match(text("[data-check-status]"), /Could not copy/);
    alerted("[data-check-status]");
    click("[data-page=license]"); await setImmediate();
    assert.deepEqual(errors().slice(0, 5), [
      ["app-setup guide: Codex could not be connected", "ipc closed"],
      ["app-setup guide: the folder could not be added", "the library is not open"],
      ["app-setup guide: the setup check could not finish", "folder unreadable"],
      ["app-setup help: the text could not be copied", "clipboard refused"],
      ["app-setup help: the shipped license could not be read", "LICENSE missing"],
    ]);
  } finally { mounted.stop(); }
});

test("3.14 feedback's failures are written to the console; the draft says what failed, and sign-in's stays private on screen", async () => {
  const mounted = mountSetupHelp(document.body, helpBridge({
    openFeedbackDraft: failing("no browser"),
    feedbackIdentity: { status: async () => null, signIn: failing("private-token"), signOut: async () => {} },
  }));
  try {
    click('[data-page="feedback"]'); await setImmediate();
    click("[data-feedback-sign-in]"); await setImmediate();
    assert.doesNotMatch(text("[data-feedback-identity-status]"), /private-token/);
    document.querySelector<HTMLInputElement>("[name=title]")!.value = "A title";
    document.querySelector<HTMLTextAreaElement>("[name=body]")!.value = "A message";
    document.querySelector<HTMLFormElement>("[data-feedback-form]")!.dispatchEvent(new window.Event("submit", { cancelable: true }) as unknown as Event);
    await setImmediate();
    assert.match(text("[data-feedback-status]"), /The draft could not be opened: no browser\./);
    alerted("[data-feedback-status]");
    assert.deepEqual(errors().filter(([what]) => what.startsWith("app-setup feedback")), [
      ["app-setup feedback: the storytree account could not be updated (signIn)", "private-token"],
      ["app-setup feedback: the GitHub draft could not be opened", "no browser"],
    ]);
  } finally { mounted.stop(); }
});

test("3.14 the Projects section's failures (add, remove, delete, the sentence, your factory) are written to the console", async () => {
  const host = document.createElement("div") as unknown as HTMLElement;
  document.body.append(host as never);
  mountAddProject(host, { addProject: failing("no picker") }, { onAdded: async () => {} }).add();
  await setImmediate();
  await removeCurrentProject({ removeProject: failing("There is no project with that name.") }, { current: () => "old", onRemoved: async () => {} });
  await deleteChosenProject({ deleteProject: failing("A live session is working in “old”.") }, { project: "old", typed: "old", snapshot: true, onDeleted: async () => {} });
  mountDeleteProject(host, { deletableProjects: failing("library unreachable"), deleteProject: failing("unused") }, { onDeleted: async () => {} });
  click("[data-delete-project]"); await setImmediate();
  assert.match(text("[data-delete-project-status]"), /The projects could not be read: library unreachable/);
  alerted("[data-delete-project-status]");
  mountProjectSentence(host, { projectSentence: failing("sentence table missing"), setProjectSentence: failing("unused") }, { current: () => "site" });
  await setImmediate();
  assert.match(text("[data-project-sentence-status]"), /The sentence could not be read: sentence table missing/);
  await saveProjectSentence({ projectSentence: failing("unused"), setProjectSentence: failing("read-only library") }, "site", { what: "a site", audience: "readers" });
  mountFactory(host, { factoryFolder: failing("home unreadable"), chooseFactory: failing("/work/notes is not a factory") });
  await setImmediate();
  assert.match(text("[data-factory-status]"), /Your factory could not be read: home unreadable/);
  alerted("[data-factory-status]");
  click("[data-switch-factory]"); await setImmediate();
  assert.deepEqual(errors(), [
    ["app-setup projects: the folder could not be added", "no picker"],
    ["app-setup projects: “old” could not be removed", "There is no project with that name."],
    ["app-setup projects: “old” was not deleted", "A live session is working in “old”."],
    ["app-setup projects: the deletable projects could not be read", "library unreachable"],
    ["app-setup projects: the sentence of “site” could not be read", "sentence table missing"],
    ["app-setup projects: the sentence of “site” could not be saved", "read-only library"],
    ["app-setup factory: the factory folder could not be read", "home unreadable"],
    ["app-setup factory: the folder could not become the factory", "/work/notes is not a factory"],
  ]);
});
