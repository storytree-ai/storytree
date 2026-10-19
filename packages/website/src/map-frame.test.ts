import assert from "node:assert/strict";
import { test } from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { wireMapFrame } from "./map-frame.js";

/** The frame as index.html lays it out, with a stand-in for the map's canvas and the window listener the map keys on. */
function framed({ touch = false } = {}) {
  const dom = new HappyWindow();
  const view = dom as unknown as Window & typeof globalThis;
  Object.assign(view, {
    matchMedia: (query: string) => ({ matches: touch && query === "(pointer: coarse)" }),
    // happy-dom's WheelEvent drops the modifier keys a browser's keeps.
    WheelEvent: class extends dom.WheelEvent {
      constructor(type: string, init: { ctrlKey?: boolean } = {}) { super(type, init as never); Object.defineProperty(this, "ctrlKey", { value: init.ctrlKey === true }); }
    },
  });
  const document = dom.document as unknown as Document;
  document.body.innerHTML = `<div id="map-frame"><div id="website-forest"><canvas></canvas></div>
    <button data-zoom="in">+</button><button data-zoom="out">−</button>
    <button data-map-tap hidden>Tap to explore</button><button data-map-exit hidden>Done</button><input></div>`;
  const frame = document.getElementById("map-frame")!, canvas = document.querySelector("canvas")!;
  const map = { wheels: [] as WheelEvent[], keys: [] as string[], pointers: 0 };
  canvas.addEventListener("wheel", event => { map.wheels.push(event as WheelEvent); event.preventDefault(); });
  canvas.addEventListener("pointerdown", () => { map.pointers++; });
  view.addEventListener("keydown", event => { map.keys.push((event as unknown as KeyboardEvent).key); event.preventDefault(); });
  wireMapFrame(frame, view);
  const tap = document.querySelector<HTMLButtonElement>("[data-map-tap]")!, exit = document.querySelector<HTMLButtonElement>("[data-map-exit]")!;
  return { view, document, frame, canvas, map, tap, exit };
}

test("2.30 · a plain wheel over the framed map scrolls the page and never zooms the map; ctrl+wheel and the frame's + and − zoom it", () => {
  const { view, document, canvas, map } = framed();
  const plain = new view.WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
  canvas.dispatchEvent(plain);
  assert.equal(map.wheels.length, 0, "the map never hears a plain wheel");
  assert.equal(plain.defaultPrevented, false, "so the browser scrolls the page");
  canvas.dispatchEvent(new view.WheelEvent("wheel", { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(map.wheels.length, 1, "ctrl+wheel, and a trackpad's pinch, zoom the map");
  document.querySelector<HTMLButtonElement>("[data-zoom='in']")!.click();
  assert.ok(map.wheels.length > 1 && map.wheels.slice(1).every(wheel => wheel.ctrlKey && wheel.deltaY < 0), "+ zooms in as ctrl+wheel does");
  const before = map.wheels.length;
  document.querySelector<HTMLButtonElement>("[data-zoom='out']")!.click();
  assert.ok(map.wheels.length > before && map.wheels.slice(before).every(wheel => wheel.ctrlKey && wheel.deltaY > 0), "− zooms out");
});

test("2.30 · WASD and the arrow keys never reach the framed map, and keep their default on the page", () => {
  const { view, document, map } = framed();
  for (const key of ["w", "A", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    const press = new view.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(press);
    assert.equal(press.defaultPrevented, false, `${key} keeps its default`);
  }
  assert.deepEqual(map.keys, [], "the map heard none of them");
  // Typing in a field is the field's, as the map's own keys would leave it.
  document.querySelector("input")!.dispatchEvent(new view.KeyboardEvent("keydown", { key: "w", bubbles: true }));
  assert.deepEqual(map.keys, ["w"]);
});

test("2.31 · on touch the framed map is still until tapped, with a visible way back out to the page", () => {
  const { view, canvas, map, tap, exit, frame } = framed({ touch: true });
  assert.equal(tap.hidden, false, "it offers Tap to explore");
  assert.equal(exit.hidden, true);
  canvas.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
  assert.equal(map.pointers, 0, "a thumb scrolling the page is never caught by the map");
  tap.click();
  assert.equal(frame.dataset.hand, "map");
  assert.equal(tap.hidden, true);
  assert.equal(exit.hidden, false, "the way out shows while the map is the hand's");
  canvas.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
  assert.equal(map.pointers, 1, "once tapped, the map takes drags");
  exit.click();
  assert.equal(tap.hidden, false);
  canvas.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
  assert.equal(map.pointers, 1, "after the way out, the page has the finger again");
});

test("2.31 · with a mouse the framed map takes drags at once and offers no tap", () => {
  const { view, canvas, map, tap, exit } = framed();
  assert.equal(tap.hidden, true);
  assert.equal(exit.hidden, true);
  canvas.dispatchEvent(new view.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
  assert.equal(map.pointers, 1);
});
