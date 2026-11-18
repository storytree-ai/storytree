// Capability 3 · Story node render
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LibraryProgress, libraryOpening } from "./library-opening.js";

test("3.116 pressing Library shows a moving loading bar once the notes are not hung within about a third of a second, until they are or Stories is pressed; a quicker open shows none", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const shown: boolean[] = [];
  const opening = libraryOpening(bar => shown.push(bar));

  opening.turned("library");
  t.mock.timers.tick(320);
  opening.hung();
  t.mock.timers.tick(1000);
  assert.deepEqual(shown, [], "an open hung inside a third of a second shows no bar, then or later");

  opening.turned("stories");
  opening.turned("library");
  t.mock.timers.tick(340);
  assert.deepEqual(shown, [true], "past a third of a second still opening, the bar shows");
  t.mock.timers.tick(5000);
  assert.deepEqual(shown, [true], "and stays while the notes are not hung");
  opening.hung();
  assert.deepEqual(shown, [true, false], "it leaves once they are");

  opening.turned("library");
  t.mock.timers.tick(400);
  opening.turned("stories");
  assert.deepEqual(shown, [true, false, true, false], "pressing Stories again takes it away");
  t.mock.timers.tick(1000);
  opening.turned("stories");
  opening.hung();
  assert.deepEqual(shown, [true, false, true, false], "and nothing more is said with no open under way");

  opening.turned("library");
  t.mock.timers.tick(100);
  opening.turned("stories");
  t.mock.timers.tick(1000);
  assert.deepEqual(shown, [true, false, true, false], "Stories pressed before a third of a second shows no bar");

  const bar = renderToStaticMarkup(createElement(LibraryProgress, { shown: true }));
  assert.match(bar, /role="progressbar"/, "the bar is one the lag instruments credit as progress");
  assert.match(bar, /class="forest-library-progress"/, "drawn in the start bar's look");
  assert.equal(renderToStaticMarkup(createElement(LibraryProgress, { shown: false })), "", "and nothing while not shown");
});
