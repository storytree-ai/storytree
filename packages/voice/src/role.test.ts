/**
 * Capability 4 · The box service and its confinement, contracts 4.3-4.5: the door's database role, granted exactly the
 * files in packages/voice/box, against the real command line and a throwaway library on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { removeTemp } from "@storytree/test-waits";

import { setUpProject } from "@storytree/app-setup/project";
import { connect as connectLibrary } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { placeTestServer, testServerUrl } from "@storytree/project-and-caller/testing/pg";
import pg from "pg";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = [process.execPath, "--import", pathToFileURL(path.join(root, "node_modules", "tsx", "dist", "loader.mjs")).href, path.join(root, "packages", "cli", "src", "bins", "storytree.ts")];
const box = (file: string) => readFileSync(new URL(`../box/${file}`, import.meta.url), "utf8");
const admin = () => process.env.STORYTREE_TEST_PG_ADMIN_URL || testServerUrl();

async function onDatabase<T>(url: string, database: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const at = new URL(url);
  at.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: at.href });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** psql's :'name' variables, as confine.sh passes them, written in as quoted literals. */
function withVariables(sql: string, variables: Record<string, string>): string {
  return sql.replace(/:'(\w+)'/g, (_, name: string) => `'${variables[name]!.replaceAll("'", "''")}'`);
}

function owner(home: string, folder: string, args: readonly string[]) {
  const ran = spawnSync(CLI[0]!, [...CLI.slice(1), ...args], { cwd: folder, env: { ...process.env, STORYTREE_HOME: home, STORYTREE_SESSION_ID: "the-owners-session" }, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
}

/**
 * A project with an open question, an owner wait and a closed increment; a role granted exactly the box's files under
 * throwaway names; and a storytree home for it holding only what confine.sh writes: the address, the password and a
 * machine id of its own, whose trunk is the project's folder by trunk-approval.sql.
 */
async function confinedDoor(t: { after: (fn: () => Promise<void>) => void }) {
  const url = testServerUrl();
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-voice-role-")));
  const run = randomBytes(4).toString("hex");
  const project = `t-${run}`;
  const [role, password, doorDatabase, machine, machineName] = [`storytree_voice_${run}`, randomBytes(16).toString("hex"), `storytree-voice-t-${run}`, randomUUID(), `voice-door-${run}`];
  const server = await connectLibrary({ url });
  let made = false;
  t.after(async () => {
    await server.close();
    await dropTestDatabases([`storytree_${project}`, doorDatabase]);
    if (made) {
      for (const database of ["storytree-activity", "storytree-trunks"]) {
        await onDatabase(admin(), database, async (client) => {
          if (database === "storytree-trunks") await client.query("DELETE FROM trunks WHERE machine = $1", [machine]);
          await client.query(`DROP OWNED BY ${role}`);
        });
      }
      await onDatabase(admin(), "postgres", (client) => client.query(`DROP ROLE IF EXISTS ${role}`));
    }
    await removeTemp(dir);
  });

  const folder = path.join(dir, "site");
  const ownerHome = path.join(dir, "owner");
  for (const each of [folder, ownerHome]) mkdirSync(each, { recursive: true });
  placeTestServer(path.join(ownerHome, "pgdata"));
  const library = await server.openProject(project);
  await setUpProject({ folder, project, storytree: server, storytreeHome: ownerHome, join: true });
  const arc = await library.createArc({ title: "Voice reaches storytree", intent: "Talk to it", endState: "It answers" });
  const waiting = await library.addIncrement({ arc: arc.id, title: "Install the door on the box", objective: "o", body: "b" });
  await library.addWaitFor(waiting.id, { releaser: "owner", note: "Say when the phone call works." });
  const question = await library.raiseQuestion({ arc: arc.id, title: "Sign in through WorkOS?", stakes: "s", statement: "s", context: "c", options: "a or b" });
  const done = await library.addIncrement({ arc: arc.id, title: "A tested read door", objective: "o", body: "b" });
  await library.closeIncrement(done.id, { disposition: "landed", pr: "#1721" });
  // The owner's first command sets the activity log's and the trunks' databases up, as on the box.
  owner(ownerHome, folder, ["arc", "list"]);

  await onDatabase(admin(), "postgres", async (client) => {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    made = true;
    await client.query(`CREATE DATABASE "${doorDatabase}" OWNER "${new URL(url).username}"`);
  });
  const named = (sql: string) => sql.replaceAll("storytree_storytree", `storytree_${project}`).replaceAll("storytree-voice", doorDatabase).replaceAll("storytree_voice", role);
  await onDatabase(url, `storytree_${project}`, (client) => client.query(named(box("library-grants.sql"))));
  await onDatabase(url, "storytree-activity", (client) => client.query(named(box("activity-grants.sql"))));
  await onDatabase(url, "storytree-trunks", (client) => client.query(named(box("trunks-grants.sql"))));
  await onDatabase(url, doorDatabase, (client) => client.query(named(box("door-database.sql"))));
  await onDatabase(admin(), "storytree-trunks", (client) => client.query(withVariables(box("trunk-approval.sql").replaceAll("'storytree'", `'${project}'`), { machine, machine_name: machineName, folder })));

  const home = path.join(dir, "voice");
  mkdirSync(home);
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ library: { location: "postgres", address: `postgres://${role}@127.0.0.1:${new URL(url).port}/postgres` } }));
  writeFileSync(path.join(home, "auth.json"), JSON.stringify({ postgres: { key: password } }), { mode: 0o600 });
  writeFileSync(path.join(home, "machine.json"), JSON.stringify({ id: machine, name: machineName }));
  const asRole = new URL(url);
  [asRole.username, asRole.password] = [role, password];
  return { home, folder, project, doorDatabase, asRole: asRole.href, arc, question, done };
}

// Fourteen cold command-line children: 18.6-56.4 s on Windows CI over 46 runs (2026-10-23/24), past half of the 60 s default.
test("4.3 the door's role, granted exactly its files, answers every read the door's tools make through the real command line, and is refused every write", { timeout: 120_000 }, async (t) => {
  const door = await confinedDoor(t);
  const asDoor = (args: readonly string[]) =>
    spawnSync(CLI[0]!, [...CLI.slice(1), ...args], { cwd: door.folder, env: { ...process.env, STORYTREE_HOME: door.home, STORYTREE_SESSION_ID: "voice-2026-10-24", CLAUDE_CODE_SESSION_ID: "", CODEX_THREAD_ID: "" }, encoding: "utf8" });

  // Every command packages/voice/src/tools.ts runs, and the counts and title lookup the speech layer adds.
  const reads: [string[], RegExp][] = [
    [["arc", "waits"], /Say when the phone call works\./],
    [["question", "list"], new RegExp(door.question.id)],
    [["arc", "recent", "--since", "2000-01-01"], /A tested read door/],
    [["library", "read", door.arc.id, door.done.id], /A tested read door/],
    [["question", "show", door.question.id], /Sign in through WorkOS\?/],
    [["library", "list", "decision", "--where", "number=1"], /No decision records match/],
    [["library", "history", door.done.id], /created/],
    [["arc", "show", door.arc.id], /Install the door on the box/],
    [["library", "count"], /question\s+1/],
    [["library", "changes"], /A tested read door/],
    [["library", "find", "door"], /Install the door on the box/],
    [["library", "search", "--limit", "5", "--", "door"], /door/],
  ];
  for (const [args, expected] of reads) {
    const ran = asDoor(args);
    assert.equal(ran.status, 0, `${args.join(" ")}: ${ran.stderr}`);
    assert.match(ran.stdout, expected, args.join(" "));
  }

  const refused = /permission denied/;
  await onDatabase(door.asRole, `storytree_${door.project}`, async (client) => {
    await assert.rejects(client.query("INSERT INTO record (id, type, version, fields) VALUES ('arc_000000000000', 'arc', 1, '{}')"), refused);
    await assert.rejects(client.query("UPDATE record SET fields = '{}'"), refused);
    await assert.rejects(client.query("DELETE FROM record_event"), refused);
    await assert.rejects(client.query("UPDATE library_meta SET value = '0'"), refused);
    await assert.rejects(client.query("SELECT record_id FROM feedback_screenshot"), refused);
    await assert.rejects(client.query("CREATE TABLE smuggled (x int)"), refused);
  });
  await onDatabase(door.asRole, "storytree-activity", async (client) => {
    await assert.rejects(client.query("INSERT INTO activity (project, session, harness, source, kind) VALUES ('p', 's', 'h', 's', 'claimed')"), refused);
    for (const table of ["transcript_records", "transcript_readings", "session_beats"]) await assert.rejects(client.query(`SELECT 1 FROM ${table}`), refused);
  });
  await onDatabase(door.asRole, "storytree-trunks", async (client) => {
    await assert.rejects(client.query("UPDATE trunks SET folder = '/elsewhere'"), refused);
    await assert.rejects(client.query("INSERT INTO imports (project, machine, machine_name, folder, approved_by) VALUES ('p', 'm', 'n', '/elsewhere', 'voice')"), refused);
  });
  // The command line's own writes are refused too, so a voice child records nothing in the plan.
  const write = asDoor(["arc", "new", "--title", "Written by voice?", "--intent", "i", "--end-state", "e"]);
  assert.notEqual(write.status, 0, write.stdout);
  assert.match(write.stderr, refused);
});

test("4.4 the door's role adds to the search cache but never changes or removes what is in it", async (t) => {
  const door = await confinedDoor(t);
  await onDatabase(door.asRole, `storytree_${door.project}`, async (client) => {
    const add = "INSERT INTO embedding (model, key, vector) VALUES ('model-a', $1, '\\x00') ON CONFLICT (model, key) DO NOTHING";
    await client.query(add, ["key-1"]);
    await client.query(add, ["key-1"]);
    assert.deepEqual((await client.query("SELECT key FROM embedding WHERE model = 'model-a'")).rows, [{ key: "key-1" }]);
    await assert.rejects(client.query("UPDATE embedding SET vector = '\\x01'"), /permission denied/);
    await assert.rejects(client.query("DELETE FROM embedding"), /permission denied/);
  });
});

test("4.5 the door's role turns voice writes off and cannot turn them back on; the box's own account clears the lock", async (t) => {
  const door = await confinedDoor(t);
  const locked = (client: pg.Client) => client.query<{ n: number }>("SELECT count(*)::int AS n FROM voice_lock").then(({ rows }) => rows[0]!.n > 0);
  await onDatabase(door.asRole, door.doorDatabase, async (client) => {
    assert.equal(await locked(client), false);
    await client.query("INSERT INTO voice_lock (reason) VALUES ('lock_voice: the owner said stop')");
    assert.equal(await locked(client), true);
    await assert.rejects(client.query("DELETE FROM voice_lock"), /permission denied/);
    await assert.rejects(client.query("UPDATE voice_lock SET locked_at = now() - interval '1 year'"), /permission denied/);
    await assert.rejects(client.query("TRUNCATE voice_lock"), /permission denied/);
    assert.equal(await locked(client), true);
  });
  await onDatabase(admin(), door.doorDatabase, (client) => client.query("DELETE FROM voice_lock"));
  await onDatabase(door.asRole, door.doorDatabase, async (client) => assert.equal(await locked(client), false));
});
