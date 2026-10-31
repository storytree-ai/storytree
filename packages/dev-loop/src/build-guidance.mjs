// Capability 4 · Agent guidance. `pnpm build:guidance`: generate this repo's own agent guidance from the agent roles in the project
// `storytree` in the desktop app's library (~/.storytree/0.3): CLAUDE.md's generated region,
// AGENTS.md, a Claude Code and a Codex role file for every other role, and a SKILL.md for each
// harness for every process marked as a skill, removing role and skill files nothing generates any more. `pnpm check:guidance` (`--check`) writes nothing and exits 1 when a
// committed file has drifted from the library by this branch's own doing; drift another editor's
// unlanded library edit explains is printed with that editor and fails nothing (4.5, judgeDrift).
// Both exit 1 when a file is over its size budget.
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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";

import { stopStartedLibrary, withLibrary } from "@storytree/repo-checks/library-reach";
import { driftOf, expectedFiles, judgeDrift, overBudget, readRoles, REGION_END, REGION_START, ROLE_DIRS, SKILL_DIRS, sourcesOf } from "./guidance.mjs";
import { changedFiles } from "@storytree/base-dev-loop/test-scope";

const root = fileURLToPath(new URL("../../..", import.meta.url));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\nguidance: interrupted");
    void stopStartedLibrary().finally(() => process.exit(130));
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
  const read = await withLibrary(async (library) => {
    const roles = await readRoles(library);
    const expected = expectedFiles(roles, readFileSync(path.join(root, "CLAUDE.md"), "utf8"));
    // The check reads the history of only the drifted files' notes, while the library is open.
    const judge = check ? await judgeAgainst(library, roles, expected) : undefined;
    return { expected, judge };
  }, check ? "pnpm check:guidance" : "pnpm build:guidance");
  if (read === undefined) return 1;
  return syncGuidance(read.expected, { root, check, judge: read.judge });
}

/** A judge for the check's drift: each drifted file's notes' history, and what git says of the branch. */
async function judgeAgainst(library, roles, expected) {
  const sources = sourcesOf(roles);
  const drifted = driftOf(expected, diskAt(root));
  const writes = new Map();
  for (const id of new Set(drifted.flatMap(({ file }) => sources.get(file) ?? []))) writes.set(id, await library.history({ id }));
  const branch = branchReading(expected);
  return (drift) => judgeDrift(drift, { sources, writes, me: actorOf(), ...branch });
}

/** What the checkout's branch changes, when it forked, and which files origin/main holds as expected; undefined branchChanged when git cannot say. */
function branchReading(expected) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = git("merge-base", "origin/main", "HEAD").trim();
    const since = new Date(git("show", "-s", "--format=%cI", base).trim()).toISOString();
    const branchChanged = new Set(changedFiles(root).filter((file) => file !== "CLAUDE.md" || regionOf(git("show", `${base}:CLAUDE.md`)) !== regionOf(readFileSync(path.join(root, file), "utf8"))));
    const onMain = new Set();
    for (const [file, content] of expected) {
      try {
        if (lf(git("show", `origin/main:${file}`)) === lf(content)) onMain.add(file);
      } catch {
        // origin/main has no such file
      }
    }
    return { since, branchChanged, onMain };
  } catch {
    return { branchChanged: undefined, onMain: new Set() };
  }
}

/** The actor this shell's writes are recorded as: its harness session, else STORYTREE_SESSION_ID's, else the person (as the command line writes). */
function actorOf() {
  for (const harness of WATCHED_HARNESSES) {
    const session = harness.shellSession === undefined ? undefined : process.env[harness.shellSession]?.trim();
    if (session) return `session:${session}`;
  }
  const named = process.env[SESSION_ENV]?.trim();
  if (named) return `session:${named}`;
  try {
    return `person:${userInfo().username}`;
  } catch {
    return `person:${process.env.USER ?? process.env.USERNAME ?? "unknown"}`;
  }
}

/** CLAUDE.md's generated region, so a hand edit above it is not a change to the region. */
function regionOf(text) {
  text = lf(text);
  const start = text.indexOf(REGION_START);
  return text.slice(start, text.indexOf(REGION_END, start) + REGION_END.length);
}

const lf = (text) => text.replace(/\r\n/g, "\n");

/**
 * Bring the guidance files under `root` to `expected`: the build writes each stale or missing file and
 * removes each orphan; the check (`check`) writes nothing and says what drifted. `judge` splits the
 * check's drift into the branch's own and another editor's (judgeDrift); without one, all of it is
 * the branch's. The exit code: 1 when the check found drift of the branch's own or a file is over
 * its size budget, else 0.
 */
export function syncGuidance(expected, { root, check, judge = (drift) => ({ own: drift, others: [] }), log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const drift = driftOf(expected, diskAt(root));
  const { own, others } = check ? judge(drift) : { own: drift, others: [] };
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
  } else {
    if (own.length > 0) {
      error(`The committed guidance has drifted from the library:\n${own.map(({ file, problem, why }) => `  ${problem}: ${file}${why === undefined ? "" : ` (${why})`}`).join("\n")}`);
      error("Run `pnpm build:guidance` and commit what it changes.");
    }
    if (others.length > 0) {
      log(`Not this branch's drift: another editor's library edit, not yet on origin/main, lands with that editor's pull request:\n${others.map(({ file, problem, editor }) => `  ${problem}: ${file}, last edited by ${editor.actor} at ${editor.at} (${editor.id})`).join("\n")}`);
    }
    if (drift.length === 0) log("the guidance matches the library");
  }

  const over = overBudget(expected);
  for (const { file, bytes, budget } of over) error(`over budget: ${file} is ${bytes} bytes; its budget is ${budget}`);
  return (check && own.length > 0) || over.length > 0 ? 1 : 0;
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
