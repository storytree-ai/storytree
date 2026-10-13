// Drive the running storytree window over the Chrome DevTools Protocol (app started with
// --remote-debugging-port=9222). Usage: node cdp.mjs <outDir> <step...>
// Steps: shot:<name> | eval:<js> | click:<css> | wait:<ms> | select:<projectName>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [outDir, ...steps] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target: " + JSON.stringify(targets));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((ok) => { const n = ++id; pending.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return "EXCEPTION " + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails);
  return r.result?.result?.value;
};
for (const step of steps) {
  const i = step.indexOf(":");
  const kind = step.slice(0, i), arg = step.slice(i + 1);
  if (kind === "shot") {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(outDir, arg + ".png"), Buffer.from(r.result.data, "base64"));
    console.log("shot", arg);
  } else if (kind === "mouse") {
    // A real mouse click on the first visible button (or select) whose label or text is `arg`, or on a CSS selector prefixed with "css=".
    const find = arg.startsWith("css=")
      ? `document.querySelector(${JSON.stringify(arg.slice(4))})`
      : `[...document.querySelectorAll("button, select, summary, a")].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (b.getAttribute("aria-label") || b.textContent || "").trim() === ${JSON.stringify(arg)}; })`;
    const rect = await evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (!rect) { console.log("mouse", arg, "NOT VISIBLE"); continue; }
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await new Promise((ok) => setTimeout(ok, 700));
    console.log("mouse", arg, "clicked at", Math.round(rect.x), Math.round(rect.y));
  } else if (kind === "at") {
    // A real mouse click at CSS pixel x,y.
    const [x, y] = arg.split(",").map(Number);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await new Promise((ok) => setTimeout(ok, 700));
    console.log("at", x, y);
  } else if (kind === "type") {
    await send("Input.insertText", { text: arg });
    console.log("typed", arg.length, "chars");
  } else if (kind === "evalfile") {
    console.log("evalfile", arg, JSON.stringify(await evaluate(readFileSync(arg, "utf8"))));
  } else if (kind === "eval") {
    console.log("eval", JSON.stringify(await evaluate(arg)));
  } else if (kind === "click") {
    console.log("click", arg, await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(arg)}); if (!e) return "not found"; e.click(); return "ok"; })()`));
  } else if (kind === "select") {
    console.log("select", arg, await evaluate(`(() => { const s = document.querySelector("#switcher select"); if (!s) return "no switcher"; s.value = ${JSON.stringify(arg)}; s.dispatchEvent(new Event("change")); return [...s.options].map(o => o.value).join(","); })()`));
  } else if (kind === "wait") {
    await new Promise((ok) => setTimeout(ok, Number(arg)));
  }
}
ws.close();
