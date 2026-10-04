import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { openingMarkup } from "./opening-markup.js";
import { fill, growthCounts, tourCounts } from "./tour-counts.js";
import type { GrowthSnapshot, TourSnapshot } from "./forest-data.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * One static folder: no server runtime and no connection to the project's library. It names the merge
 * it was built from (CI's WEBSITE_SHA) in a meta tag and /version.txt; a local build says it is one.
 */
export async function buildWebsite(output = path.join(packageRoot, "dist"), options: { commit?: string | undefined } = {}) {
  const commit = "commit" in options ? options.commit : process.env.WEBSITE_SHA;
  if (commit && !/^[a-f0-9]{40}$/.test(commit)) throw new Error("The website's commit must be a full Git commit hash.");
  const version = commit || "unpublished local build";
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: { main: "src/main.ts", forest: "src/forest.ts", styles: "src/styles.css" },
    entryNames: "[name]-[hash]",
    outdir: path.join(output, "assets"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    sourcemap: process.env.WEBSITE_SOURCE_MAPS === "1",
    metafile: true,
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".glb": "binary", ".png": "file", ".webp": "file" },
    logLevel: "silent",
  });
  // HTML and assets can be cached independently by the host. Each document must name
  // the exact bundle it was built with, including on the waitlist and not-found pages.
  const entries = new Map(Object.entries(result.metafile.outputs)
    .filter(([, asset]) => asset.entryPoint)
    .map(([name, asset]) => [path.basename(asset.entryPoint!, path.extname(asset.entryPoint!)), `/assets/${path.basename(name)}`]));
  // The tour's numbers come from the saved reading the page draws, so the words never outrun the data.
  const counts = { ...tourCounts(JSON.parse(await readFile(path.join(packageRoot, "src", "forest-snapshot.json"), "utf8")) as TourSnapshot),
    ...growthCounts(JSON.parse(await readFile(path.join(packageRoot, "src", "own-snapshot.json"), "utf8")) as GrowthSnapshot,
      JSON.parse(await readFile(path.join(packageRoot, "src", "shop-snapshot.json"), "utf8")) as GrowthSnapshot) };
  const countsScript = `<script type="application/json" id="tour-counts">${JSON.stringify(counts).replaceAll("<", "\\u003c")}</script>`;
  for (const page of ["index.html", "waitlist.html", "404.html"]) {
    const template = fill(await readFile(path.join(packageRoot, "src", page), "utf8"), counts);
    const html = template.replace("<!-- OPENING -->", openingMarkup()).replace("<!-- COUNTS -->", countsScript)
      .replace(/\/assets\/(main|forest|styles)\.(?:js|css)/g, (_, name: string) => {
        const entry = entries.get(name);
        if (!entry) throw new Error(`Missing website entry: ${name}`);
        return entry;
      })
      .replace("</head>", `  <meta name="storytree-commit" content="${version}">\n  </head>`);
    await writeFile(path.join(output, page), html);
  }
  await writeFile(path.join(output, "version.txt"), `${version}\n`);
  try {
    await cp(path.join(packageRoot, "public"), output, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result.metafile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWebsite();
  console.log("Website built: packages/website/dist");
}
