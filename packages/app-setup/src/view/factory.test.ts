import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";

import type { ChosenFactory, FactoryFolder } from "../help/bridge.js";
import { mountFactory } from "./index.js";

let window: Window;
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  window = new Window({ url: "https://storytree.test" });
  original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
});
afterEach(async () => {
  await window.happyDOM.close();
  if (original) Object.defineProperty(globalThis, "document", original);
  else Reflect.deleteProperty(globalThis, "document");
});

test("3.12 Your factory (app menu): shows the factory folder in use by its path alone, the default or one switched to, and \"Import or switch factory…\" switches it at once with no approval step, saying a refused folder's reason; nothing tells the user to ask their agent", async () => {
  let factory: FactoryFolder = { folder: "/home/me/.storytree/your-factory", chosen: false };
  let answer: () => Promise<ChosenFactory | null> = async () => null;
  const host = document.createElement("div") as unknown as HTMLElement;
  document.body.append(host as never);
  mountFactory(host, { factoryFolder: async () => factory, chooseFactory: () => answer() });
  await setImmediate();
  const text = () => host.textContent ?? "";
  assert.equal(host.querySelector("[data-factory-folder]")!.textContent, "/home/me/.storytree/your-factory", "the default folder's path alone");

  const button = host.querySelector<HTMLButtonElement>("[data-switch-factory]")!;
  assert.equal(button.textContent, "Import or switch factory…");
  button.click();
  await setImmediate();
  assert.equal(host.querySelector("[data-factory-status]")!.textContent, "", "a cancelled picker says nothing");

  answer = async () => { factory = { folder: "/work/my-factory", chosen: true, switched: { through: "desktop app", at: "2026-10-23T05:00:00.000Z" } }; return { status: "set up", folder: "/work/my-factory" }; };
  button.click();
  await setImmediate(); await setImmediate();
  assert.equal(host.querySelector("[data-factory-folder]")!.textContent, "/work/my-factory", "the folder in use is shown at once");
  assert.match(host.querySelector("[data-factory-status]")!.textContent!, /now your factory, set up for your plugins/);
  assert.equal(host.querySelector("[role=dialog], [data-approve]"), null, "no approval step");

  answer = async () => { throw new Error("/work/notes holds other files and no plugins folder, so it is not a factory"); };
  button.click();
  await setImmediate(); await setImmediate();
  const status = host.querySelector("[data-factory-status]")!;
  assert.match(status.textContent!, /cannot be your factory: .*not a factory/);
  assert.equal(status.getAttribute("role"), "alert");
  assert.doesNotMatch(text(), /ask your agent/i);
});
