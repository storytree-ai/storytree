// Capability 6 · Layout and routing time and memory measured
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import diagnostics from "node:diagnostics_channel";
import { test } from "node:test";

import { layoutBenchmark, type LayoutBenchmark } from "./benchmark.js";

async function watchingProcesses<T>(run: () => Promise<T>): Promise<{ result: T; started: ChildProcess[] }> {
  const started: ChildProcess[] = [];
  const seen = (message: unknown) => started.push((message as { process: ChildProcess }).process);
  diagnostics.subscribe("child_process", seen);
  try {
    return { result: await run(), started };
  } finally {
    diagnostics.unsubscribe("child_process", seen);
  }
}

function assertShaped(reading: LayoutBenchmark, quantity: "layout" | "routing" | "peak"): void {
  const { median, spread } = reading[quantity];
  assert.ok(typeof median === "number" && Number.isFinite(median) && median > 0, `${quantity}'s median is a positive finite number: ${median}`);
  assert.ok(typeof spread === "number" && Number.isFinite(spread) && spread >= 0, `${quantity}'s spread is a finite number not below zero: ${spread}`);
}

test("6.1 · layoutBenchmark runs the five-story row the runs asked, each in its own new Node process, answering its 5 islands and 4 lanes and each of layout, routing and peak memory as a positive finite median and a non-negative spread", async () => {
  const { result, started } = await watchingProcesses(() => layoutBenchmark({ seed: "five-story-row", runs: 3 }));
  assert.deepEqual(
    { seed: result.seed, runs: result.runs, islands: result.islands, lanes: result.lanes },
    { seed: "five-story-row", runs: 3, islands: 5, lanes: 4 },
  );
  for (const quantity of ["layout", "routing", "peak"] as const) assertShaped(result, quantity);
  assert.equal(started.length, 3, "one process is started for each run");
  assert.deepEqual(started.map(({ spawnfile }) => spawnfile), [process.execPath, process.execPath, process.execPath], "each run's process is Node");
  assert.equal(new Set(started.map(({ pid }) => pid)).size, 3, "no two runs share a process");
});

test("6.1 · layoutBenchmark runs the full code survey seed in a new Node process, answering its 15 islands and 12 lanes and each of layout, routing and peak memory as a positive finite median and a non-negative spread", async () => {
  const { result, started } = await watchingProcesses(() => layoutBenchmark({ seed: "code-survey", runs: 1 }));
  assert.deepEqual(
    { seed: result.seed, runs: result.runs, islands: result.islands, lanes: result.lanes },
    { seed: "code-survey", runs: 1, islands: 15, lanes: 12 },
  );
  for (const quantity of ["layout", "routing", "peak"] as const) assertShaped(result, quantity);
  assert.deepEqual(started.map(({ spawnfile }) => spawnfile), [process.execPath], "the one run is one Node process");
});

test("6.1 · layoutBenchmark refuses a seed name it does not know, naming it", async () => {
  await assert.rejects(
    layoutBenchmark({ seed: "seven-story-ring", runs: 1 }),
    (error: unknown) => error instanceof Error && error.message.includes("seven-story-ring"),
    "an unknown seed is refused, naming it",
  );
});
