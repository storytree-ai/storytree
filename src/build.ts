/** Capability 1 · Home page. */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { MARK_LINKS, inlineMark, writeMarkFiles } from "./mark.js";
import { openingMarkup } from "./opening-markup.js";
import { claimsMarkup, SHORTS } from "./claims.js";
import { pageEndMarkup } from "./page-end.js";
import { fill, tourCounts } from "./tour-counts.js";
import type { TourSnapshot } from "./forest-data.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * One static folder: no server runtime and no connection to the project's library. It names the merge
 * it was built from (CI's WEBSITE_SHA) in a meta tag and /version.txt; a local build says it is one.
 */
export async function buildWebsite(output = path.join(packageRoot, "dist"), options: { commit?: string | undefined; preview?: boolean; base?: string } = {}) {
  const commit = "commit" in options ? options.commit : process.env.WEBSITE_SHA;
  // The live site shows only what is ready; the preview build (WEBSITE_PREVIEW=1) adds the claims and their shorts.
  const preview = options.preview ?? process.env.WEBSITE_PREVIEW === "1";
  // Where the build is served from: the site's root, or a folder of it such as the preview's /staging/.
  const base = options.base ?? "/";
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(base)) throw new Error("The website's base must be a folder path, such as /staging/.");
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
  // the exact bundle it was built with, including on the not-found page.
  const entries = new Map(Object.entries(result.metafile.outputs)
    .filter(([, asset]) => asset.entryPoint)
    .map(([name, asset]) => [path.basename(asset.entryPoint!, path.extname(asset.entryPoint!)), `/assets/${path.basename(name)}`]));
  // The page's numbers come from the saved reading its map draws, so the words never outrun the data.
  const counts = tourCounts(JSON.parse(await readFile(path.join(packageRoot, "src", "forest-snapshot.json"), "utf8")) as TourSnapshot);
  for (const page of ["index.html", "404.html"]) {
    const template = fill(await readFile(path.join(packageRoot, "src", page), "utf8"), counts);
    const html = template.replace("<!-- OPENING -->", openingMarkup()).replace("<!-- CLAIMS -->", preview ? claimsMarkup() : "").replace("<!-- PAGE END -->", pageEndMarkup()).replaceAll("<!-- MARK -->", inlineMark())
      .replace("<!-- MARK LINKS -->", MARK_LINKS)
      .replace(/\/assets\/(main|forest|styles)\.(?:js|css)/g, (_, name: string) => {
        const entry = entries.get(name);
        if (!entry) throw new Error(`Missing website entry: ${name}`);
        return entry;
      })
      .replace("</head>", `  <meta name="storytree-commit" content="${version}">\n  </head>`);
    await writeFile(path.join(output, page), preview ? unlisted(rebase(html, base)) : rebase(html, base));
  }
  await writeFile(path.join(output, "version.txt"), `${version}\n`);
  try {
    // The site's own configuration (.herenow's Site Data, .well-known) is served once, from the root.
    const root = path.join(packageRoot, "public");
    await cp(root, output, { recursive: true, filter: from => base === "/" || !/^\.(?:herenow|well-known)$/.test(path.relative(root, from).split(path.sep)[0]!) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Each claim's short is served from where it was rendered (its folder under shorts/), so the site and the render keep one copy.
  for (const { src, poster, rendered } of preview ? SHORTS : []) {
    const from = path.join(packageRoot, "shorts", rendered.folder);
    await mkdir(path.join(output, path.dirname(src)), { recursive: true });
    await cp(path.join(from, rendered.video), path.join(output, src));
    await cp(path.join(from, rendered.poster), path.join(output, poster));
  }
  await writeMarkFiles(output);
  return result.metafile;
}

/** Root-relative links, assets, icons and shorts, and the share and canonical addresses, moved into the build's base folder. */
function rebase(html: string, base: string): string {
  if (base === "/") return html;
  return html.replace(/(\s(?:href|src|srcset|poster)=")\/(?!\/)/g, `$1${base}`)
    .replace(/(\s(?:href|content)=")https:\/\/storytree\.dev\//g, `$1https://storytree.dev${base}`);
}

/** The preview build is never listed: one robots tag on every page, in place of any it had. */
function unlisted(html: string): string {
  return html.replace(/\s*<meta name="robots"[^>]*>/g, "").replace("</head>", '  <meta name="robots" content="noindex, nofollow">\n  </head>');
}

/**
 * What CI publishes (ADR-1165, question_671e6e53d9c5): the live build at the site's root and the preview build under
 * /staging/ on the same here.now site, which the root's robots.txt asks search engines to leave alone.
 */
export async function buildSite(output = path.join(packageRoot, "dist"), options: { commit?: string | undefined } = {}) {
  await buildWebsite(output, { ...options, preview: false });
  await buildWebsite(path.join(output, "staging"), { ...options, preview: true, base: "/staging/" });
  await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /staging/\n");
}

/** The build script's choice: one build (WEBSITE_PREVIEW=1 for the preview's), or with WEBSITE_SITE=1 the site CI publishes. */
export async function buildFromEnvironment(output?: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.WEBSITE_SITE === "1") await buildSite(output);
  else await buildWebsite(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildFromEnvironment();
  console.log("Website built: dist");
}
