/**
 * Capability 1 · Front door: one test per contract 1.1-1.5, 1.15, 1.17-1.19, 1.21, 1.33, 1.35, 1.36 and 1.45 in the command line story, each running the
 * real, built `storytree` command in a throwaway folder and storytree home.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import pg from "pg";
import { openActivityLog } from "@storytree/session-management";
import { waitUntil } from "@storytree/test-waits";
import { RELEASE_FAMILIES } from "@storytree/app/updates/verbs";
import { APP_FAMILIES } from "@storytree/app/lifecycle/verbs";
import { SETTINGS_FAMILIES } from "@storytree/app/surfaces/verbs";
import { HEALTH_FAMILIES } from "@storytree/ci-health/verbs";
import { IDENTITY_FAMILIES } from "@storytree/project-and-caller/identity/verbs";
import { CHECK_FAMILIES } from "@storytree/guardrails/verbs";
import { QUALITY_FAMILIES } from "@storytree/quality-assurance/verbs";
import { TEST_RUN_FAMILIES } from "@storytree/quality-assurance/test-run/verbs";
import { JOURNEY_FAMILIES } from "@storytree/app-setup/journey-events/verbs";
import { EXPERIMENT_FAMILIES } from "@storytree/experiments/verbs";
import { armChecks } from "@storytree/experiments/arm-checks";
import { FEEDBACK_FAMILIES } from "@storytree/surface-feedback/verbs";
import { LAG_FAMILIES } from "@storytree/app/lag/verbs";
import { SESSION_FAMILIES } from "@storytree/session-management/verbs";
import { WORKSPACE_FAMILIES } from "@storytree/session-management/workspace-verbs";
import { FRICTION_FAMILIES } from "@storytree/session-management/friction/verbs";
import { SCHEDULE_FAMILIES } from "@storytree/session-management/schedules/verbs";
import { SETUP_FAMILIES } from "@storytree/app-setup/verbs";
import { PROCESSES_FAMILIES } from "@storytree/session-management/processes/verbs";
import { SERVICES_FAMILIES } from "@storytree/service-host/verbs";
import { ARC_FAMILIES } from "@storytree/arc-surface/verbs";
import { LIBRARY_FAMILIES } from "@storytree/library/commands";
import { MAP_FAMILIES } from "@storytree/map/verbs";
import { PLUGIN_FAMILIES } from "@storytree/plugin-loader/verbs";
import type { Reading } from "./usage/reading.js";

import type { Family } from "./door.js";
import { familiesIn, inOrder } from "./families/index.js";
import unbundled from "./parts/verbs.js";
import armCheckParts from "./parts/arm-checks.js";
import { BuiltCommand, inWorld, storytree, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();
const DECLARED = [...LIBRARY_FAMILIES, ...APP_FAMILIES, ...SETTINGS_FAMILIES, ...RELEASE_FAMILIES, ...IDENTITY_FAMILIES, ...CHECK_FAMILIES, ...QUALITY_FAMILIES, ...TEST_RUN_FAMILIES, ...HEALTH_FAMILIES, ...ARC_FAMILIES, ...FRICTION_FAMILIES, ...SETUP_FAMILIES, ...PROCESSES_FAMILIES, ...SERVICES_FAMILIES, ...SCHEDULE_FAMILIES, ...SESSION_FAMILIES, ...WORKSPACE_FAMILIES, ...LAG_FAMILIES, ...JOURNEY_FAMILIES, ...EXPERIMENT_FAMILIES, ...MAP_FAMILIES, ...FEEDBACK_FAMILIES, ...PLUGIN_FAMILIES];
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

test("1.6 `--help` after a command prints its usage and summary, and runs nothing; an inner family's help heads with its full path", async () => {
  await inWorld(command, async (world) => {
    // In a folder that is no project, and without the --arc it needs: run, it would refuse.
    const ran = await storytree(command.script, ["question", "new", "--help"], { cwd: world.elsewhere, home: world.home });

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /storytree question new --arc <arc>/);
    assert.match(ran.stdout, /raise a question for the owner/);

    const inner = await storytree(command.script, ["experiment", "arm", "--help"], { cwd: world.elsewhere, home: world.home });
    assert.equal(inner.code, 0, inner.stderr);
    assert.match(inner.stdout, /^storytree experiment arm: /);
  });
});

test("1.7 a command it does not have answers with the real command for that job, or the nearest one", async () => {
  await inWorld(command, async (world) => {
    const asked: [readonly string[], RegExp][] = [
      [["library", "show", "x"], /storytree library read <id>/],
      [["question", "read", "x"], /storytree question show <id>/],
      [["arc", "increment", "get", "x"], /storytree library read <id>/],
      [["arc", "increment", "ready", "x"], /ADR-0909 retired[^\n]*claiming a proposal starts it[\s\S]*storytree workspace <increment\b/],
      [["claim", "x"], /storytree workspace <increment\b/],
      [["board"], /storytree noticeboard/],
      // `plan` reads the plan; its next word, when it names what to plan, points to the plan_* tools' twins.
      [["plan", "contract", "--help"], /: run storytree library new contract --capability <capability>/],
      [["plan", "story"], /: run storytree library new <story\|capability\|contract>/],
      [["plan", "arc"], /: run storytree arc new --title <t>/],
      [["plan", "increment"], /: run storytree arc increment new --arc <arc>/],
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
      await waitUntil(async () => {
        const { rows } = await elsewhere.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted", [pid]);
        return rows.length > 0;
      }, 20_000, "the unrelated writer to queue");
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      running = world.run(["library", "new", "definition", "--term", "Mailer", "--meaning", "Sends the mail."]);
      // Only this world's command can queue behind this connection's project write lock.
      // A waiter elsewhere on the shared test server must not release it early.
      await waitUntil(async () => {
        const { rows } = await other.query(`SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND pg_backend_pid() = ANY(pg_blocking_pids(pid))`);
        return rows.length > 0;
      }, 20_000, "the command to queue behind this project's write lock");
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

test("1.17 every answer is recorded on the calling session as a door-answered line: the command, how it went, and the next steps offered as commands; an unknown word with the command its refusal named, which a guess with no hand-picked command leaves out", async () => {
  await inWorld(command, async (world) => {
    await (await world.library()).defineTerm({ term: "Mailer", meaning: "Sends the sign-up email" });
    const session = { CLAUDE_CODE_SESSION_ID: "door-1" };

    const searched = await world.run(["library", "search", "Mailer"], session);
    const guessed = await world.run(["arc", "increment", "get", "x"], session);
    const misspelt = await world.run(["questoin", "list"], session);
    const planned = await world.run(["plan", "story"], session);

    assert.equal(searched.code, 0, searched.stderr);
    assert.equal(guessed.code, 2, guessed.stderr);
    assert.equal(misspelt.code, 2, misspelt.stderr);
    assert.equal(planned.code, 2, planned.stderr);
    assert.match(planned.stderr, /run storytree library new <story\|capability\|contract>/);
    const log = await openActivityLog(testServerUrl());
    try {
      const lines = await log.lines(world.project, { sessions: ["door-1"], kinds: ["door-answered"] });
      const said = lines.map((line) => {
        const { door, verb, outcome, word, named, next } = line as Extract<typeof line, { kind: "door-answered" }>;
        return { door, verb, outcome, word, named, next };
      });
      assert.deepEqual(said, [
        { door: "command", verb: "storytree library search", outcome: "answered", word: undefined, named: undefined, next: ["storytree library read"] },
        { door: "command", verb: "storytree arc increment", outcome: "unknown", word: "get", named: "storytree library read", next: ["storytree library read"] },
        { door: "command", verb: "storytree", outcome: "unknown", word: "questoin", named: undefined, next: ["storytree question"] },
        { door: "command", verb: "storytree plan", outcome: "unknown", word: "story", named: "storytree library new", next: ["storytree library new"] },
      ]);
    } finally {
      await log.close();
    }
  });
});

test("1.33 a refused word offers, as next steps, the commands sessions ran after it was refused there before; a guess names none of them as the one to run", async () => {
  await inWorld(command, async (world) => {
    await (await world.library()).defineTerm({ term: "Mailer", meaning: "Sends the sign-up email" });
    const first = { CLAUDE_CODE_SESSION_ID: "repoint-1" };

    const unlearned = await world.run(["library", "zzfind", "Mailer"], first);
    await world.run(["library", "search", "Mailer"], first);
    const learned = await world.run(["library", "zzfind", "Mailer"], { CLAUDE_CODE_SESSION_ID: "repoint-2" });

    assert.equal(unlearned.code, 2, unlearned.stderr);
    assert.doesNotMatch(unlearned.stderr, /storytree library search/);
    assert.equal(learned.code, 2, learned.stderr);
    assert.match(learned.stderr, /next:\n[\s\S]*- storytree library search <words…>/);
    assert.doesNotMatch(learned.stderr, /run storytree/);
  });
});

test("1.35 a word pointed in its place runs the pointed command with the words after it, says it was pointed, and records an answered line carrying the word; a fallen pointer refuses again", async () => {
  await inWorld(command, async (world) => {
    await (await world.library()).defineTerm({ term: "Mailer", meaning: "Sends the sign-up email" });
    const session = { CLAUDE_CODE_SESSION_ID: "pointed-1" };
    const log = await openActivityLog(testServerUrl());
    try {
      const point = (to?: string) => log.append(world.project, { session: "drain-1", source: "tool", kind: "door-pointer", where: "storytree library", word: "zzfind",
        ...(to === undefined ? {} : { to }), others: [], evidence: "the doors learner's reading" });

      await point("storytree library search");
      const pointed = await world.run(["library", "zzfind", "Mailer"], session);
      assert.equal(pointed.code, 0, pointed.stderr);
      assert.match(pointed.stdout, /"storytree library zzfind" is pointed to storytree library search/);
      assert.match(pointed.stdout, /Mailer/);
      const lines = await log.lines(world.project, { sessions: ["pointed-1"], kinds: ["door-answered"] });
      assert.deepEqual(lines.map((line) => {
        const { verb, outcome, word, pointedFrom } = line as Extract<typeof line, { kind: "door-answered" }>;
        return { verb, outcome, word, pointedFrom };
      }), [{ verb: "storytree library search", outcome: "answered", word: "zzfind", pointedFrom: "storytree library" }]);

      await point();
      const fallen = await world.run(["library", "zzfind", "Mailer"], session);
      assert.equal(fallen.code, 2, fallen.stderr);
      assert.match(fallen.stderr, /storytree library has no "zzfind"/);
    } finally {
      await log.close();
    }
  });
});

test("1.36 a word agents guess for a job a command already does runs that command with the words after it, and its answer says so", async () => {
  await inWorld(command, async (world) => {
    const waited = await world.run(["wait", "--help"]);
    const shown = await world.run(["adr", "show", "--help"]);

    assert.equal(waited.code, 0, waited.stderr);
    assert.match(waited.stdout, /storytree wait is storytree arc increment wait\n/);
    assert.match(waited.stdout, /storytree arc increment wait <increment>/);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /storytree adr show is storytree adr pull\n/);
    assert.match(shown.stdout, /storytree adr pull <decision>/);
  });
});

test("1.32 a command the lane's experiment arm denies does nothing else: it exits 1 naming the experiment and arm, and is recorded as a door-answered line, denied-by-arm, carrying both", async () => {
  await inWorld(command, async (world) => {
    const settings = path.join(world.home, "settings.json");
    writeFileSync(settings, JSON.stringify({ ...readSettingsFile(settings), experiment: { name: "twin-build", arm: "map-reads-off", denies: { tools: ["focus"], commands: ["storytree map"] } } }));
    const session = { CLAUDE_CODE_SESSION_ID: "arm-1" };

    const denied = await world.run(["map", "--select", "story:Experiments"], session);
    const allowed = await world.run(["library", "search", "Mailer"], session);

    assert.equal(denied.code, 1, denied.stderr);
    assert.equal(denied.stdout, "", "a denied command answers nothing");
    assert.match(denied.stderr, /twin-build.*map-reads-off.*storytree map/);
    assert.equal(allowed.code, 0, allowed.stderr);
    const log = await openActivityLog(testServerUrl());
    try {
      const lines = await log.lines(world.project, { sessions: ["arm-1"], kinds: ["door-answered"] });
      assert.deepEqual(lines.map((line) => {
        const { verb, outcome, experiment, arm } = line as Extract<typeof line, { kind: "door-answered" }>;
        return { verb, outcome, experiment, arm };
      }), [
        { verb: "storytree map", outcome: "denied-by-arm", experiment: "twin-build", arm: "map-reads-off" },
        { verb: "storytree library search", outcome: "answered", experiment: "twin-build", arm: "map-reads-off" },
      ]);
    } finally {
      await log.close();
    }
  });
});

test("1.42 the command line asks the arm checks its parts contribute: it mounts experiments' from its manifest, and with experiments switched off a command the home's arm denies runs as usual", async () => {
  assert.deepEqual(armCheckParts.parts, armChecks, "the command line mounts the arm checks its story packages' manifests name");
  assert.deepEqual(armCheckParts.owners, ["experiments"]);
  await inWorld(command, async (world) => {
    const settings = path.join(world.home, "settings.json");
    writeFileSync(settings, JSON.stringify({ ...readSettingsFile(settings), "parts-off": ["experiments"], experiment: { name: "twin-build", arm: "search-off", denies: { tools: [], commands: ["storytree library search"] } } }));

    const ran = await world.run(["library", "search", "Mailer"], { CLAUDE_CODE_SESSION_ID: "arm-off-1" });

    assert.equal(ran.code, 0, ran.stderr);
    assert.doesNotMatch(ran.stderr, /twin-build/);
  });
});

/** A settings file's object, empty when there is none. */
function readSettingsFile(file: string): Record<string, unknown> {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> : {};
}

test("1.18 storytree doors prints the front-door reading: every command walked from the door's own table and every tool the tool server serves, with its consumers and calls, those with none at zero, and the misses", async () => {
  await inWorld(command, async (world) => {
    const session = { CLAUDE_CODE_SESSION_ID: "doors-1" };
    assert.equal((await world.run(["library", "search", "Mailer"], session)).code, 0);
    assert.equal((await world.run(["arc", "increment", "get", "x"], session)).code, 2);

    const read = await world.run(["doors", "--json"]);
    assert.equal(read.code, 0, read.stderr);
    const { short, long } = JSON.parse(read.stdout) as { short: Reading; long: Reading };
    assert.equal(Date.parse(short.until) - Date.parse(short.since), 7 * DAY_MS, "the short window is a week by default");
    assert.equal(Date.parse(long.until) - Date.parse(long.since), 28 * DAY_MS, "and the long one four");
    const of = (verb: string) => short.surfaces.find((surface) => surface.verb === verb);
    const both = ["agent", "user"];
    assert.deepEqual(of("storytree library search"), { door: "command", verb: "storytree library search", declared: true, consumers: both, judged: false, calls: 1, sessions: 1 });
    assert.deepEqual(of("storytree noticeboard"), { door: "command", verb: "storytree noticeboard", declared: true, consumers: both, judged: false, calls: 0, sessions: 0 }, "a family's bare command is declared");
    assert.deepEqual(of("check_setup"), { door: "tool", verb: "check_setup", declared: true, consumers: both, judged: false, calls: 0, sessions: 0 });
    // Each verb's consumers come from where its story declares it (ADR-1045 D1), on both doors.
    assert.deepEqual(of("storytree settings show")?.consumers, ["user"], "a settings verb is a person's");
    assert.deepEqual(of("storytree auth list")?.consumers, ["user"], "a kept family's verb declares its own");
    assert.deepEqual(of("storytree quality brief")?.consumers, ["agent"], "a dev-loop verb is an agent's");
    assert.deepEqual(of("storytree session close-out")?.consumers, ["agent"], "an agent-only verb is an agent's");
    assert.deepEqual(of("quality_brief")?.consumers, ["agent"], "a tool mounted from a declared verb carries its consumers");
    assert.deepEqual(of("make_workspace")?.consumers, ["agent"], "a tool the server defines declares its own");
    assert.deepEqual(of("set_up_project")?.consumers, ["user"], "setting up a project is a person's");
    assert.deepEqual(short.misses, [{ door: "command", where: "storytree arc increment", word: "get", named: "storytree library read", count: 1 }]);

    const printed = await world.run(["doors", "--days", "2", "--trend", "14"]);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /\(2 days\), with the 14 days/);
    assert.match(printed.stdout, /storytree arc increment get\s+1\s+1\s+→ storytree library read/);
    assert.match(printed.stdout, /storytree quality brief\s+agent\s+0\s+0\s+0\s+0\s+unused/, "an agent's verb with no call is unused");
    assert.match(printed.stdout, /storytree settings show\s+user\s+0\s+0\s+0\s+0\s+not judged/, "a person's is not judged");
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

test("1.21 · `storytree` mounts the families its story packages' manifests declare, in its bundle and run unbundled, each at the place it declares: the library's library 1st, CI health's health 18th, the arc surface's arc and question 2nd and 3rd, the library core's adr 4th with its guesses, Session management's friction and resteer 13th and 14th, Surface feedback's feedback after them, the app setup's doctor 8th and setup, project and import 20th to 22nd, Processes' processes 24th, the Experiments story's experiment 27th, Code map's map and affected 16th and 17th, Session management's workspace among the rest, its bare name making a workspace, each listed in ascending order of its place, so a family at an unused or fractional place moves no other", async () => {
  await inWorld(command, async (world) => {
    const listed = await world.run([]);
    assert.equal(listed.code, 0, listed.stderr);
    const names = [...listed.stdout.split("Families:")[1]!.split("next:")[0]!.matchAll(/^  ([\w-]+) /gm)].map((line) => line[1]);
    assert.deepEqual(names, familiesIn(world.home).map((family) => family.name), "the bundle lists the families in the order run unbundled under the same factory");
    const declaredNames = new Set(DECLARED.map((family) => family.name));
    assert.deepEqual(names.filter((name) => declaredNames.has(name)), [...DECLARED].sort((a, b) => a.order - b.order).map((family) => family.name), "the declared families in ascending order of their places");
    const at = (name: string, order: number) => ({ order, family: { name } as Family });
    assert.deepEqual(inOrder([at("library", 1), at("doors", 6), at("arc", 2), at("new", 6.5), at("late", 40)]).map((family) => family.name), ["library", "arc", "doors", "new", "late"], "a family at an unused or fractional place moves no other");

    const quit = await world.run(["app", "quit", "extra"]);
    assert.equal(quit.code, 2, quit.stderr);
    assert.match(quit.stderr, /^this takes no words\nusage: storytree app quit$/m, "the app's declared quit refuses a word it does not take");
    const signIn = await world.run(["sign-in", "--help"]);
    assert.match(signIn.stdout, /^  storytree sign-in$/m, signIn.stdout + signIn.stderr);
    const verbs = await world.run(["machine"]);
    assert.match(verbs.stdout, /^  storytree machine this$/m, verbs.stdout + verbs.stderr);
    const guessed = await world.run(["adr", "read", "ADR-0001"]);
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
  assert.deepEqual(new Set(unbundled.parts), new Set(DECLARED));
});

test("1.43 · a title holding a terminal escape prints without its escape byte, in an answer and in a refusal", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    await library.defineTerm({ term: "Mailer\u001b]52;c;aGk=\u0007 sender", meaning: "The domain mail goes out from." });

    const ran = await world.run(["library", "search", "mailer"]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /Mailer�\]52;c;aGk=� sender/);
    assert.doesNotMatch(ran.stdout, /\u001b|\u0007/);

    const refused = await world.run(["library", "read", "definition_\u001b[2Jnone"]);
    assert.notEqual(refused.code, 0);
    assert.doesNotMatch(refused.stderr, /\u001b/);
  });
});

test("1.45 a knowledge note a command writes from a session's shell carries what that session had read from outside in its history; from a shell whose session read none, no mark", async () => {
  await inWorld(command, async (world) => {
    const log = await openActivityLog(testServerUrl());
    try {
      await log.append(world.project, { session: "reader-1", harness: "claude-code", source: "hook", kind: "outside-text-read", what: "gh pr view 12" });
    } finally {
      await log.close();
    }
    const library = await world.library();
    const principle = ["library", "new", "principle", "--description", "As the pull request asked.", "--statement", "S.", "--why", "W.", "--howToApply", "H."];
    for (const [session, title, mark] of [["reader-1", "Trust the pull request", [["gh pr view 12"]]], ["quiet-1", "Written with nothing read", [undefined]]] as const) {
      const ran = await world.run([...principle, "--title", title], { CLAUDE_CODE_SESSION_ID: session });
      assert.equal(ran.code, 0, ran.stderr);
      const [written] = (await library.list("principle")).filter((record) => record.fields.title === title);
      assert.deepEqual((await library.history({ id: written!.id })).map((entry) => entry.outsideRead), mark, session);
    }
  });
});
