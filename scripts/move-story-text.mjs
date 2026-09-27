// `pnpm library:move [--dry-run]`: move the story text only stories/*.md holds into the project
// `storytree` in the desktop app's library (~/.storytree/0.3/pgdata), each block as a memory note
// behind its story's or capability's front cover (ADR-0641 D2 step 2). Run `pnpm seed:library`
// first, so the library holds every story, capability and founding book the files name. With
// --dry-run it says what it would file and writes nothing. A second run files nothing.
//
// Each block it cannot place (its node has no front cover, or the library lacks its story or
// capability) is listed by name and not written. Check the result with `pnpm library:export`.
// Like the seed, it writes into the running app's database, or starts the app's Postgres itself
// when the app is not running (scripts/library-server.mjs). The rules live in scripts/library-move.mjs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { appHome } from "../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";
import { moveStoryText } from "./library-move.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "storytree";
const COMMAND = "pnpm library:move";
const dryRun = process.argv.includes("--dry-run");

let server; // the app's Postgres, while it runs
process.once("SIGINT", () => {
  console.error("\nmove: interrupted; stopping Postgres");
  void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
});

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\nmove: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  },
);

async function main() {
  const dir = path.join(root, "stories");
  const committed = new Map(
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => [`stories/${name}`, readFileSync(path.join(dir, name), "utf8")]),
  );
  const home = appHome();
  console.log(`the app's library: ${home.pgdata}${dryRun ? " (dry run: nothing is written)" : ""}`);
  server = await appLibraryServer(COMMAND, { writes: true });

  let moved;
  let storytree;
  try {
    storytree = await connect({ url: server.url });
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe app's library has no project "${PROJECT}". Run \`pnpm seed:library\` first.`);
      return 1;
    }
    const library = await storytree.openProject(PROJECT);
    try {
      moved = await moveStoryText(library, committed, { dryRun });
    } finally {
      await library.close();
    }
  } finally {
    await storytree?.close();
    await server.stop();
  }

  const words = (text) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  console.log(`\n${dryRun ? "would file" : "filed"} ${moved.filed.length} notes:`);
  for (const file of committed.keys()) {
    const mine = moved.filed.filter((note) => note.file === file);
    if (mine.length > 0) console.log(`  ${file.padEnd(28)} ${String(mine.length).padStart(4)} notes, ${mine.reduce((sum, { text }) => sum + words(text), 0)} words`);
  }
  if (moved.unplaced.length === 0) {
    console.log("\nEvery block the story files hold has a place. Check with `pnpm library:export`.");
  } else {
    console.log(`\n${moved.unplaced.length} blocks have no place, so nothing was written for them:`);
    for (const { file, section, text, why } of moved.unplaced) {
      console.log(`  ${file} ${section}: ${why}\n    ${text.split("\n")[0].slice(0, 100)}`);
    }
  }
  return 0;
}
