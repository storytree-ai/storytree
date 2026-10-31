import assert from "node:assert/strict";
import test from "node:test";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { TourSnapshot } from "./forest-data.js";
import { recordedView, savedReading } from "./tour-reading.js";
import type { SessionWindow } from "@storytree/session-management";
import type { Line } from "@storytree/library";

const snapshot = saved as unknown as TourSnapshot;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("2.13 · free play on storytree's own project reads a picked session's window from the recording, answered as absent from the public recording, the core's gate before it draws that session's reading path", async () => {
  const view = recordedView(snapshot);
  try {
    const reader = (snapshot.recording.lines as readonly Line[]).find(line => line.kind === "note-read" && line.session)!.session!;
    const windowOf = () => (view.core as unknown as { get(): { window?: SessionWindow } }).get().window;
    view.core.select(reader);
    await settle();
    // The core draws a selected session's path only once its window is read (ADR-0756); the public recording has none to give.
    const window = windowOf();
    assert.equal(window?.session, reader);
    assert.ok(window && "absent" in window, "the window is answered, as absent");
    assert.match(String(window.absent), /not included in this public recording/);
  } finally { view.core.select(undefined); view.stop(); }
});

test("2.35 · the board reads a saved arc's title where its intent is withheld, and a saved increment's disposition and pull request as how it closed", async () => {
  const at = "2026-10-25T00:00:00.000Z";
  const record = (id: string, type: string, fields: object) => ({ id, type, version: 1, createdAt: at, updatedAt: at, fields });
  const arcs = [{ state: "active", arc: record("arc_a", "arc", { title: "Ship it", priority: 1 }),
    increments: [record("increment_a", "increment", { arc: "arc_a", title: "Built", status: "closed", capabilities: [], disposition: "landed", pr: "7" }),
      record("increment_b", "increment", { arc: "arc_a", title: "Open", status: "proposal", capabilities: [] })], questions: [] }];
  const { reads, reading } = savedReading({ ...snapshot, arcs } as unknown as TourSnapshot);
  try {
    const [view] = await reads.arcViews("storytree");
    assert.equal(view!.arc.fields.intent, "Ship it");
    assert.deepEqual(view!.increments.map(({ fields }) => fields.outcome), [{ disposition: "landed", pr: "7" }, undefined]);
  } finally { reading.stop(); }
});
