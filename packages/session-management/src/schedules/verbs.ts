/**
 * Capability 18 · Scheduled processes, its verbs. The `schedule` verbs a factory's runner calls, declared once here
 * (ADR-0969 D2) and named under `verbs` in the package's manifest (ADR-1033), so the command line mounts them as its
 * `schedule` family and the MCP server as the tools schedule_due and schedule_ran: which scheduled process records are
 * due now, and recording that one ran with its outcome. The family is `schedule`, not `process`, because `processes`
 * already names this computer's running work, one letter apart (decision_8e018888b69e).
 *
 * A plugin's own librarian (ADR-1178 D5) is an agent record titled `librarian-<plugin>`, and its trigger is a scheduled
 * process linked to it: `schedule due` lists that run as the plugin's librarian, to run as the plugin's own database
 * role, so row security holds it to the plugin's kinds. That role is the one the plugin's manifest names, which the plugin
 * loader reads; session management does not import the loader, so the listing points the runner at `plugin check`, which
 * says it. The core librarian, librarian-curator, is no plugin's.
 *
 * Two outcomes mean no subagent ran (increment_dc6f1426f0ba): `missed`, a daily time past its schedule's grace, which is
 * recorded instead of run late, and `skipped`, a process whose precheck found nothing to do. `schedule due` lists each
 * apart from the due ones, and `schedule ran` records either only when a fresh reading says so, so neither hides work;
 * the runner's recording is what stops a missed time staying listed.
 */
import type { Line, SchemaRecord } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { dueAt } from "./due.js";
import { readPrecheck } from "./prechecks.js";

const OUTCOMES = ["ok", "concern", "failed", "missed", "skipped"] as const;
type Outcome = (typeof OUTCOMES)[number];
type Ran = Extract<Line, { kind: "process-ran" }>;

const MINUTE = 60_000;
/** The core librarian's name, which a plugin's librarian, `librarian-<plugin>`, never is. */
const CORE_LIBRARIAN = "librarian-curator";
const PLUGIN_LIBRARIAN = /^librarian-([a-z0-9][a-z0-9-]*)$/;

/** The plugin librarian a process runs: the first agent it links to named `librarian-<plugin>`, other than the core one. */
function librarianOf(process: SchemaRecord<"process">, agents: ReadonlyMap<string, SchemaRecord<"agent">>): { agent: string; plugin: string } | undefined {
  for (const link of process.fields.links ?? []) {
    const title = agents.get(link)?.fields.title;
    const plugin = title === undefined || title === CORE_LIBRARIAN ? undefined : PLUGIN_LIBRARIAN.exec(title)?.[1];
    if (plugin !== undefined) return { agent: link, plugin };
  }
  return undefined;
}

/** How long `minutes` is, in days, hours and minutes: "1d 2h 5m", or "under a minute". */
function span(minutes: number): string {
  if (minutes < 1) return "under a minute";
  const parts = [[Math.floor(minutes / 1440), "d"], [Math.floor((minutes % 1440) / 60), "h"], [minutes % 60, "m"]] as const;
  return parts.filter(([count]) => count > 0).map(([count, unit]) => `${count}${unit}`).join(" ");
}

/** The latest recorded run of each process, from the context's log. */
async function latestRuns(context: SessionVerbContext): Promise<Map<string, Ran>> {
  const lines = await context.log.lines(context.project, { kinds: ["process-ran"], latestBy: ["process"] });
  return new Map(lines.filter((line): line is Ran => line.kind === "process-ran").map((line) => [line.process, line]));
}

/** Every scheduled process record, and the latest run of each, from the context's log. */
async function scheduled(context: SessionVerbContext): Promise<{ processes: SchemaRecord<"process">[]; last: Map<string, Ran> }> {
  const processes = (await context.library.list("process")).filter((one) => one.fields.schedule !== undefined);
  return { processes, last: await latestRuns(context) };
}

const due = verb({
  consumers: ["agent"],
  command: { family: "schedule", name: "due", summary: "the scheduled processes due now (or --at a time), each with how overdue, those missed past their grace or with nothing to do by their precheck, and the last runs that were not ok", usage: "schedule due [--at <time>]" },
  tool: {
    name: "schedule_due",
    description: "The scheduled process records due now: each one's id, title and how overdue, its schedule having come round since its latest recorded run (or it never ran). Run each due one through a subagent (one listed with a librarian runs that plugin's librarian-<plugin>, connected as the database role its manifest names, which check_plugin says), then record it with schedule_ran. Listed apart, and never run: those whose time is past their schedule's grace (record each missed) and those whose precheck found nothing to do (record each skipped). Also lists the scheduled processes whose latest run was a concern, a failure or a miss, with its note, for the report.",
  },
  inputs: { at: { kind: "text", optional: true, describe: "the time to judge at, as ISO 8601; now unless given" } },
  async act({ at: given }, context: SessionVerbContext) {
    const at = given === undefined ? new Date() : new Date(given);
    if (Number.isNaN(at.getTime())) throw new VerbRefusal(`"${given}" is no time: give one as ISO 8601, such as 2026-10-22T09:15:00+11:00.`, { misuse: true });
    const { processes, last } = await scheduled(context);
    const linked = processes.some((one) => (one.fields.links ?? []).some((link) => link.startsWith("agent_")));
    const agents = new Map(linked ? (await context.library.list("agent")).map((one) => [one.id, one] as const) : []);
    const listed: { id: string; title: string; overdueMinutes: number | null; how: string; librarian?: { agent: string; plugin: string } }[] = [];
    const missed: { id: string; title: string; overdueMinutes: number; graceMinutes: number }[] = [];
    const skipped: { id: string; title: string; precheck: string; found: string }[] = [];
    for (const one of processes) {
      const ran = last.get(one.id);
      const reading = dueAt(one.fields.schedule!, one.fields.timeZone, ran === undefined ? undefined : new Date(ran.at), at);
      if (!reading.due) continue;
      const overdueMinutes = reading.since === undefined ? null : Math.floor((at.getTime() - reading.since.getTime()) / MINUTE);
      if (reading.missed !== undefined) {
        missed.push({ id: one.id, title: one.fields.title, overdueMinutes: overdueMinutes ?? 0, graceMinutes: reading.missed.graceMinutes });
        continue;
      }
      const { precheck } = one.fields;
      const check = precheck === undefined ? undefined : await readPrecheck(precheck, context.library);
      if (precheck !== undefined && check?.work === false) {
        skipped.push({ id: one.id, title: one.fields.title, precheck, found: check.found });
        continue;
      }
      const how = ran === undefined ? "never run" : overdueMinutes === null ? "every run" : `overdue ${span(overdueMinutes)}`;
      const librarian = librarianOf(one, agents);
      listed.push({ id: one.id, title: one.fields.title, overdueMinutes, how, ...(librarian === undefined ? {} : { librarian }) });
    }
    const notOk = processes.flatMap((one) => {
      const ran = last.get(one.id);
      return ran === undefined || ran.outcome === "ok" || ran.outcome === "skipped" ? [] : [{ id: one.id, title: one.fields.title, outcome: ran.outcome, at: ran.at, ...(ran.note === undefined ? {} : { note: ran.note }) }];
    });
    const head = listed.length === 0 ? ["No scheduled process is due."] : [`${listed.length} scheduled process${listed.length === 1 ? "" : "es"} due:`, ...listed.map((one) => `  ${one.id}  ${one.title}  (${one.how})${one.librarian === undefined ? "" : `: runs librarian-${one.librarian.plugin}, the ${one.librarian.plugin} plugin's own librarian, connected as the database role the ${one.librarian.plugin} plugin's manifest names for it (\`storytree plugin check ${one.librarian.plugin}\` says which), never the core librarian's`}`)];
    const late = missed.length === 0 ? [] : ["Missed, past their grace (record each missed; never run it late):", ...missed.map((one) => `  ${one.id}  ${one.title}  (slot ${span(one.overdueMinutes)} ago, grace ${span(one.graceMinutes)})`)];
    const idle = skipped.length === 0 ? [] : ["Nothing to do, by their precheck (record each skipped; start no subagent):", ...skipped.map((one) => `  ${one.id}  ${one.title}  (${one.found})`)];
    const tail = notOk.length === 0 ? [] : ["Last runs not ok:", ...notOk.map((one) => `  ${one.id}  ${one.title}  ${one.outcome} at ${one.at}${one.note === undefined ? "" : `: ${one.note}`}`)];
    const next = [
      ...[...new Set(listed.flatMap((one) => one.librarian === undefined ? [] : [one.librarian.plugin]))].map((plugin) => ({ tool: "check_plugin", command: `plugin check ${plugin}`, why: `the database role librarian-${plugin} connects as` })),
      ...(listed.length === 0 ? [] : [{ tool: "schedule_ran", command: "schedule ran <process> --outcome ok|concern|failed", why: "record each once it has run" }]),
      ...(missed.length === 0 ? [] : [{ tool: "schedule_ran", command: "schedule ran <process> --outcome missed", why: "record each missed time, so it is not listed again" }]),
      ...(skipped.length === 0 ? [] : [{ tool: "schedule_ran", command: "schedule ran <process> --outcome skipped", why: "record each run with nothing to do" }]),
    ];
    return {
      text: [...head, ...late, ...idle, ...tail].join("\n"),
      data: { due: listed.map(({ how: _how, ...one }) => one), missed, skipped, notOk },
      ...(next.length === 0 ? {} : { next }),
    };
  },
});

const ran = verb({
  consumers: ["agent"],
  command: { family: "schedule", name: "ran", summary: "record that a scheduled process ran, with its outcome, so it is not due until its next time", usage: "schedule ran <process> --outcome ok|concern|failed|missed|skipped [--note …]" },
  tool: {
    name: "schedule_ran",
    description: "Record that a scheduled process record ran, with its outcome (ok, concern or failed) and an optional note saying what was found: it is then not due until its schedule next comes round, and a concern, failure or miss stays listed by schedule_due until a later run is ok. Record missed for one schedule_due lists past its grace, and skipped for one whose precheck found nothing to do; each is refused unless that is still so.",
  },
  inputs: {
    process: { kind: "text", word: 0, describe: "the process record's id" },
    outcome: { kind: "text", describe: "ok, concern, failed, missed or skipped" },
    note: { kind: "text", optional: true, describe: "what the run found, in a line" },
  },
  agentOnly: "it records a run by the agent session that ran it",
  async act({ process, outcome, note }, context: SessionVerbContext) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new VerbRefusal(`A run's outcome is ok, concern, failed, missed or skipped, not "${outcome}".`, { misuse: true });
    const record = await context.library.get(process);
    if (record === null || record === undefined || record.type !== "process") throw new VerbRefusal(`${process} is no process record: give a scheduled process's id, as schedule due lists it.`);
    const fields = record.fields as SchemaRecord<"process">["fields"];
    if (fields.schedule === undefined) throw new VerbRefusal(`${process} (${fields.title}) has no schedule, so no run of it is recorded: an agent runs it when its trigger applies.`);
    let found: string | undefined;
    if (outcome === "missed") {
      const latest = (await latestRuns(context)).get(process);
      const reading = dueAt(fields.schedule, fields.timeZone, latest === undefined ? undefined : new Date(latest.at), new Date());
      if (!reading.due || reading.missed === undefined) throw new VerbRefusal(`${process} (${fields.title}) is not missed: only a time past its schedule's grace is (its schedule: "${fields.schedule}"), as schedule due lists it.`, { next: [{ tool: "schedule_due", command: "schedule due", why: "see what is due and what is missed" }] });
    }
    if (outcome === "skipped") {
      if (fields.precheck === undefined) throw new VerbRefusal(`${process} (${fields.title}) has no precheck, so no run of it is skipped: run it, then record what it found.`);
      const check = await readPrecheck(fields.precheck, context.library);
      if (check.work) throw new VerbRefusal(`${process} (${fields.title}) is not skipped: its precheck finds work (${check.found}), so run it.`);
      found = check.found;
    }
    const said = note ?? found;
    const line = await context.log.append(context.project, {
      session: context.session,
      ...(context.harness === undefined ? {} : { harness: context.harness }),
      source: "tool",
      ...(context.folder === undefined ? {} : { folder: context.folder }),
      ...(context.branch === undefined ? {} : { branch: context.branch }),
      kind: "process-ran",
      process,
      outcome: outcome as Outcome,
      ...(said === undefined ? {} : { note: said }),
    });
    return { text: `Recorded a run of ${process} (${fields.title}): ${outcome}${said === undefined ? "" : `, ${said}`}.`, data: { process, outcome, at: line.at } };
  },
});

/** Its section of the habits card (ADR-1021, the guidance kind): what a factory's runner does with the two tools. */
export const scheduleGuidance: readonly string[] = [
  "Asked to run the factory's routines, `schedule_due` lists the scheduled processes due now: run each through a subagent, then record it with `schedule_ran` and its outcome.",
];

/** The schedule verbs, in the order the command line lists them. */
export const SCHEDULE_VERBS: readonly Verb<VerbInputs, SessionVerbContext>[] = [due, ran];

/** Session management's `schedule` command family, which its manifest names under `verbs` (ADR-1033), just after `processes`. */
export const SCHEDULE_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [
  { name: "schedule", summary: "the scheduled processes due now, and recording that one ran (a factory's runner's)", order: 24.5, verbs: SCHEDULE_VERBS },
];
