import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import type { Line } from "@storytree/session-management";
import { smokeArcSurface, type ArcDrawn, type BoardReads, type BoardSnapshot } from "../index.js";
import { record } from "../testing/records.js";
import { mountArcSurface } from "./index.js";

test("3.6 the public smoke check visits the mounted scopes and expands queues, judging only drawn chips and root bars", async (t) => {
  const page = new Window({ url: "https://storytree.test" });
  const document = page.document as unknown as Document;
  let surface: ReturnType<typeof mountArcSurface> | undefined;
  const globals = { document: page.document, HTMLElement: page.HTMLElement, localStorage: page.localStorage };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(async () => {
    surface?.stop();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await page.happyDOM.abort();
  });

  const arc = (id: string, state: "active" | "parked" | "closed" = "active") => ({
    arc: record(id, "arc", { title: id, intent: `Build ${id}`, endState: "Done" }), state,
    increments: [record(`${id}-work`, "increment", { arc: id, title: `${id} work`, objective: id, body: id, status: "proposal" })],
    questions: [],
  });
  const snapshot: BoardSnapshot = {
    arcs: [arc("build"), arc("release"), arc("branch"), arc("hidden"), arc("other"), arc("follow"), arc("later", "parked"), arc("done", "closed")],
    waits: {
      release: [{ on: "build", reason: "Build first", forGood: false }],
      branch: [{ on: "build", reason: "Build first", forGood: false }],
      hidden: [{ on: "release", reason: "Release first", forGood: false }],
      follow: [{ on: "other", reason: "Other work first", forGood: false }],
    },
    heldOn: {},
  };
  const at = new Date().toISOString();
  const lines: Line[] = [
    { seq: 1, project: "p", session: "s", harness: "codex", source: "hook", kind: "session-started", at },
    { seq: 2, project: "p", session: "s", harness: "codex", source: "tool", kind: "claimed", increment: "build-work", reason: "Build it", at },
  ];
  const reads: BoardReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async (_project, cursor) => ({ lines: lines.filter((line) => line.seq > cursor), cursor: 2 }),
    arcViews: async () => snapshot.arcs,
    holds: async () => ({ waits: snapshot.waits, heldOn: snapshot.heldOn }),
  };
  surface = mountArcSurface(document.body, { project: "p", reads });
  const observed: { scope: string; drawn: ArcDrawn }[] = [];
  const execution = {
    async executeJavaScript(code: string): Promise<unknown> {
      const result = await page.eval(code);
      if (result && typeof result === "object" && "arcs" in result) {
        observed.push({
          scope: document.querySelector('[data-arc-scope][aria-pressed="true"]')!.getAttribute("data-arc-scope")!,
          drawn: JSON.parse(JSON.stringify(result)),
        });
      }
      return result;
    },
  };
  assert.deepEqual(await smokeArcSurface(execution, "p", reads), []);
  assert.deepEqual(observed.map(({ scope }) => scope), ["active", "parked", "closed"]);
  assert.deepEqual({ ...observed[0]!.drawn, arcs: new Set(observed[0]!.drawn.arcs) }, {
    arcs: new Set(["build", "release", "branch", "other", "follow"]), increments: ["build-work", "other-work"],
    holders: [{ work: "build-work", session: "s", label: "Codex" }],
  });
  assert.deepEqual(observed[1]!.drawn.arcs, ["later"]);
  assert.deepEqual(observed[1]!.drawn.increments, ["later-work"]);
  assert.deepEqual(observed[2]!.drawn.arcs, ["done"]);
  assert.deepEqual(observed[2]!.drawn.increments, ["done-work"]);
  assert.equal(document.querySelector('[data-arc-scope="active"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelector('[data-arc-queue="build"]')!.getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelector('[data-arc-queue="other"]')!.getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelector(".arc-queue-more")!.textContent, "+1");
  assert.equal(document.querySelector('[data-arc-id="hidden"]'), null);
  assert.equal(document.querySelector('[data-increment-id="release-work"]'), null);

  const missing = arc("missing");
  assert.deepEqual(await smokeArcSurface(execution, "p", { ...reads, arcViews: async () => [...snapshot.arcs, missing] }),
    ["arc not drawn: missing", "increment not drawn: missing work"]);
});
