import assert from "node:assert/strict";
import { test } from "node:test";

import { titleWindow, type TitledWindow } from "./window-title.js";

/** A stand-in for Electron's window: setTitle throws once it is destroyed, as BrowserWindow's does. */
function fakeWindow() {
  let destroyed = false;
  const titles: string[] = [];
  let listener: ((event: { preventDefault(): void }, title: string) => void) | undefined;
  const window: TitledWindow = {
    isDestroyed: () => destroyed,
    setTitle: (title) => {
      if (destroyed) throw new TypeError("Object has been destroyed");
      titles.push(title);
    },
    on: (_event, heard) => { listener = heard; },
  };
  return {
    window, titles,
    destroy: () => { destroyed = true; },
    retitle: (title: string) => listener?.({ preventDefault: () => {} }, title),
  };
}

test("1.21 a page title change reaching a destroyed window is ignored, never an uncaught error; a live window gets the title with the build", () => {
  const fake = fakeWindow();
  titleWindow(fake.window, "build abc123");
  fake.retitle("storytree · forest");
  fake.destroy();
  assert.doesNotThrow(() => fake.retitle("storytree · late"));
  assert.deepEqual(fake.titles, ["storytree 0.3 · build abc123", "storytree · forest · build abc123"]);
});
