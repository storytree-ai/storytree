/**
 * The page's road worker (capability 3 · Surfaces, contract 3.18): the drawing engine routes the map's roads in the
 * script the page names (its 4.21 seam), so routing neither blocks the page nor waits for the hidden window's next frame.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { build } from "esbuild";

import { roadWorkerBuild } from "./road-worker.js";

test("3.18 · the desktop page names a road worker, and the script the app's build makes for it answers a routing as a worker", { timeout: 60_000 }, async () => {
  const page = readFileSync(path.join(import.meta.dirname, "index.html"), "utf8");
  const named = /<meta name="storytree-road-worker" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(named, "the page names its road worker");
  const options = roadWorkerBuild(path.join(import.meta.dirname, "out"));
  assert.equal(path.basename(options.outfile), named, "the build makes the script the page names, beside the page");
  const result = await build({ ...options, write: false, logLevel: "silent" });
  const answers: unknown[] = [];
  const scope: Record<string, unknown> = { WorkerGlobalScope: class {}, postMessage: (answer: unknown) => answers.push(answer) };
  vm.runInNewContext(result.outputFiles[0]!.text, scope);
  const onmessage = scope["onmessage"] as (event: { data: unknown }) => void;
  onmessage({ data: { islands: [{ id: "a", x: 0, y: 0, r: 40 }, { id: "b", x: 400, y: 0, r: 40 }], edges: [{ from: "a", to: "b" }], seed: "road", tuning: {} } });
  // The answer was made in the script's own realm; as plain data it is what a worker posts back.
  type Point = { x: number; y: number };
  const [answer] = JSON.parse(JSON.stringify(answers)) as { network?: { edges: { from: string; to: string; segments: { id: string }[] }[]; segments: { id: string; points: Point[] }[] } }[];
  assert.deepEqual(answer?.network?.edges.map(({ from, to }) => [from, to]), [["a", "b"]]);
  // The routed road runs from island a's coast to island b's: some point of it lies just off each island.
  const ids = new Set(answer!.network!.edges[0]!.segments.map(({ id }) => id));
  const road = answer!.network!.segments.filter(({ id }) => ids.has(id)).flatMap(({ points }) => points);
  const nearest = (x: number) => Math.min(...road.map(point => Math.hypot(point.x - x, point.y)));
  assert.ok(nearest(0) < 80, `the road reaches island a; nearest ${nearest(0)}`);
  assert.ok(nearest(400) < 80, `the road reaches island b; nearest ${nearest(400)}`);
});
