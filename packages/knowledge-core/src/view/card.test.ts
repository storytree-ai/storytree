/** Capability 4: the pinned artifact shows its summary and can be dismissed. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Children, isValidElement, type ReactNode } from "react";

import type { Card } from "../look-inside/look-inside.js";
import * as drawing from "./drawing.js";

test("4.1 the shared artifact card shows kind, title and summary without inspection metadata; Close dismisses it", () => {
  const card: Card = {
    id: "note", kind: "principle", title: "Protect a behaviour", summary: "Write the minimum test.", text: "The full detailed explanation.",
    home: "Hidden home", depth: "depth 17", entrances: ["Hidden entrance", "Another entrance"], replacement: "Hidden replacement",
    visits: 29, peeks: 31, wholes: 37, linksToReplaced: ["Hidden linked decision"],
  };
  let closed = false;
  assert.equal(typeof drawing.NoteCard, "function", "the globe and inside view share the built card");
  const rendered = drawing.NoteCard({ card, onClose: () => { closed = true; } });
  const nodes = descendants(rendered);
  const words = nodes.filter((node): node is string => typeof node === "string").join(" ");
  assert.match(words, /principle/);
  assert.match(words, /Protect a behaviour/);
  assert.match(words, /Write the minimum test\./);
  assert.doesNotMatch(words, /full detailed|Hidden|Another entrance|29|31|37|Links|Recorded|Depth|Entrances|depth 17/);
  const close = nodes.find((node) => isValidElement(node) && node.type === "button");
  assert.ok(isValidElement<{ onClick: () => void; "aria-label": string }>(close));
  assert.match(close.props["aria-label"], /Close/);
  close.props.onClick();
  assert.equal(closed, true);

  const whole = drawing.NoteCard({ card: { ...card, summary: undefined }, onClose: () => {} });
  assert.ok(descendants(whole).includes(card.text), "without a summary the entire artifact text is shown");
});

function descendants(node: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  Children.forEach(node, (child) => {
    result.push(child);
    if (isValidElement<{ children?: ReactNode }>(child)) result.push(...descendants(child.props.children));
  });
  return result;
}
