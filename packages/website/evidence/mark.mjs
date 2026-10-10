// Build first, then: node packages/website/evidence/mark.mjs [--share]
// --share redraws public/share.png (the 1200 x 630 Open Graph picture) from the built stylesheet and favicon; build again
// afterwards so dist carries it. Without it, pictures of the mark on the site go to evidence/mark (ADR-0794).
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "./capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const output = path.join(here, "mark");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try {
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const stylesheet = (await readdir(path.join(dist, "assets"))).find(name => /^styles-.*\.css$/.test(name));
  const mark = (await readFile(path.join(dist, "waitlist.html"), "utf8")).match(/<svg class="mark"[\s\S]*?<\/svg>/)[0];
  if (process.argv.includes("--share")) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto(`${url}404.html`);
    await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="${url}assets/${stylesheet}">
      <style>body { margin: 0; height: 630px; display: flex; flex-direction: column; justify-content: center; padding-inline: 110px; }
      .wordmark { font-size: 132px; display: flex; align-items: center; } .mark { margin-right: .22em; }
      .lede { margin-top: 40px; font-size: 40px; }</style></head>
      <body><p class="wordmark">${mark}storytree<span>.</span></p><p class="lede">Software you can watch grow.</p></body></html>`);
    await page.screenshot({ path: path.resolve(here, "../public/share.png") });
  } else {
    await mkdir(output, { recursive: true });
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 420, height: 64 }, colorScheme: scheme });
      const ground = scheme === "light" ? "#dee1e6" : "#202124";
      const ink = scheme === "light" ? "#202124" : "#e8eaed";
      await page.goto(`${url}404.html`);
      await page.setContent(`<body style="margin:0;background:${ground};font:13px system-ui;color:${ink}">
        <div style="margin:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;background:${scheme === "light" ? "#fff" : "#35363a"};border-radius:8px 8px 0 0;width:300px;white-space:nowrap">
        <img src="${url}favicon.svg" width="16" height="16">storytree — Software you can watch grow.</div>
        <img src="${url}favicon.svg" width="32" height="32" style="position:absolute;right:66px;top:16px">
        <img src="${url}favicon.svg" width="48" height="48" style="position:absolute;right:10px;top:8px"></body>`);
      await page.screenshot({ path: path.join(output, `tab-${scheme}.png`) });
      await page.close();
    }
    for (const [name, width] of [["waitlist.html", 1280], ["waitlist.html", 390], ["404.html", 1280], ["", 1280], ["", 390]]) {
      const page = await browser.newPage({ viewport: { width, height: 720 } });
      await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
      await page.goto(`${url}${name}`);
      await page.waitForTimeout(1500);
      // The tour's first step fades the heading out; the next one shows it.
      if (name === "") { await page.click("#tour-next"); await page.waitForTimeout(1800); }
      await page.screenshot({ path: path.join(output, `${name.replace(".html", "") || "home"}-${width}.png`), clip: { x: 0, y: 0, width, height: 130 } });
      if (name === "waitlist.html" && width === 1280) {
        const footer = page.locator(".site-footer");
        await footer.screenshot({ path: path.join(output, "waitlist-footer-1280.png") });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
