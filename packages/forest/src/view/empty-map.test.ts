/**
 * Capability 3 · Story node render: what the map says while its project has no story (3.107, from Fable's first judged run,
 * research_e16161487f5a F1.1). Read as the page draws it; its button is clicked in Chrome (forest-view-painted.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyMap } from "./empty-map.js";

const box = (props: Parameters<typeof EmptyMap>[0]): string => renderToStaticMarkup(createElement(EmptyMap, props));

test("3.107 a map read with no stories says on its Stories face why it is empty and what to do, with a button to the first-run guide; it goes when the first story arrives", () => {
  const guide = () => {};
  const empty = box({ read: true, face: "stories", islands: 0, onGuide: guide });
  assert.match(empty, /Nothing on the map yet/, "it says the map is empty");
  assert.match(empty, /appear here as your agent plans them/, "and what makes it grow");
  assert.match(empty, /start your coding agent in this project(?:'|&#x27;)s folder and give it a small piece of work/, "and what to do");
  assert.match(empty, /<button[^>]*>First-run guide<\/button>/, "with a way back to the guide");
  assert.equal(box({ read: false, face: "stories", islands: 0, onGuide: guide }), "", "nothing before the project is read: the map may yet fill");
  assert.equal(box({ read: true, face: "library", islands: 0, onGuide: guide }), "", "nothing on the Library face, which shows notes, not stories");
  assert.equal(box({ read: true, face: "stories", islands: 1, onGuide: guide }), "", "gone once a story is on the map");
  assert.doesNotMatch(box({ read: true, face: "stories", islands: 0 }), /<button/, "no button where the frame offers no guide");
});
