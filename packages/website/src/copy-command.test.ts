import assert from "node:assert/strict";
import { test } from "node:test";
import { copyCommand, wireCopyControl } from "./copy-command.js";

test("1.5 · copying preserves every command character and waits for the clipboard", async () => {
  const command = "& (Invoke-Something 'https://example.test/?a=1&b=2')";
  let written = "";
  let done = false;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const result = copyCommand(command, { writeText: text => { written = text; return pending; } }).then(ok => { done = true; return ok; });
  assert.equal(written, command);
  await Promise.resolve();
  assert.equal(done, false);
  finish();
  assert.equal(await result, true);
});

test("1.5 · clipboard denial returns failure, never a claim that the command was copied", async () => {
  assert.equal(await copyCommand("select this manually", { writeText: async () => { throw new Error("Permission denied"); } }), false);
});

test("1.5 · the copy control says copied only once the clipboard write resolves, and on denial says to copy by hand", async () => {
  const element = () => ({ hidden: true, textContent: "", dataset: {} as Record<string, string | undefined>, attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }, removeAttribute(name: string) { this.attributes.delete(name); },
    click: undefined as undefined | (() => Promise<void>), addEventListener(_type: "click", listener: () => Promise<void>) { this.click = listener; } });
  const button = element(), status = element(), command = { textContent: "irm https://example.test | iex" };
  let finish!: () => void;
  let written = "";
  wireCopyControl(button as unknown as HTMLButtonElement, command, status, { writeText: (text) => { written = text; return new Promise<void>((resolve) => { finish = resolve; }); } });
  assert.equal(button.hidden, false, "the optional control appears");
  const clicked = button.click!();
  assert.equal(written, command.textContent);
  assert.equal(status.textContent, "Copying…");
  assert.equal(button.attributes.get("aria-disabled"), "true");
  finish();
  await clicked;
  assert.equal(button.dataset.copyState, "copied");
  assert.equal(status.textContent, "Copied. Paste into PowerShell.");
  assert.equal(button.attributes.has("aria-disabled"), false);

  const denied = element();
  wireCopyControl(denied as unknown as HTMLButtonElement, command, status, { writeText: async () => { throw new Error("Permission denied"); } });
  await denied.click!();
  assert.equal(denied.dataset.copyState, "failed");
  assert.equal(status.textContent, "Could not copy. Select the command above and copy it manually.");
});
