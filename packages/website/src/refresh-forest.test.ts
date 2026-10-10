import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openActivityLog } from "@storytree/agent-link";
import { setUpProject } from "@storytree/app-setup/project";
import { connect } from "@storytree/library";
import type { TourSnapshot } from "./forest-data.js";
import { placeTestServer } from "./testing/pg.js";

test("3.1, 3.2, 3.3 · refresh command saves the selected public recording, only from an approved checkout, and keeps it when the next refresh is refused", async t => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  const data = process.env.STORYTREE_TEST_PG_DATA;
  assert.ok(url && data, "Run through pnpm test for an isolated test Postgres");
  const directory = await mkdtemp(path.join(tmpdir(), "website-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const home = path.join(directory, "home");
  const src = path.join(directory, "packages", "example", "src");
  await mkdir(home);
  await mkdir(src, { recursive: true });
  placeTestServer(path.join(home, "pgdata"));
  const project = `t-${randomBytes(4).toString("hex")}`;
  await writeFile(path.join(directory, ".storytree.json"), JSON.stringify({ project }));
  await writeFile(path.join(src, "answer.ts"), "export const answer = 42;\n");
  await writeFile(path.join(src, "answer.test.ts"), 'import { answer } from "./answer.js";\ntest("1.1 · answer", () => assert.equal(answer, 42));\n');
  const server = await connect({ url });
  let created = false;
  let activity: Awaited<ReturnType<typeof openActivityLog>> | undefined;
  t.after(async () => {
    try {
      await activity?.close();
      if (created) await server.dropProject(project);
    } finally { await server.close(); }
  });
  const library = await server.openProject(project);
  created = true;
  activity = await openActivityLog(server);
  const story = await library.addStory({ title: "Example", description: "See /home/synthetic/code and projects/private-cloud-example" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Answer", proposed: false });
  await library.addContract({ capability: capability.id, title: "1.1 · Answer is available" });
  const decision = await library.recordDecision({ title: "Keep the answer", text: "Use the answer", status: "accepted", frontCoverOf: story.id });
  const arc = await library.createArc({ title: "Ship the answer", intent: "Answer", endState: "Answered" });
  const from = "2026-10-02T00:00:00.000Z", to = "2026-10-02T01:00:00.000Z";
  const line = { session: "synthetic-session", source: "hook" as const, kind: "session-started" as const,
    folder: "/home/synthetic/code", machine: "synthetic-private-host", transcript: "synthetic-private-log", branch: "synthetic-private-branch" };
  const included = await activity.append(project, line, { at: from });
  await activity.append(project, { ...line, kind: "session-ended" }, { at: to });
  await activity.append(project, line, { at: "2026-10-01T23:59:59.999Z" });
  const output = path.join(directory, "saved.json");
  const command = fileURLToPath(new URL("./refresh-forest.ts", import.meta.url));
  const run = (start = from, end = to) => promisify(execFile)(process.execPath,
    ["--import", import.meta.resolve("tsx"), command, "--from", start, "--to", end, "--output", output], {
      cwd: directory, timeout: 20_000,
      env: { ...process.env, STORYTREE_HOME: home, STORYTREE_EMBEDDER: "off", CLAUDE_CODE_SESSION_ID: "", CODEX_THREAD_ID: "" },
    });
  // A marker alone names no project: the checkout is refused until it is approved on purpose (ADR-0942 D1).
  await assert.rejects(run(), /not approved as/);
  await setUpProject({ folder: directory, project, storytree: server, storytreeHome: home, join: true });
  const started = Date.now();
  const ran = await run();
  assert.match(ran.stdout, /Saved scrubbed tour records/);
  const saved = await readFile(output, "utf8");
  const snapshot = JSON.parse(saved) as TourSnapshot;
  assert.equal(snapshot.project, project);
  assert.ok(Date.parse(snapshot.capturedAt) >= started && Date.parse(snapshot.capturedAt) <= Date.now());
  assert.equal(snapshot.tree.stories[0]!.id, story.id);
  assert.equal(snapshot.tree.stories[0]!.capabilities[0]!.id, capability.id);
  assert.equal(snapshot.scene.islands[0]!.land!.files[0]!.path, "src/answer.ts");
  assert.equal(snapshot.scene.islands[0]!.land!.territories[0]!.lines, 1);
  assert.ok(snapshot.changes.some(change => change.recordId === decision.id));
  assert.equal(snapshot.arcs[0]!.arc.id, arc.id);
  assert.deepEqual(snapshot.recording.window, { from, to });
  assert.deepEqual(snapshot.recording.lines.map(line => line.seq), [included.seq]);
  assert.match(snapshot.tree.stories[0]!.description!, /\[home\].*projects\/\[cloud-project\]/);
  assert.doesNotMatch(saved, /synthetic-private|\/home\/synthetic|private-cloud-example|"(?:folder|machine|transcript|branch)"/);

  await assert.rejects(run(to, from), /half-open window/);
  assert.equal(await readFile(output, "utf8"), saved);
  await library.editStory(story.id, { description: "password=synthetic-credential" });
  await assert.rejects(run(), error => {
    assert.match(String(error), /credential-like/);
    assert.doesNotMatch(String(error), /synthetic-credential/);
    return true;
  });
  assert.equal(await readFile(output, "utf8"), saved);
});
