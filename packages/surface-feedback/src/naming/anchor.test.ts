import assert from "node:assert/strict";
import { test } from "node:test";

import type { FeedbackAnchor } from "../record/bridge.js";
import { bundled, launchChrome, pageWith } from "../testing/page.js";

const PAGE = `
  <section data-surface-id="arcs" data-arc="arc_000000000001" style="padding: 20px">
    <ul><li>first</li><li><button type="button" class="close" style="color: rgb(1, 2, 3); font-size: 15px" data-action="close" onclick="void 0" data-session-token="abc" title="Close the drawer">Close   <b>now</b></button></li></ul>
    <label for="who">Who</label><input id="who" value="hunter2" data-x="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl">
    <div id="long">${"words ".repeat(600)}</div>
    <div id="drawn">drawn by React</div>
  </section>
  <button id="gear" type="button" aria-label="Menu"><svg viewBox="0 0 16 16" width="40" height="40"><rect id="cog" width="16" height="16"/></svg></button>
  <canvas id="globe" width="200" height="100" style="display: block"></canvas>
  <div id="corner" style="position: fixed; right: 0; bottom: 0; width: 50px; height: 50px">corner</div>
`;

test("2.2 · the element pointed at is recorded with a selector only it matches, its tag, role, accessible name, text, marks, React components, box, styles and markup capped at 2 KB with only allowlisted attributes and secrets redacted, in its nearest surface; an icon is picked as its control, and a drawn canvas and the corner never are", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await pageWith(browser, PAGE, [await bundled({ entryPoints: [new URL("./anchor.ts", import.meta.url)] }, "anchor")]);
  const anchor = (selector: string) => page.evaluate(`anchor.anchorOf(document.querySelector(${JSON.stringify(selector)}))`) as Promise<FeedbackAnchor>;

  const button = await anchor("button.close");
  assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(button.selector)}).length === 1 && document.querySelector(${JSON.stringify(button.selector)}).matches("button.close")`), true, `${button.selector} matches the button alone`);
  assert.equal(button.tag, "button");
  assert.equal(button.role, "button");
  assert.equal(button.name, "Close the drawer", "its title names it");
  assert.equal(button.text, "Close now", "its text, on one line");
  assert.deepEqual(button.marks, ['button[data-action="close"]', 'button[data-session-token="[redacted]"]', 'section[data-surface-id="arcs"]', 'section[data-arc="arc_000000000001"]'], "each mark, nearest first, a secret's value redacted");
  assert.equal(button.styles.color, "rgb(1, 2, 3)");
  assert.equal(button.styles["font-size"], "15px");
  const box = await page.evaluate("(() => { const b = document.querySelector('button.close').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()");
  assert.deepEqual(button.box, box);
  assert.match(button.html, /^<button type="button" class="close" data-action="close" data-session-token="\[redacted\]" title="Close the drawer">Close {3}<b>now<\/b><\/button>$/, "style and handlers are dropped from the markup");
  assert.deepEqual(button.components, [], "no components where React drew nothing");
  assert.equal(await page.evaluate("anchor.surfaceOf(document.querySelector('button.close'))"), "arcs", "its surface is the nearest one marked");

  const input = await anchor("#who");
  assert.equal(input.selector, "#who");
  assert.equal(input.role, "textbox");
  assert.equal(input.name, "Who", "an input is named by its label");
  assert.doesNotMatch(input.html, /hunter2|eyJ/, "a value and a token-shaped mark are not kept");

  const long = await anchor("#long");
  assert.ok(long.html.length <= 2048, `markup capped at 2 KB, not ${long.html.length}`);
  assert.ok(long.text!.length <= 200);

  // React keeps its fiber on the nodes it renders; components are read up its owners, host elements skipped.
  await page.evaluate(`(() => {
    function ArcsDrawer() {}
    function Row() {}
    const memo = { $$typeof: Symbol.for("react.memo"), type: function Badge() {} };
    const root = { type: null, return: null };
    const drawer = { type: ArcsDrawer, return: root };
    const row = { type: Row, return: { type: "div", return: { type: Row, return: drawer } } };
    document.getElementById("drawn")["__reactFiber$x1"] = { type: "div", return: { type: memo, return: row } };
  })()`);
  assert.deepEqual((await anchor("#drawn")).components, ["Badge", "Row", "ArcsDrawer"]);

  const corner = "document.getElementById('corner')";
  const at = (x: number, y: number) => page.evaluate(`anchor.pickableAt(document, ${x}, ${y}, ${corner})?.id ?? anchor.pickableAt(document, ${x}, ${y}, ${corner})?.tagName ?? null`);
  const globe = (await page.locator("#globe").boundingBox())!;
  assert.equal(await at(globe.x + 10, globe.y + 10), null, "a drawn canvas is never picked");
  const cog = (await page.locator("#cog").boundingBox())!;
  assert.equal(await at(cog.x + 5, cog.y + 5), "gear", "an icon is picked as the button it draws");
  const who = (await page.locator("#who").boundingBox())!;
  assert.equal(await at(who.x + 2, who.y + 2), "who");
  await page.evaluate(`Object.assign(${corner}.style, { left: "${who.x}px", top: "${who.y}px", right: "auto", bottom: "auto" })`);
  assert.equal(await page.evaluate(`document.elementFromPoint(${who.x + 2}, ${who.y + 2}).id`), "corner");
  assert.equal(await at(who.x + 2, who.y + 2), "who", "the corner's own elements are looked through");
});
