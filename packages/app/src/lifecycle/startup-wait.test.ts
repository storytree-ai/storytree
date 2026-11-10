/**
 * Capability 1 · Lifecycle, contracts 1.46 and 1.47: a library that cannot be reached yet, because the computer's network
 * is not up when the app starts, is tried again instead of leaving the app on its error page until it is reopened.
 * The clock and the waits are handed in, so two minutes of trying run at once.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ConnectionError } from "@storytree/library";

import { keepTrying, keepTryingBehind, openAtStartup, openPatiently, type LibraryQuery } from "./startup-wait.js";

/** A key command whose ssh could not reach the box, as @storytree/keys throws it, inside the app's own refusal. */
function sshDown(): Error {
  const key = Object.assign(new Error("The command saved for key postgres failed (exit 255)"), { name: "KeyCommandError", unreachable: true });
  return new Error(`The library is set to the Postgres at postgres://box/storytree, and it could not be reached: ${key.message}`, { cause: key });
}

/** A clock that moves only when the code under test waits. */
function clock() {
  let at = 0;
  const waits: number[] = [];
  return { now: () => at, sleep: async (ms: number) => { waits.push(ms); at += ms; }, waits };
}

test("1.46 at startup an unreachable library is tried again, with growing waits, saying it waits and why, for about two minutes; any other failure stands at once", async () => {
  const time = clock();
  const said: string[] = [];
  let tries = 0;
  const opened = await openPatiently({
    open: async () => { tries += 1; if (tries < 4) throw tries % 2 === 0 ? sshDown() : new ConnectionError("unreachable", "the box did not answer"); return "library"; },
    waiting: (reason) => { said.push(reason); },
    ...time,
  });
  assert.equal(opened, "library");
  assert.equal(tries, 4);
  assert.deepEqual(time.waits, [1_000, 2_000, 4_000]);
  assert.equal(said.length, 3);
  assert.match(said[0]!, /cannot be reached yet.*the box did not answer/);
  assert.match(said[1]!, /exit 255/);

  const never = clock();
  let attempts = 0;
  await assert.rejects(openPatiently({ open: async () => { attempts += 1; throw sshDown(); }, waiting: () => {}, ...never }), /could not be reached/);
  assert.ok(never.now() <= 120_000 && never.now() >= 100_000, `gave up after ${never.now()} ms`);
  assert.ok(attempts > 5);

  const refused = clock();
  attempts = 0;
  await assert.rejects(
    openPatiently({ open: async () => { attempts += 1; throw new ConnectionError("password", "the box refused the password"); }, waiting: () => assert.fail("never waits"), ...refused }),
    /refused the password/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(refused.waits, []);
});

test("1.47 after the startup wait the app keeps trying an unreachable library and hands it on once it answers; a failure that will not fix itself ends the trying and is said", async () => {
  const time = clock();
  let tries = 0;
  const opened: string[] = [];
  await keepTrying({
    open: async () => { tries += 1; if (tries < 3) throw sshDown(); return "library"; },
    opened: (library) => { opened.push(library); },
    failed: () => assert.fail("it answered"),
    stopped: () => false,
    ...time,
  });
  assert.deepEqual(opened, ["library"]);
  assert.deepEqual(time.waits, [30_000, 30_000, 30_000]);

  const failed: unknown[] = [];
  tries = 0;
  await keepTrying({
    open: async () => { tries += 1; throw tries === 1 ? sshDown() : new ConnectionError("password", "the box refused the password"); },
    opened: () => assert.fail("never answers"),
    failed: (error) => { failed.push(error); },
    stopped: () => false,
    ...clock(),
  });
  assert.equal(tries, 2);
  assert.match(String(failed[0]), /refused the password/);

  let quitting = false;
  tries = 0;
  await keepTrying({
    open: async () => { tries += 1; quitting = true; throw sshDown(); },
    opened: () => assert.fail("never answers"),
    failed: () => assert.fail("quitting is not a failure"),
    stopped: () => quitting,
    ...clock(),
  });
  assert.equal(tries, 1, "a quitting app stops trying");
});

test("1.46 · the app's start shows the page waiting while it waits, then the project's library, or the problem, saying it keeps trying only when the library could not be reached", async () => {
  const shown: LibraryQuery[] = [];
  const logged: string[] = [];
  let tries = 0;
  const opened = await openAtStartup({
    open: async () => { tries += 1; if (tries < 2) throw sshDown(); return "library"; },
    show: (query) => { shown.push(query); },
    log: (line) => { logged.push(line); },
    ...clock(),
  });
  assert.deepEqual(opened, { opened: "library" });
  assert.equal(shown.length, 1);
  assert.match(shown[0]!.waiting ?? "", /cannot be reached yet.*exit 255/);
  assert.deepEqual(logged, [shown[0]!.waiting]);

  const gaveUp = await openAtStartup({ open: async () => { throw sshDown(); }, show: () => {}, log: () => {}, ...clock() });
  assert.ok("problem" in gaveUp && gaveUp.unreachable);
  assert.match(gaveUp.problem, /^The app's library could not be opened: .*exit 255.* The app keeps trying, and opens your project once the library answers\.$/);

  const refused = await openAtStartup({ open: async () => { throw new ConnectionError("password", "the box refused the password"); }, show: () => assert.fail("never waits"), log: () => {}, ...clock() });
  assert.deepEqual(refused, { problem: "The app's library could not be opened: the box refused the password", unreachable: false });
});

test("1.47 · behind the error page, a library that answers is handed on and the page shown with no problem; one that refuses for good shows why", async () => {
  const shown: LibraryQuery[] = [];
  const opened: string[] = [];
  let tries = 0;
  await keepTryingBehind({
    open: async () => { tries += 1; if (tries < 2) throw sshDown(); return "library"; },
    opened: (library) => { opened.push(library); assert.deepEqual(shown, [], "handed on before the page reads it"); },
    show: (query) => { shown.push(query); },
    log: () => {},
    stopped: () => false,
    ...clock(),
  });
  assert.deepEqual(opened, ["library"]);
  assert.deepEqual(shown, [{}]);

  shown.length = 0;
  await keepTryingBehind({
    open: async () => { throw new ConnectionError("password", "the box refused the password"); },
    opened: () => assert.fail("never answers"),
    show: (query) => { shown.push(query); },
    log: () => {},
    stopped: () => false,
    ...clock(),
  });
  assert.deepEqual(shown, [{ problem: "The app's library could not be opened: the box refused the password" }]);
});
