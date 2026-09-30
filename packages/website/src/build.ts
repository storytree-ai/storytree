import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { escapeHtml, installCommand } from "./install-command.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** One static folder: no server runtime and no connection to the project's library. */
export async function buildWebsite(output = path.join(packageRoot, "dist"), options: { readme?: string } = {}) {
  const readme = options.readme ?? await readFile(path.join(packageRoot, "../../README.md"), "utf8");
  const command = installCommand(readme);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: { main: "src/main.ts", forest: "src/forest.ts", styles: "src/styles.css" },
    outdir: path.join(output, "assets"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    metafile: true,
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".glb": "binary", ".png": "file", ".webp": "file" },
    logLevel: "silent",
  });
  const template = await readFile(path.join(packageRoot, "src/index.html"), "utf8");
  if (template.split("<!-- INSTALL_COMMAND -->").length !== 2) throw new Error("The home page needs one install-command slot.");
  await writeFile(path.join(output, "index.html"), template.replace("<!-- INSTALL_COMMAND -->", escapeHtml(command)));
  await cp(path.join(packageRoot, "src/404.html"), path.join(output, "404.html"));
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
