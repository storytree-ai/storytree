/**
 * Capability 18 · Scheduled processes, its verbs. The `schedule` verbs a factory's runner calls, declared once here
 * (ADR-0969 D2) and named under `verbs` in the package's manifest (ADR-1033), so the command line mounts them as its
 * `schedule` family and the MCP server as the tools schedule_due and schedule_ran: which scheduled process records are
 * due now, and recording that one ran with its outcome. The family is `schedule`, not `process`, because `processes`
 * already names this computer's running work, one letter apart (decision_8e018888b69e).
 *
 * A plugin's own librarian (ADR-1178 D5) is an agent record titled `librarian-<plugin>`, and its trigger is a scheduled
 * process linked to it: `schedule due` lists that run as the plugin's librarian, to run as the plugin's own database
 * role, so row security holds it to the plugin's kinds. The core librarian, librarian-curator, is no plugin's.
 */
import type { Line, SchemaRecord } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { dueAt } from "./due.js";

const OUTCOMES = ["ok", "concern", "failed"] as const;
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

/** Every scheduled process record, and the latest run of each, from the context's log. */
async function scheduled(context: SessionVerbContext): Promise<{ processes: SchemaRecord<"process">[]; last: Map<string, Ran> }> {
  const processes = (await context.library.list("process")).filter((one) => one.fields.schedule !== undefined);
  const lines = await context.log.lines(context.project, { kinds: ["process-ran"], latestBy: ["process"] });
  return { processes, last: new Map(lines.filter((line): line is Ran => line.kind === "process-ran").map((line) => [line.process, line])) };
}

const due = verb({
  consumers: ["agent"],
  command: { family: "schedule", name: "due", summary: "the scheduled processes due now (or --at a time), each with how overdue, and the last runs that were not ok", usage: "schedule due [--at <time>]" },
  tool: {
    name: "schedule_due",
    description: "The scheduled process records due now: each one's id, title and how overdue, its schedule having come round since its latest recorded run (or it never ran). Run each due one through a subagent (one listed with a librarian runs that plugin's librarian-<plugin>, connected as the plugin's own database role), then record it with schedule_ran. Also lists the scheduled processes whose latest run was a concern or a failure, with its note, for the report.",
  },
  inputs: { at: { kind: "text", optional: true, describe: "the time to judge at, as ISO 8601; now unless given" } },
  async act({ at: given }, context: SessionVerbContext) {
    const at = given === undefined ? new Date() : new Date(given);
    if (Number.isNaN(at.getTime())) throw new VerbRefusal(`"${given}" is no time: give one as ISO 8601, such as 2026-10-22T09:15:00+11:00.`, { misuse: true });
    const { processes, last } = await scheduled(context);
    const linked = processes.some((one) => (one.fields.links ?? []).some((link) => link.startsWith("agent_")));
    const agents = new Map(linked ? (await context.library.list("agent")).map((one) => [one.id, one] as const) : []);
    const listed = processes.flatMap((one) => {
      const ran = last.get(one.id);
      const reading = dueAt(one.fields.schedule!, one.fields.timeZone, ran === undefined ? undefined : new Date(ran.at), at);
      if (!reading.due) return [];
      const overdueMinutes = reading.since === undefined ? null : Math.floor((at.getTime() - reading.since.getTime()) / MINUTE);
      const how = ran === undefined ? "never run" : overdueMinutes === null ? "every run" : `overdue ${span(overdueMinutes)}`;
      const librarian = librarianOf(one, agents);
      return [{ id: one.id, title: one.fields.title, overdueMinutes, how, ...(librarian === undefined ? {} : { librarian }) }];
    });
    const notOk = processes.flatMap((one) => {
      const ran = last.get(one.id);
      return ran === undefined || ran.outcome === "ok" ? [] : [{ id: one.id, title: one.fields.title, outcome: ran.outcome, at: ran.at, ...(ran.note === undefined ? {} : { note: ran.note }) }];
    });
    const head = listed.length === 0 ? ["No scheduled process is due."] : [`${listed.length} scheduled process${listed.length === 1 ? "" : "es"} due:`, ...listed.map((one) => `  ${one.id}  ${one.title}  (${one.how})${one.librarian === undefined ? "" : `: runs librarian-${one.librarian.plugin}, the ${one.librarian.plugin} plugin's own librarian, as the ${one.librarian.plugin} plugin's database role, never the core librarian's`}`)];
    const tail = notOk.length === 0 ? [] : ["Last runs not ok:", ...notOk.map((one) => `  ${one.id}  ${one.title}  ${one.outcome} at ${one.at}${one.note === undefined ? "" : `: ${one.note}`}`)];
    return {
      text: [...head, ...tail].join("\n"),
      data: { due: listed.map(({ how: _how, ...one }) => one), notOk },
      ...(listed.length === 0 ? {} : { next: [{ tool: "schedule_ran", command: "schedule ran <process> --outcome ok|concern|failed", why: "record each once it has run" }] }),
    };
  },
});

const ran = verb({
  consumers: ["agent"],
  command: { family: "schedule", name: "ran", summary: "record that a scheduled process ran, with its outcome, so it is not due until its next time", usage: "schedule ran <process> --outcome ok|concern|failed [--note …]" },
  tool: {
    name: "schedule_ran",
    description: "Record that a scheduled process record ran, with its outcome (ok, concern or failed) and an optional note saying what was found: it is then not due until its schedule next comes round, and a concern or failure stays listed by schedule_due until a later run is ok.",
  },
  inputs: {
    process: { kind: "text", word: 0, describe: "the process record's id" },
    outcome: { kind: "text", describe: "ok, concern or failed" },
    note: { kind: "text", optional: true, describe: "what the run found, in a line" },
  },
  agentOnly: "it records a run by the agent session that ran it",
  async act({ process, outcome, note }, context: SessionVerbContext) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new VerbRefusal(`A run's outcome is ok, concern or failed, not "${outcome}".`, { misuse: true });
    const record = await context.library.get(process);
    if (record === null || record === undefined || record.type !== "process") throw new VerbRefusal(`${process} is no process record: give a scheduled process's id, as schedule due lists it.`);
    const fields = record.fields as SchemaRecord<"process">["fields"];
    if (fields.schedule === undefined) throw new VerbRefusal(`${process} (${fields.title}) has no schedule, so no run of it is recorded: an agent runs it when its trigger applies.`);
    const line = await context.log.append(context.project, {
      session: context.session,
      ...(context.harness === undefined ? {} : { harness: context.harness }),
      source: "tool",
      ...(context.folder === undefined ? {} : { folder: context.folder }),
      ...(context.branch === undefined ? {} : { branch: context.branch }),
      kind: "process-ran",
      process,
      outcome: outcome as Outcome,
      ...(note === undefined ? {} : { note }),
    });
    return { text: `Recorded a run of ${process} (${fields.title}): ${outcome}${note === undefined ? "" : `, ${note}`}.`, data: { process, outcome, at: line.at } };
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
