import assert from "node:assert/strict";
import { test } from "node:test";
import { createTour, readingTime, type TourStep } from "./tour.js";

const step = (id: string, explainer: TourStep["explainer"], lines = ["One two three four five six seven eight nine ten"]): TourStep => ({
  id, title: id, explainer, lines, why: [], surfaces: {},
});
const steps = [step("opening", "opening", ["First line", "Second line"]), step("story", "stories"), step("comparison", "stories"), step("arcs", "arcs")];

test("2.4 · readable lines, speed, pause and inspection holds control the same tour clock", () => {
  const tour = createTour(steps);
  assert.equal(tour.state.lines, 1);
  tour.tick(readingTime("First line") - 1);
  assert.equal(tour.state.lines, 1);
  tour.togglePause(); tour.tick(60_000);
  assert.equal(tour.state.lines, 1);
  tour.togglePause(); tour.tick(1);
  assert.equal(tour.state.lines, 2);
  tour.toggleWhy(); tour.tick(60_000);
  assert.equal(tour.state.index, 0);
  tour.toggleEverything(); tour.toggleWhy(); tour.tick(60_000);
  assert.equal(tour.state.index, 0);
  tour.toggleEverything(); tour.setSpeed(1.5);
  tour.tick(readingTime("Second line") / 1.5);
  assert.equal(tour.state.index, 1);
  assert.equal(readingTime("one two three four five six seven eight nine ten eleven twelve thirteen"), 5000);
  tour.setSpeed(.75); tour.tick(readingTime(steps[1]!.lines[0]!) / .75 - 1);
  assert.equal(tour.state.index, 1);
  tour.tick(1); assert.equal(tour.state.index, 2);
});

test("2.5 · selecting an explainer plays only its steps; play all and replay restore a complete journey", () => {
  const tour = createTour(steps);
  tour.select("stories");
  assert.equal(tour.state.index, 1);
  tour.next(); assert.equal(tour.state.index, 2);
  tour.next(); assert.equal(tour.state.freePlay, true);
  tour.replay(); assert.equal(tour.state.index, 1);
  assert.equal(tour.state.freePlay, false);
  tour.select("all"); assert.equal(tour.state.index, 0);
  for (let i = 0; i < steps.length; i++) tour.next();
  assert.equal(tour.state.freePlay, true);
});

test("2.6 · skip reaches free play during every hold and replay returns with working controls", () => {
  const tour = createTour(steps);
  tour.togglePause(); tour.toggleWhy(); tour.toggleEverything(); tour.skip();
  assert.equal(tour.state.freePlay, true);
  assert.equal(tour.state.why, false);
  tour.tick(60_000); assert.equal(tour.state.index, 0);
  tour.replay();
  assert.equal(tour.state.paused, false);
  assert.equal(tour.state.everything, false);
  assert.equal(tour.state.lines, 1);
  tour.tick(readingTime("First line")); assert.equal(tour.state.lines, 2);
});
