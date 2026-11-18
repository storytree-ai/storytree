// Capability 8 · Storytree's own test and gate entries
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contributedHold } from "@storytree/base-dev-loop";
import { testCommand } from "@storytree/base-dev-loop/test";

const root = fileURLToPath(new URL("../../..", import.meta.url));

export const ALONE = ["packages/forest/src/view/desktop-renderer-smoke.test.ts", "packages/forest-world/src/planet/road-reveal.test.ts",
  "packages/knowledge-core/src/traversal-smoke.test.ts", "apps/desktop/src/renderer/named-surfaces.test.ts"];

export function storytreeTest(argv = process.argv.slice(2)) {
  testCommand({ argv, root, hold: contributedHold({ root }), alone: ALONE });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) storytreeTest();
