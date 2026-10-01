// `pnpm build:guidance`: generate this repo's own agent guidance from the agent roles in the project
// `storytree` in the desktop app's library (~/.storytree/0.3): CLAUDE.md's generated region,
// AGENTS.md, a Claude Code and a Codex role file for every other role, and a SKILL.md for each
// harness for every process marked as a skill, removing role and skill files nothing generates any more. `pnpm check:guidance` (`--check`) writes nothing and exits 1 when a
// committed file has drifted from the library. Both exit 1 when a file is over its size budget.
//
// The generated files stay committed, because Claude Code and Codex read them at session start,
// before anything can reach a library. This generator may hold a library connection; nothing on a
// session's startup path may, so no hook runs it.
//
// It reads the library wherever the user's `library` setting puts it (ADR-0745 found it reading a
// stale local copy after storytree's own library moved to Cloud SQL): the Cloud SQL instance the
// setting names, or the running app's local database through the address it leaves beside its data
// directory, and otherwise starts the app's Postgres on that directory, as `pnpm library:export`
// does, and stops it again at the end. The rules live in packages/dev-loop/src/guidance.mjs.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { locateLibrary, readLibrary } from "@storytree/agent-link";
import { connect } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { driftOf, expectedFiles, overBudget, readRoles, ROLE_DIRS, SKILL_DIRS } from "./guidance.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";

let server; // the app's Postgres, when this started it

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\nguidance: interrupted");
    void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
  main(process.argv.includes("--check")).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\nguidance: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main(check) {
  const roles = await withLibrary(readRoles, check ? "pnpm check:guidance" : "pnpm build:guidance");
  if (roles === undefined) return 1;
  return syncGuidance(expectedFiles(roles, readFileSync(path.join(root, "CLAUDE.md"), "utf8")), { root, check });
}

/**
 * Bring the guidance files under `root` to `expected`: the build writes each stale or missing file and
 * removes each orphan; the check (`check`) writes nothing and says what drifted. The exit code: 1 when
 * the check found drift or a file is over its size budget, else 0.
 */
export function syncGuidance(expected, { root, check, log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const drift = driftOf(expected, diskAt(root));
  if (!check) {
    for (const { file, problem } of drift) {
      if (problem === "orphan") {
        rmSync(path.join(root, file));
        if (file.endsWith("/SKILL.md") && readdirSync(path.dirname(path.join(root, file))).length === 0) rmSync(path.dirname(path.join(root, file)), { recursive: true });
      }
      else {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), expected.get(file));
      }
      log(`${problem === "orphan" ? "removed" : "wrote"} ${file}`);
    }
    if (drift.length === 0) log("the guidance already matches the library");
  } else if (drift.length > 0) {
    error(`The committed guidance has drifted from the library:\n${drift.map(({ file, problem }) => `  ${problem}: ${file}`).join("\n")}`);
    error("Run `pnpm build:guidance` and commit what it changes.");
  } else {
    log("the guidance matches the library");
  }

  const over = overBudget(expected);
  for (const { file, bytes, budget } of over) error(`over budget: ${file} is ${bytes} bytes; its budget is ${budget}`);
  return (check && drift.length > 0) || over.length > 0 ? 1 : 0;
}

/** Run `read` on the project's library, or say why the library could not be opened and return undefined. */
async function withLibrary(read, COMMAND) {
  const home = path.dirname(appHome().pgdata);
  const where = locateLibrary({ home, dataDir: appHome().pgdata });
  let options = where.found ? where.connect : undefined;
  if (options === undefined && readLibrary(home).location === "local") {
    try {
      server = await start({ dataDir: appHome().pgdata, owner: COMMAND });
    } catch (error) {
      if (!(error instanceof DataDirInUseError)) throw error;
      console.error(`The app's library in ${appHome().pgdata} is in use by process ${error.pid}. When it has finished, run \`${COMMAND}\` again.`);
      return undefined;
    }
    options = { url: server.url };
  }
  const storytree = await connect(options);
  try {
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`The app's library has no project "${PROJECT}". Restore it from a snapshot with \`pnpm library:restore\`.`);
      return undefined;
    }
    const library = await storytree.openProject(PROJECT);
    try {
      return await read(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await server?.stop();
  }
}

/** The guidance files as they are under `root`. */
const diskAt = (root) => ({
  read(file) {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch {
      return undefined;
    }
  },
  list(dir) {
    if (SKILL_DIRS.includes(dir)) {
      try {
        return readdirSync(path.join(root, dir))
          .map((name) => `${dir}/${name}/SKILL.md`)
          .filter((file) => existsSync(path.join(root, file)));
      } catch {
        return [];
      }
    }
    if (!(dir in ROLE_DIRS)) return [];
    try {
      return readdirSync(path.join(root, dir)).map((name) => `${dir}/${name}`);
    } catch {
      return [];
    }
  },
});
