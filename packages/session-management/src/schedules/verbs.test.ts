/**
 * Capability 18 · Scheduled processes, its verbs (18.1-18.2): `schedule due` and `schedule ran`, run with a fresh
 * project's library and the real agent activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";
import { testServerUrl } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { withLibrary } from "../friction/testing/pg.js";
import type { SessionVerbContext } from "../sessions/verbs.js";
import { SCHEDULE_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const MINUTE = 60_000;

const verbNamed = (name: string): Verb<VerbInputs, SessionVerbContext> => SCHEDULE_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
const due = verbNamed("due");
const ran = verbNamed("ran");

const PROCESS = { description: "A routine", statement: "S", trigger: "When due", steps: "1. Do it", surfaces: "The box", failureModes: "None" };

/** Run `body` with a context on a fresh library and the real log, as the runner session r. */
async function withRunner(body: (context: SessionVerbContext, library: Library, log: ActivityLog) => Promise<void>): Promise<void> {
  await withLibrary(async (library) => {
    const log = await openActivityLog(testServerUrl());
    try {
      await body({ library, log, project: library.name, session: "runner", harness: "claude-code", folder: process.cwd() }, library, log);
    } finally {
      await log.close();
    }
  });
}

/** The next HH:MM in UTC after `from`, at least `ahead` minutes on, and that instant. */
function nextUtcTime(from: Date, ahead: number): { words: string; at: Date } {
  const at = new Date(Math.ceil((from.getTime() + ahead * MINUTE) / MINUTE) * MINUTE);
  return { words: `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`, at };
}

test("18.1 · `schedule due` lists each scheduled process due at the time given, with its id, title and how overdue: never run, an interval once it has passed since the latest run, a daily time once it has come round in its time zone; one with no schedule never, and none due says so", async () => {
  await withRunner(async (context, library) => {
    const hourly = await library.writeKnowledge("process", { ...PROCESS, title: "Read the spend", schedule: "every 2 hours" });
    await library.writeKnowledge("process", { ...PROCESS, title: "Unscheduled" });
    const first = await due.act({}, context, WORDS);
    assert.match(first.text, new RegExp(`^1 scheduled process due:\\n  ${hourly.id}  Read the spend  \\(never run\\)$`));
    assert.deepEqual(first.data?.due, [{ id: hourly.id, title: "Read the spend", overdueMinutes: null }]);

    const done = await ran.act({ process: hourly.id, outcome: "ok" }, context, WORDS);
    const t0 = new Date(String(done.data?.at));
    const { words, at: daily } = nextUtcTime(t0, 10);
    const zoned = await library.writeKnowledge("process", { ...PROCESS, title: "Check the backups", schedule: `daily at ${words}`, timeZone: "UTC" });
    await ran.act({ process: zoned.id, outcome: "ok" }, context, WORDS);

    const at = (time: Date) => due.act({ at: time.toISOString() }, context, WORDS);
    assert.equal((await at(new Date(daily.getTime() - MINUTE))).text, "No scheduled process is due.");
    const early = (await at(new Date(t0.getTime() + 119 * MINUTE))).data?.due as { id: string }[];
    assert.equal(early.some((one) => one.id === hourly.id), false, "not due before its interval has passed");

    const later = await at(new Date(t0.getTime() + 125 * MINUTE));
    const listed = later.data?.due as { id: string; overdueMinutes: number | null }[];
    assert.deepEqual(listed.find((one) => one.id === hourly.id)?.overdueMinutes, 5, "due once two hours have passed since its run, five minutes over");
    const zonedNow = listed.find((one) => one.id === zoned.id);
    assert.ok(zonedNow, "the daily time has come round since its run");
    assert.equal(zonedNow.overdueMinutes, Math.floor((t0.getTime() + 125 * MINUTE - daily.getTime()) / MINUTE));
    assert.match(later.text, /overdue 5m\)/);

    const always = await library.writeKnowledge("process", { ...PROCESS, title: "Route the notes", schedule: "every run" });
    await ran.act({ process: always.id, outcome: "ok" }, context, WORDS);
    assert.match((await due.act({}, context, WORDS)).text, new RegExp(`  ${always.id}  Route the notes  \\(every run\\)`), "every run is due right after it ran");
    await assert.rejects(due.act({ at: "soon" }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.misuse);
  });
});

test("18.2 · `schedule ran` records a scheduled process's run with its outcome, refusing anything else, so it is not due until its next time; a concern or failure, with its note, reads back from `schedule due` until a later run is ok", async () => {
  await withRunner(async (context, library, log) => {
    const spend = await library.writeKnowledge("process", { ...PROCESS, title: "Read the spend", schedule: "every day" });
    const plain = await library.writeKnowledge("process", { ...PROCESS, title: "Unscheduled" });
    const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
    for (const process of [plain.id, decision.id, "process_000000000000"]) {
      await assert.rejects(ran.act({ process, outcome: "ok" }, context, WORDS), VerbRefusal, process);
    }
    await assert.rejects(ran.act({ process: spend.id, outcome: "fine" }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.misuse);
    assert.deepEqual(await log.lines(context.project, { kinds: ["process-ran"] }), [], "a refused run records nothing");

    const recorded = await ran.act({ process: spend.id, outcome: "concern", note: "spend up 40% on yesterday" }, context, WORDS);
    assert.equal(recorded.text, `Recorded a run of ${spend.id} (Read the spend): concern, spend up 40% on yesterday.`);
    const [line] = await log.lines(context.project, { kinds: ["process-ran"] });
    assert.deepEqual([line?.kind, line?.session, line?.kind === "process-ran" ? [line.process, line.outcome, line.note] : []], ["process-ran", "runner", [spend.id, "concern", "spend up 40% on yesterday"]]);

    const after = await due.act({}, context, WORDS);
    assert.equal((after.data?.due as unknown[]).length, 0, "not due again until a day has passed");
    assert.match(after.text, new RegExp(`^No scheduled process is due\\.\\nLast runs not ok:\\n  ${spend.id}  Read the spend  concern at .+: spend up 40% on yesterday$`));
    assert.deepEqual((after.data?.notOk as { id: string; outcome: string; note?: string }[]).map(({ id, outcome, note }) => ({ id, outcome, note })), [{ id: spend.id, outcome: "concern", note: "spend up 40% on yesterday" }]);

    await ran.act({ process: spend.id, outcome: "failed" }, context, WORDS);
    assert.match((await due.act({}, context, WORDS)).text, new RegExp(`  ${spend.id}  Read the spend  failed at [^:]+:\\d\\d:\\d\\d[^:]*$`), "the latest run is the one read back");
    await ran.act({ process: spend.id, outcome: "ok" }, context, WORDS);
    assert.equal((await due.act({}, context, WORDS)).text, "No scheduled process is due.");
  });
});

test("18.3 · `schedule due` lists a plugin librarian's run on its trigger: a scheduled process linked to an agent named librarian-<plugin> is listed due as that plugin's own librarian, to run as the database role its plugin's manifest names, pointing the runner at plugin check, which says it; the core librarian-curator and any other agent are not", async () => {
  await withRunner(async (context, library) => {
    const reading = await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
    const role = { oneLine: "Curates", role: "R", outcome: "O", context: [reading.id], tools: "T", workflow: "W" };
    const voice = await library.writeKnowledge("agent", { ...role, title: "librarian-voice", description: "Voice's own librarian." });
    const core = await library.writeKnowledge("agent", { ...role, title: "librarian-curator", description: "The core librarian." });
    const tidy = await library.writeKnowledge("process", { ...PROCESS, title: "Tidy voice notes", schedule: "every 2 hours", links: [voice.id] });
    const curate = await library.writeKnowledge("process", { ...PROCESS, title: "Curate the library", schedule: "every 2 hours", links: [core.id] });
    const reviewer = await library.writeKnowledge("agent", { ...role, title: "change-reviewer", description: "Another agent." });
    const review = await library.writeKnowledge("process", { ...PROCESS, title: "Review the week", schedule: "every 2 hours", links: [reviewer.id] });

    const listed = await due.act({}, context, WORDS);
    const byId = (list: unknown) => [...(list as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId(listed.data?.due), byId([
      { id: tidy.id, title: "Tidy voice notes", overdueMinutes: null, librarian: { agent: voice.id, plugin: "voice" } },
      { id: curate.id, title: "Curate the library", overdueMinutes: null },
      { id: review.id, title: "Review the week", overdueMinutes: null },
    ]));
    assert.match(listed.text, new RegExp(`  ${tidy.id}  Tidy voice notes  \\(never run\\): runs librarian-voice, the voice plugin's own librarian, connected as the database role the voice plugin's manifest names for it \\(\`storytree plugin check voice\` says which\\), never the core librarian's(\\n|$)`));
    assert.deepEqual(listed.next?.map((step) => step.command), ["plugin check voice", "schedule ran <process> --outcome ok|concern|failed"], "it points the runner at where the role is said");
    assert.match(listed.text, new RegExp(`  ${curate.id}  Curate the library  \\(never run\\)(\\n|$)`));

    const done = await ran.act({ process: tidy.id, outcome: "ok" }, context, WORDS);
    const later = await due.act({ at: new Date(Date.parse(String(done.data?.at)) + 121 * MINUTE).toISOString() }, context, WORDS);
    assert.deepEqual((later.data?.due as { id: string; librarian?: unknown }[]).find((one) => one.id === tidy.id)?.librarian, { agent: voice.id, plugin: "voice" }, "listed again once its trigger comes round");
    assert.equal((await due.act({}, context, WORDS)).text.includes(tidy.id), false, "not due before its trigger comes round again");
  });
});
