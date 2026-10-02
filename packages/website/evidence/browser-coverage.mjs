import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { recordBrowserCoverage } from "@storytree/dev-loop/browser-coverage";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

/** Collect execution only for a journey whose existing assertions all pass. */
export async function withBrowserCoverage(browser, { proof, dist, output }, run) {
  const scripts = [];
  const pages = new Set();
  const evidence = { proof, passed: false, build: null, browser: browser.version(), scripts };
  const artifact = path.join(output, `${proof.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase()}.coverage.json.gz`);
  const save = () => {
    const bundles = {};
    const records = scripts.map(({ source, sourceMap, ...script }) => {
      const bundle = { source, sourceMap };
      if (bundles[script.bundlePath]) assert.deepEqual(bundles[script.bundlePath], bundle, "A capture must use one build of each bundle");
      else bundles[script.bundlePath] = bundle;
      return script;
    });
    // Restore recorder inputs with scripts.map(script => ({ ...script, ...bundles[script.bundlePath] })).
    return writeFile(artifact, gzipSync(JSON.stringify({ ...evidence, scripts: records, bundles })));
  };
  const invalidate = () => {
    try {
      recordBrowserCoverage({ pkgDir, proof, passed: false, scripts: [] });
    } catch (error) {
      // The recorder removes the old proof before rejecting a non-passing capture.
      if (error.message !== "only a passing browser proof contributes coverage") throw error;
    }
  };
  invalidate();
  await mkdir(output, { recursive: true });
  await save();
  const root = path.resolve(dist);

  const collect = async (entries) => {
    for (const entry of entries) {
      let url;
      try { url = new URL(entry.url); } catch { continue; }
      if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) continue;
      const bundlePath = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!bundlePath.startsWith(root + path.sep) || !bundlePath.endsWith(".js")) continue;
      const source = await readFile(bundlePath, "utf8");
      assert.equal(entry.source, source, "Coverage must describe the locally emitted script");
      const sourceMap = JSON.parse(await readFile(`${bundlePath}.map`, "utf8"));
      scripts.push({
        url: entry.url,
        scriptId: entry.scriptId,
        bundlePath: path.relative(pkgDir, bundlePath).split(path.sep).join("/"),
        source,
        sourceMap,
        functions: entry.functions,
      });
    }
  };

  const coveredBrowser = new Proxy(browser, {
    get(target, key) {
      if (key !== "newPage") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (options) => {
        const page = await target.newPage(options);
        const close = page.close.bind(page);
        const instrumented = options?.javaScriptEnabled !== false;
        let finished;
        const finish = (...args) => finished ??= (async () => {
          try {
            if (instrumented) await collect(await page.coverage.stopJSCoverage());
          }
          finally {
            pages.delete(finish);
            await close(...args);
          }
        })();
        try {
          // The no-script fallback still runs its assertions, without claiming JS execution.
          if (instrumented) await page.coverage.startJSCoverage({ resetOnNavigation: false });
        } catch (error) {
          await close();
          throw error;
        }
        pages.add(finish);
        page.close = finish;
        return page;
      };
    },
  });

  try {
    evidence.build = (await readFile(path.join(root, "version.txt"), "utf8")).trim();
    assert.match(evidence.build, /^[0-9a-f]{40}$/, "Browser coverage needs the built website's full commit in version.txt");
    const result = await run(coveredBrowser);
    for (const finish of pages) await finish();
    evidence.measured = recordBrowserCoverage({ pkgDir, proof, passed: true, scripts });
    evidence.passed = true;
    await save();
    return result;
  } catch (error) {
    await Promise.allSettled([...pages].map(finish => finish()));
    invalidate();
    evidence.passed = false;
    evidence.error = error.message;
    await save();
    throw error;
  }
}
