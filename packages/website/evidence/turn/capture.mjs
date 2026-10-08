// Act 1's turn, frame by frame (contract 1.9), from a locally built site on SwiftShader at 1440×900.
// node packages/website/evidence/turn/capture.mjs <built dist folder> <label>
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, label] = [path.resolve(process.argv[2]), process.argv[3]];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator("#opening-better").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator("#opening-better").click();
  const start = Date.now();
  for (const at of [150, 450, 750, 1050, 1500]) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - start)));
    await page.screenshot({ path: path.join(here, `${label}-${String(at).padStart(4, "0")}ms.png`) });
  }
} finally { await browser.close(); server.close(); }
