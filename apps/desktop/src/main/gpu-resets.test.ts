import assert from "node:assert/strict";
import { test } from "node:test";

import { keepDrawingThroughGpuResets } from "./gpu-resets.js";

test("1.14 the app starts with Chromium's blocks after GPU crashes off, so repeated GPU resets never leave the globe white", () => {
  const asked: string[] = [];
  const app = {
    disableDomainBlockingFor3DAPIs: () => asked.push("no per-page 3D block after a GPU crash"),
    commandLine: { appendSwitch: (name: string) => asked.push(`--${name}`) },
  };
  keepDrawingThroughGpuResets(app);
  // Measured on the owner's laptop (Electron, Browser.crashGpuProcess x4): with neither, the second crash's lost
  // context never came back; with only the first, the third crash disabled WebGL; with both, all four restored.
  assert.deepEqual(asked.sort(), ["--disable-gpu-process-crash-limit", "no per-page 3D block after a GPU crash"]);
});
