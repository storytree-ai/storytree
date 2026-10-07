/**
 * Capability 1 · Front door: one test per contract 1.1-1.5 and 1.15 in the command line story, each running the
 * real, built `storytree` command in a throwaway folder and storytree home.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import pg from "pg";

import { BuiltCommand, bareNode, inWorld, storytree, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

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
    const floor = await bareNode();
    const ran = await storytree(command.script, ["library", "search", "mailer"], { cwd: world.folder, home: world.stoppedHome });

    assert.notEqual(ran.code, 0);
    assert.match(ran.stderr, /storytree isn't running/);
    // Node's own start is the machine's, not the command's: a second on top of a bare Node's.
    assert.ok(ran.ms - floor < 1_000, `took ${Math.round(ran.ms)} ms, a bare Node ${Math.round(floor)} ms`);
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
      [["question", "show", "x"], /storytree library read <id>/],
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

test("1.15 a command kept waiting on the library, here for another session's write, says so on stderr and goes on when it can", async () => {
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
      assert.match(ran.stderr, /another session is writing to this project; waiting up to 30 s/);
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
