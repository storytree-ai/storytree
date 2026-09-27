// `pnpm library:export`: print the project `storytree` in the desktop app's library
// (~/.storytree/0.3/pgdata) as this repo's story and decision files, into library-export/ (which git
// ignores), and check the printout against the committed stories/*.md and decisions/*.md
// (ADR-0641 D2 step 1). It reads the library and writes nothing to it.
//
// library-export/stories/ and library-export/decisions/ hold the printout, and
// library-export/round-trip.md the check: for each committed file, each block only it holds
// ("missing") and each only the printout holds ("extra"), under its section. The missing blocks are
// the worklist for moving the story text into the library (ADR-0641 D2 step 2). A difference is a
// report, not a failure: the command exits 0 whenever it could read the library.
//
// Like `pnpm seed:library`, it reads the running app's database, or starts the app's Postgres
// itself when the app is not running (scripts/library-server.mjs). The rules for printing and comparing live in scripts/library-export.mjs.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { appHome } from "../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";
import { blocksOf, exportLibrary, roundTrip } from "./library-export.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "storytree";
const OUT = "library-export";
const COMMAND = "pnpm library:export";

let server; // the app's Postgres, while it runs
process.once("SIGINT", () => {
  console.error("\nexport: interrupted; stopping Postgres");
  void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
});

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\nexport: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  },
);

async function main() {
  const home = appHome();
  console.log(`the app's library: ${home.pgdata}`);
  server = await appLibraryServer(COMMAND, { writes: false });

  let printed;
  let storytree;
  try {
    storytree = await connect({ url: server.url });
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe app's library has no project "${PROJECT}". Run \`pnpm seed:library\` first.`);
      return 1;
    }
    const library = await storytree.openProject(PROJECT);
    try {
      printed = await exportLibrary(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree?.close();
    await server.stop();
  }

  const out = path.join(root, OUT);
  for (const dir of ["stories", "decisions"]) rmSync(path.join(out, dir), { recursive: true, force: true });
  for (const [file, text] of printed) {
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    writeFileSync(path.join(out, file), text);
  }
  console.log(`\nprinted ${printed.size} files into ${OUT}/`);

  const committed = new Map(["stories", "decisions"].flatMap((dir) => markdownIn(dir).map((file) => [file, readFileSync(path.join(root, file), "utf8")])));
  const diffs = roundTrip(committed, printed);
  writeFileSync(path.join(out, "round-trip.md"), report(diffs));

  const words = (blocks) => blocks.reduce((sum, { words: count }) => sum + count, 0);
  console.log(`\nround trip against the committed files (${OUT}/round-trip.md has every block):`);
  console.log(`  ${"file".padEnd(42)} ${"words".padStart(6)} ${"missing".padStart(16)} ${"extra".padStart(16)}`);
  for (const { file, printedAs, missing, extra } of diffs) {
    const size = committed.has(file) ? String(words(blocksOf(committed.get(file)))) : "";
    const name = printedAs !== undefined && printedAs !== file ? `${file} (${path.basename(printedAs)})` : file;
    console.log(
      `  ${name.padEnd(42)} ${size.padStart(6)} ${`${missing.length} / ${words(missing)} w`.padStart(16)} ${`${extra.length} / ${words(extra)} w`.padStart(16)}`,
    );
  }
  const empty = diffs.every(({ missing, extra }) => missing.length === 0 && extra.length === 0);
  console.log(empty ? "\nThe round trip is empty." : "\nmissing: blocks only the committed file holds; extra: blocks only the printout holds (blocks / words).");
  return 0;
}

/** The round trip as markdown: each file's missing and extra blocks, verbatim, under their sections. */
function report(diffs) {
  const out = ["# Round trip: the committed files against the library's printout", ""];
  for (const { file, printedAs, missing, extra } of diffs) {
    if (missing.length === 0 && extra.length === 0) continue;
    out.push(`## ${file}${printedAs !== undefined && printedAs !== file ? ` (printed as ${printedAs})` : ""}`, "");
    for (const [label, list] of [["Missing (only the file holds it)", missing], ["Extra (only the printout holds it)", extra]]) {
      if (list.length === 0) continue;
      out.push(`### ${label}: ${list.length} blocks, ${list.reduce((sum, { words }) => sum + words, 0)} words`, "");
      let section;
      for (const block of list) {
        if (block.section !== section) {
          section = block.section;
          out.push(`In \`${section || "(before any heading)"}\`:`, "");
        }
        out.push("````md", block.raw, "````", "");
      }
    }
  }
  return `${out.join("\n")}\n`;
}

/** The .md files in the repo's `dir`, as repo paths (`stories/library.md`), sorted; none if it does not exist. */
function markdownIn(dir) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${dir}/${name}`);
}
