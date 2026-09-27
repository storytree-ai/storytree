/**
 * Capability 1 · Story nodes (the forest story): one story node for every story in the project,
 * each at its place, with its title and its health as the agent reports it. The library's tree and
 * history are written out here as the library hands them to the forest, so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedStory, Change, HealthState } from "@storytree/library";

import { storyNodes, type StoryNode } from "./story-nodes.js";

/** A project's stories as the library hands them to the forest: projectTree()'s stories and changesSince(0)'s changes. */
class Project {
  readonly #stories: AnnotatedStory[] = [];
  readonly #history: Change[] = [];

  /** Add a story with its health as it rolls up, then a capability under it, as an agent planning it would. */
  add(title: string, reported: HealthState = "not-checked", verified: HealthState = "not-checked"): string {
    const id = `story_${this.#history.length + 1}`;
    this.#stories.push({ id, title, capabilities: [], health: { reported: { state: reported }, verified: { state: verified } } });
    this.#change(id, "story", "created", { title });
    this.#change(`${id}_part`, "capability", "created", { title: "1 · A part", story: id }); // the history holds every record
    return id;
  }

  retire(id: string): void {
    const [story] = this.#stories.splice(this.#stories.findIndex((candidate) => candidate.id === id), 1);
    this.#change(id, "story", "retired", { title: story?.title });
  }

  nodes(): StoryNode[] {
    return storyNodes({ stories: [...this.#stories], arcs: [] }, [...this.#history]);
  }

  #change(recordId: string, type: string, action: Change["action"], fields: Record<string, unknown>): void {
    const seq = this.#history.length + 1;
    const at = new Date(Date.UTC(2026, 8, 26, 12, 0, seq)).toISOString();
    this.#history.push({ seq, recordId, type, action, record: { id: recordId, type, version: 1, fields, createdAt: at, updatedAt: at } });
  }
}

test("1.1 three stories give three story nodes, each with its title and its health as the agent reports it", () => {
  const project = new Project();
  project.add("Visitor can sign up", "passing", "failing");
  project.add("Visitor can log in", "failing");
  project.add("Admin sees sign-ups", "not-checked", "passing");

  assert.deepEqual(
    project.nodes().map(({ title, reported }) => ({ title, reported })),
    [
      { title: "Visitor can sign up", reported: "passing" },
      { title: "Visitor can log in", reported: "failing" },
      { title: "Admin sees sign-ups", reported: "not-checked" },
    ],
  );
});

test("1.2 adding a story to the library adds a node, and retiring a story removes its node", () => {
  const project = new Project();
  const signUp = project.add("Visitor can sign up");
  project.add("Visitor can log in");
  assert.deepEqual(titles(project.nodes()), ["Visitor can sign up", "Visitor can log in"]);

  project.add("Admin sees sign-ups");
  assert.deepEqual(titles(project.nodes()), ["Visitor can sign up", "Visitor can log in", "Admin sees sign-ups"]);

  project.retire(signUp);
  assert.deepEqual(titles(project.nodes()), ["Visitor can log in", "Admin sees sign-ups"]);
});

test("1.3 the first story sits at the centre and each later one takes the next place on a spiral; adding or retiring a story moves no other node, and a retired story's place is never given to another", () => {
  const project = new Project();
  const [, logIn] = ["Visitor can sign up", "Visitor can log in", "Admin sees sign-ups"].map((title) => project.add(title));
  const before = project.nodes();
  assert.deepEqual(before.map(({ place }) => place), [1, 2, 3]);
  assert.deepEqual(before[0]?.at, { x: 0, y: 0 });

  project.add("Visitor can reset a password");
  project.retire(logIn ?? "");
  project.add("Admin exports sign-ups");
  const after = project.nodes();
  assert.deepEqual(
    after.map(({ title, place }) => [title, place]),
    [["Visitor can sign up", 1], ["Admin sees sign-ups", 3], ["Visitor can reset a password", 4], ["Admin exports sign-ups", 5]],
  );
  for (const node of before.filter(({ id }) => id !== logIn)) {
    assert.deepEqual(after.find(({ id }) => id === node.id)?.at, node.at, `${node.title} stays where it was`);
  }

  // The spiral: each place about one place-width on from the one before, no two closer than that
  // (so no two story nodes overlap), and wound round the centre: 100 stories sit within 6 widths of it.
  const crowd = new Project();
  for (let n = 1; n <= 100; n++) crowd.add(`Story ${n}`);
  const places = crowd.nodes().map(({ at }) => at);
  places.forEach((at, index) => {
    const previous = places[index - 1];
    if (previous !== undefined) assert.ok(Math.abs(distance(at, previous) - 1) < 0.05, `place ${index + 1} is a place-width on from place ${index}`);
    for (const other of places.slice(0, index)) assert.ok(distance(at, other) > 0.95, `place ${index + 1} overlaps no earlier place`);
    assert.ok(Math.hypot(at.x, at.y) < 6, `place ${index + 1} is within 6 place-widths of the centre`);
  });
});

function titles(nodes: readonly StoryNode[]): string[] {
  return nodes.map(({ title }) => title);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
