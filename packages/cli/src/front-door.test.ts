/**
 * Capability 1 · Front door: one test per contract 1.1-1.5, 1.15, 1.17-1.19 and 1.21 in the command line story, each running the
 * real, built `storytree` command in a throwaway folder and storytree home.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";
import { openActivityLog } from "@storytree/session-management";
import { APP_FAMILIES } from "@storytree/app/lifecycle/verbs";
import { SETTINGS_FAMILIES } from "@storytree/app/surfaces/verbs";
import { HEALTH_FAMILIES } from "@storytree/ci-health/verbs";
import { IDENTITY_FAMILIES } from "@storytree/identity/verbs";
import { CHECK_FAMILIES } from "@storytree/guardrails/verbs";
import { QUALITY_FAMILIES } from "@storytree/quality-assurance/verbs";
import { JOURNEY_FAMILIES } from "@storytree/journey-events/verbs";
import { LAG_FAMILIES } from "@storytree/lag-in-use/verbs";
import { SESSION_FAMILIES } from "@storytree/session-management/verbs";
import { WORKSPACE_FAMILIES } from "@storytree/session-management/workspace-verbs";
import { LIBRARIAN_FAMILIES } from "@storytree/librarian/verbs";
import { PROCESSES_FAMILIES } from "@storytree/processes/verbs";
import { ARC_FAMILIES } from "@storytree/arc-surface/verbs";
import type { Reading } from "@storytree/reading-the-front-doors";

import { FAMILIES } from "./families/index.js";
import unbundled from "./parts/verbs.js";
import { BuiltCommand, inWorld, storytree, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();
const DECLARED = [...APP_FAMILIES, ...SETTINGS_FAMILIES, ...IDENTITY_FAMILIES, ...CHECK_FAMILIES, ...QUALITY_FAMILIES, ...HEALTH_FAMILIES, ...ARC_FAMILIES, ...LIBRARIAN_FAMILIES, ...PROCESSES_FAMILIES, ...SESSION_FAMILIES, ...WORKSPACE_FAMILIES, ...LAG_FAMILIES, ...JOURNEY_FAMILIES];
const DAY_MS = 24 * 60 * 60 * 1000;

before(() => command.build());
after(() => command.remove());

test("1.1 in a project folder, `library search` finds a note written through the library", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    await library.defineTerm({ term: "The mailer needs a verified sender domain", meaning: "Verify its DNS records before sending." });
    await library.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays" });

    const ran = await world.run(["library", "search", "mailer"]);

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /The mailer needs a verified sender domain/);
    assert.doesNotMatch(ran.stdout, /Tuesdays/);
  });
});

test("1.2 in a folder that is not a project, it exits non-zero with \"not a storytree project\"", async () => {
  await inWorld(command, async (world) => {
    const ran = await storytree(command.script, ["library", "search", "mailer"], { cwd: world.elsewhere, home: world.home });

    assert.notEqual(ran.code, 0);
    assert.match(ran.stderr, /not a storytree project/);
  });
});

test("1.3 with storytree stopped, it says \"storytree isn't running\" within a second", async () => {
  await inWorld(command, async (world) => {
    // Starting the command is the machine's, and a loaded machine stretches it for every command alike: the second
    // is on top of the same command refusing a folder that is no project, which starts it the same way and stops
    // before it looks for a running storytree. Each is taken beside the other, three times, and the best of each
    // compared, so ten sibling test files starting at once charge both, not the stopped answer alone.
    const floors: number[] = [];
    const runs: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const refused = await storytree(command.script, ["library", "search", "mailer"], { cwd: world.elsewhere, home: world.stoppedHome });
      assert.match(refused.stderr, /not a storytree project/);
      floors.push(refused.ms);
      const ran = await storytree(command.script, ["library", "search", "mailer"], { cwd: world.folder, home: world.stoppedHome });
      assert.notEqual(ran.code, 0);
      assert.match(ran.stderr, /storytree isn't running/);
      runs.push(ran.ms);
    }
    const [floor, took] = [Math.min(...floors), Math.min(...runs)];
    assert.ok(took - floor < 1_000, `took at best ${Math.round(took)} ms, refusing a folder that is no project at best ${Math.round(floor)} ms`);
  });
});

test("1.4 a record the library refuses reaches you as the library's own message, and nothing is written", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const refusal = await library.defineTerm({ term: "Mailer", meaning: "" }).then(
      () => assert.fail("the library took a definition with no meaning"),
      (error: Error) => error.message,
    );

    const ran = await world.run(["library", "new", "definition", "--term", "Mailer", "--meaning", ""]);

    assert.equal(ran.code, 1);
    assert.ok(ran.stderr.includes(refusal), `expected the library's own message:\n${refusal}\ngot:\n${ran.stderr}`);
    assert.deepEqual((await library.changesSince(0)).changes, []);
  });
});

test("1.5 `storytree` alone lists the families", async () => {
  await inWorld(command, async (world) => {
    const ran = await world.run([]);

    assert.equal(ran.code, 0, ran.stderr);
    for (const family of ["library", "arc", "question", "adr", "noticeboard", "doctor", "friction", "resteer", "tree"]) {
      assert.match(ran.stdout, new RegExp(`^\\s+${family}\\b`, "m"), `no ${family} in:\n${ran.stdout}`);
    }
  });
});

test("1.6 `--help` after a command prints its usage and summary, and runs nothing", async () => {
  await inWorld(command, async (world) => {
    // In a folder that is no project, and without the --arc it needs: run, it would refuse.
    const ran = await storytree(command.script, ["question", "new", "--help"], { cwd: world.elsewhere, home: world.home });

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /storytree question new --arc <arc>/);
    assert.match(ran.stdout, /raise a question for the owner/);
  });
});

test("1.7 a command it does not have answers with the real command for that job, or the nearest one", async () => {
  await inWorld(command, async (world) => {
    const asked: [readonly string[], RegExp][] = [
      [["library", "show", "x"], /storytree library read <id>/],
      [["question", "read", "x"], /storytree question show <id>/],
      [["arc", "increment", "show", "x"], /storytree library read <id>/],
      [["arc", "increment", "ready", "x"], /ADR-0909 retired[^\n]*claiming a proposal starts it[\s\S]*storytree workspace <increment\b/],
      [["claim", "x"], /storytree workspace <increment\b/],
      [["board"], /storytree noticeboard/],
      [["library", "serch", "mailer"], /storytree library search <words…>/],
      [["questoin", "list"], /storytree question\b/],
    ];
    for (const [argv, answer] of asked) {
      // In a folder that is no project: the refusal needs no library.
      const ran = await storytree(command.script, argv, { cwd: world.elsewhere, home: world.home });

      assert.equal(ran.code, 2, `${argv.join(" ")}: ${ran.stderr}`);
      assert.match(ran.stderr, answer, argv.join(" "));
    }
  });
});

test("1.8 an answer's next: offers only what opens a record it just named", async () => {
  await inWorld(command, async (world) => {
    const term = await (await world.library()).defineTerm({ term: "Mailer", meaning: "Sends the sign-up email" });

    const ran = await world.run(["library", "read", term.id]);

    assert.equal(ran.code, 0, ran.stderr);
    assert.doesNotMatch(ran.stdout, /library history/);
  });
});

test("1.15 a command kept waiting on the library, here for another session's write, goes on when it can, saying nothing while its stderr is captured rather than a terminal", async () => {
  await inWorld(command, async (world) => {
    const url = new URL(testServerUrl());
    url.pathname = `/storytree_${world.project}`;
    const other = new pg.Client({ connectionString: url.href });
    const elsewhere = new pg.Client({ connectionString: testServerUrl() });
    const unrelated = new pg.Client({ connectionString: testServerUrl() });
    let waitingElsewhere: Promise<unknown> | undefined;
    let running: ReturnType<typeof world.run> | undefined;
    await other.connect();
    try {
      await elsewhere.connect();
      await unrelated.connect();
      await elsewhere.query("BEGIN");
      await elsewhere.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      const { rows: backends } = await unrelated.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const pid = backends[0]!.pid;
      waitingElsewhere = unrelated.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))")
        .then(() => undefined, (error: unknown) => error);
      // Keep the same lock key queued in another database, as concurrent CLI tests can.
      let queuedElsewhere = false;
      for (let tries = 0; tries < 200; tries += 1) {
        const { rows } = await elsewhere.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted", [pid]);
        if (rows.length > 0) { queuedElsewhere = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(queuedElsewhere, "the unrelated writer never queued");
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      running = world.run(["library", "new", "definition", "--term", "Mailer", "--meaning", "Sends the mail."]);
      // Only this world's command can queue behind this connection's project write lock.
      // A waiter elsewhere on the shared test server must not release it early.
      let queued = false;
      for (let tries = 0; tries < 200; tries += 1) {
        const { rows } = await other.query(`SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND pg_backend_pid() = ANY(pg_blocking_pids(pid))`);
        if (rows.length > 0) { queued = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(queued, "the command never queued behind this project's write lock");
      await other.query("COMMIT");
      const ran = await running;

      assert.equal(ran.code, 0, ran.stderr);
      // Windows PowerShell 5.1 reads any captured stderr as a failed command, and a truncated pipe ends it (seen 2026-10-08).
      assert.doesNotMatch(ran.stderr, /another session is writing/);
    } finally {
      await other.end();
      await elsewhere.end();
      await waitingElsewhere;
      await unrelated.end();
      // Release the lock and reap the command even when observing its wait fails.
      await running;
    }
  });
});

test("1.17 every answer is recorded on the calling session as a door-answered line: the command, how it went, and the next steps offered as commands; an unknown word with the command its refusal named", async () => {
  await inWorld(command, async (world) => {
    await (await world.library()).defineTerm({ term: "Mailer", meaning: "Sends the sign-up email" });
    const session = { CLAUDE_CODE_SESSION_ID: "door-1" };

    const searched = await world.run(["library", "search", "Mailer"], session);
    const guessed = await world.run(["arc", "increment", "show", "x"], session);
    const misspelt = await world.run(["questoin", "list"], session);

    assert.equal(searched.code, 0, searched.stderr);
    assert.equal(guessed.code, 2, guessed.stderr);
    assert.equal(misspelt.code, 2, misspelt.stderr);
    const log = await openActivityLog(testServerUrl());
    try {
      const lines = await log.lines(world.project, { sessions: ["door-1"], kinds: ["door-answered"] });
      const said = lines.map((line) => {
        const { door, verb, outcome, word, named, next } = line as Extract<typeof line, { kind: "door-answered" }>;
        return { door, verb, outcome, word, named, next };
      });
      assert.deepEqual(said, [
        { door: "command", verb: "storytree library search", outcome: "answered", word: undefined, named: undefined, next: ["storytree library read"] },
        { door: "command", verb: "storytree arc increment", outcome: "unknown", word: "show", named: "storytree library read", next: [] },
        { door: "command", verb: "storytree", outcome: "unknown", word: "questoin", named: "storytree question", next: [] },
      ]);
    } finally {
      await log.close();
    }
  });
});

test("1.18 storytree doors prints the front-door reading: every command walked from the door's own table and every tool the tool server serves, with calls, those with none at zero, and the misses", async () => {
  await inWorld(command, async (world) => {
    const session = { CLAUDE_CODE_SESSION_ID: "doors-1" };
    assert.equal((await world.run(["library", "search", "Mailer"], session)).code, 0);
    assert.equal((await world.run(["arc", "increment", "show", "x"], session)).code, 2);

    const read = await world.run(["doors", "--json"]);
    assert.equal(read.code, 0, read.stderr);
    const { short, long } = JSON.parse(read.stdout) as { short: Reading; long: Reading };
    assert.equal(Date.parse(short.until) - Date.parse(short.since), 7 * DAY_MS, "the short window is a week by default");
    assert.equal(Date.parse(long.until) - Date.parse(long.since), 28 * DAY_MS, "and the long one four");
    const of = (verb: string) => short.surfaces.find((surface) => surface.verb === verb);
    assert.deepEqual(of("storytree library search"), { door: "command", verb: "storytree library search", declared: true, calls: 1, sessions: 1 });
    assert.deepEqual(of("storytree noticeboard"), { door: "command", verb: "storytree noticeboard", declared: true, calls: 0, sessions: 0 }, "a family's bare command is declared");
    assert.deepEqual(of("check_setup"), { door: "tool", verb: "check_setup", declared: true, calls: 0, sessions: 0 });
    assert.deepEqual(short.misses, [{ door: "command", where: "storytree arc increment", word: "show", named: "storytree library read", count: 1 }]);

    const printed = await world.run(["doors", "--days", "2", "--trend", "14"]);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /\(2 days\), with the 14 days/);
    assert.match(printed.stdout, /storytree arc increment show\s+1\s+1\s+→ storytree library read/);
    assert.equal((await world.run(["doors", "--days", "0"])).code, 2, "a window of no days is refused");
  });
});

test("1.19 storytree lag prints Lag in real use's report over the lag readings kept in the storytree home", async () => {
  await inWorld(command, async (world) => {
    const empty = await world.run(["lag"]);
    assert.equal(empty.code, 0, empty.stderr);
    assert.match(empty.stdout, /No lag readings in the last 7 days in .*lag-readings\.jsonl/);

    const at = new Date().toISOString();
    const reading = (settled: number) => JSON.stringify({ at, version: "0.3.42", name: "open-island", response: 48, longFrames: 1, longestFrame: 212, settled, progress: false, size: 14 });
    writeFileSync(path.join(world.home, "lag-readings.jsonl"), `${reading(240)}\n${reading(1800)}\n`);
    const printed = await world.run(["lag"]);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /^open-island\s+2\s+48 \/ 48 \/ 48\s+212 \/ 212 \/ 212\s+240 \/ 1800 \/ 1800\s+100 \/ 50 \/ 1000\s+frame, settled$/m);
    assert.match(printed.stdout, /open-island has fewer than 10 readings/);
  });
});

test("1.21 · `storytree` mounts the families its story packages' manifests declare, in its bundle and run unbundled, each at the place it declares: CI health's health 18th, the arc surface's arc and question 2nd and 3rd, the librarian's adr 4th and friction and resteer 13th and 14th with adr's guesses, Processes' processes 24th, Session management's workspace among the rest, its bare name making a workspace, and its session and machine last", async () => {
  await inWorld(command, async (world) => {
    const listed = await world.run([]);
    assert.equal(listed.code, 0, listed.stderr);
    const names = [...listed.stdout.split("Families:")[1]!.split("next:")[0]!.matchAll(/^  ([\w-]+) /gm)].map((line) => line[1]);
    assert.deepEqual(names, FAMILIES.map((family) => family.name), "the bundle lists the families in the order run unbundled");
    for (const family of DECLARED) assert.equal(names.indexOf(family.name) + 1, family.order, `${family.name} at its place`);
    assert.deepEqual(names.slice(-2), ["session", "machine"]);

    const quit = await world.run(["app", "quit", "extra"]);
    assert.equal(quit.code, 2, quit.stderr);
    assert.match(quit.stderr, /^this takes no words\nusage: storytree app quit$/m, "the app's declared quit refuses a word it does not take");
    const signIn = await world.run(["sign-in", "--help"]);
    assert.match(signIn.stdout, /^  storytree sign-in$/m, signIn.stdout + signIn.stderr);
    const verbs = await world.run(["machine"]);
    assert.match(verbs.stdout, /^  storytree machine this$/m, verbs.stdout + verbs.stderr);
    const guessed = await world.run(["adr", "show", "ADR-0001"]);
    assert.match(guessed.stderr, /storytree adr pull <decision>/, guessed.stdout + guessed.stderr);
    const health = await world.run(["health"]);
    assert.match(health.stdout, /^  storytree health worklist$/m, health.stdout + health.stderr);
    const workspace = await world.run(["workspace", "--help"]);
    assert.match(workspace.stdout, /^storytree workspace: prepare or attach a workspace.*\n\n  storytree workspace <increment\|capability> --reason <text> \[--despite-open-pulls\]\n/, workspace.stdout + workspace.stderr);
    assert.match(workspace.stdout, /^  storytree workspace attach <increment\|capability> \[--folder <directory>\] \[--ref <commit> --name <name>\] --reason <text>$/m);
    const bare = await world.run(["workspace", "increment_none"]);
    assert.equal(bare.code, 2, bare.stderr);
    assert.match(bare.stderr, /^this needs --reason.*\nusage: storytree workspace <increment\|capability> --reason <text>/, "its bare name runs the declared verb");
  });
  assert.equal(import.meta.resolve("#parts/verbs"), new URL("./parts/verbs.ts", import.meta.url).href, "the command line's #parts/verbs is its composing module");
  assert.deepEqual(new Set(unbundled), new Set(DECLARED));
});
