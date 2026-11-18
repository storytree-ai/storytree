// Capability 3 · Surfaces
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { build } from "esbuild";

import { roadWorkerBuild, territoryWorkerBuild } from "./road-worker.js";

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
  onmessage({ data: { islands: [{ id: "a", x: 0, y: 0, r: 40 }, { id: "b", x: 400, y: 0, r: 40 }],
    lanes: { edges: [{ from: "a", to: "b" }], seed: "lane", tuning: {} } } });
  type Point = { x: number; y: number };
  type Network = { edges: { from: string; to: string; segments: { id: string }[] }[]; segments: { id: string; points: Point[] }[] };
  const [answer] = JSON.parse(JSON.stringify(answers)) as { network?: { lanes: Network } }[];
  for (const kind of ["lanes"] as const) {
    const network = answer?.network?.[kind];
    assert.deepEqual(network?.edges.map(({ from, to }) => [from, to]), [["a", "b"]], `the ${kind} are routed`);
    const ids = new Set(network!.edges[0]!.segments.map(({ id }) => id));
    const route = network!.segments.filter(({ id }) => ids.has(id)).flatMap(({ points }) => points);
    const nearest = (x: number) => Math.min(...route.map(point => Math.hypot(point.x - x, point.y)));
    assert.ok(nearest(0) < 80, `the ${kind} reach island a; nearest ${nearest(0)}`);
    assert.ok(nearest(400) < 80, `the ${kind} reach island b; nearest ${nearest(400)}`);
  }
});

test("3.18 · the desktop page names the forest's territory search worker, and the script the app's build makes for it answers a search as a worker", { timeout: 120_000 }, async () => {
  const page = readFileSync(path.join(import.meta.dirname, "index.html"), "utf8");
  const named = /<meta name="storytree-territory-worker" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(named, "the page names its territory worker");
  const options = territoryWorkerBuild(path.join(import.meta.dirname, "out"));
  assert.equal(path.basename(options.outfile), named, "the build makes the script the page names, beside the page");
  const result = await build({ ...options, write: false, logLevel: "silent" });
  const answers: unknown[] = [];
  const scope: Record<string, unknown> = { WorkerGlobalScope: class {}, postMessage: (answer: unknown) => answers.push(answer) };
  vm.runInNewContext(result.outputFiles[0]!.text, scope);
  const onmessage = scope["onmessage"] as (event: { data: unknown }) => void;
  const r = 87.6, coast = [Array.from({ length: 48 }, (_, i) => ({ x: r * Math.cos(i * Math.PI / 24), z: r * Math.sin(i * Math.PI / 24) }))];
  onmessage({ data: { shares: [{ capability: "a", lines: 600 }, { capability: "b", lines: 400 }], coast, links: [{ from: "z", to: "a" }, { from: "b", to: "a" }], docks: [{ local: { x: r, z: 0 }, links: ["z->a"] }], steps: 1 } });
  const [answer] = JSON.parse(JSON.stringify(answers)) as { found?: { seeds: Record<string, { x: number; z: number }>; score: number; start: number } }[];
  assert.deepEqual(Object.keys(answer?.found?.seeds ?? {}).sort(), ["a", "b"], "a seed for each territory");
  assert.ok(answer!.found!.score <= answer!.found!.start, "no worse than its start");
});
