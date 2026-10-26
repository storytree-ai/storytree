/**
 * Capability 6 · Agent tools (the MCP server). The planning tools: plan an arc, a story, a capability or a contract, correct any of them, retire
 * a capability or a contract (ADR-0641 D2 step 3), and see the plan with its health, who holds what and which sessions are about. A story or capability is planned with its founding decision, the
 * first book on its shelf, so none planned here starts with an empty shelf (ADR-0627 D5).
 */
import { ANCHOR_ID, anchorGaps, CONTRACT_DEFINITION, LONG_CONTRACT_TITLE as LONG_CONTRACT, wordAndWhy, type AnnotatedTree, type DayWindow, type HealthState, type NodeHealth, type PlanChange } from "@storytree/library";
import { z } from "zod";

import { untestedContracts } from "@storytree/map/code-survey";
import { readClaims } from "@storytree/session-management";
import { readSessions } from "@storytree/session-management";
import { testedNumbers } from "./claim-tools.js";
import type { Answer, Call, Define } from "./server.js";
import { quoted } from "./text.js";
import { machineChecked } from "./work-tools.js";

const title = z.string().min(1).describe("What it is called: a short name");
const description = z.string().min(1).optional().describe("A sentence or two on what it is for");
const audience = z
  .string()
  .min(1)
  .optional()
  .describe("The anchor's audience: who the project is for, named as a group they would recognise themselves in (ADR-1085 D1); only the project names one (ADR-1096)");
const intent = z.string().min(1).describe("What the arc exists to deliver, in a sentence");
const endState = z.string().min(1).describe("What closed looks like: the condition under which it is delivered");
const id = (what: string) => z.string().min(1).describe(`The id of the ${what}, as the plan shows it`);
const covers = z
  .array(z.string().min(1))
  .min(1)
  .optional()
  .describe("On a mapped story only, and required there: the folders and files of its imported project this capability covers, each from the imported folder (a folder covers everything under it); none may overlap another capability's of the story");

const founding = z
  .object({
    title: z.string().min(1).describe("The one choice that shapes it, as a short title"),
    text: z.string().min(1).describe("What it is for, and why that choice"),
  })
  .describe("Its founding decision, the first book on its shelf");

export function registerPlanTools(define: Define): void {
  define(
    "plan_arc",
    "Plan an arc: an initiative that grows one or more stories. Stories it lists must already be planned; it may list none.",
    z.object({
      title,
      description,
      intent,
      end_state: endState,
      stories: z.array(z.string().min(1)).optional().describe("The ids of the stories it grows"),
    }),
    async ({ title: name, description: about, intent: aim, end_state: end, stories }, { library, writer }) => {
      const arc = await library.createArc({ title: name, intent: aim, endState: end, ...optional({ description: about, stories }) }, writer);
      return { text: `Planned arc ${quoted(name)} (${arc.id}).`, data: { id: arc.id } };
    },
  );

  define(
    "plan_story",
    "Plan a story: something a user of the project can do, with its founding decision: what it is for, and the one choice that shapes it. Plan its capabilities next.",
    z.object({ title, description, founding }),
    async ({ title: name, description: about, founding: decision }, { library, writer }) => {
      const story = await library.addStory({ title: name, ...optional({ description: about }) }, writer);
      const book = await library.recordDecision({ ...decision, status: "accepted", frontCoverOf: story.id }, writer);
      return {
        text: `Planned story ${quoted(name)} (${story.id}), founded on ${quoted(decision.title)} (${book.id}). Plan its capabilities next.`,
        data: { id: story.id, founding: book.id },
      };
    },
  );

  define(
    "plan_capability",
    "Plan a capability: one part that makes a story work, with its founding decision: what it is for, and the one choice that shapes it. Leave its number off the title: it is given the story's next free one. Claim it before you build it. On a mapped story it is a capability you explored there, drawn as its own territory: give the folders and files it covers. Where it starts and ends is your call; one overlapping another of the story's is refused, naming that one, so correct it with edit_plan rather than adding another.",
    z.object({
      story: id("story it belongs to"),
      title,
      description,
      depends_on: z.array(z.string().min(1)).optional().describe("The ids of capabilities it needs first"),
      covers,
      founding,
    }),
    async ({ story, title: name, description: about, depends_on: dependsOn, covers: paths, founding: decision }, { library, writer }) => {
      const capability = await library.addCapability({ title: name, story, ...optional({ description: about, dependsOn, covers: paths }) }, writer);
      const book = await library.recordDecision({ ...decision, status: "accepted", frontCoverOf: capability.id }, writer);
      return {
        text: `Planned capability ${quoted(name)} (${capability.id}), founded on ${quoted(decision.title)} (${book.id}). Plan its contracts, then claim it before you build it.`,
        data: { id: capability.id, founding: book.id },
      };
    },
  );

  define(
    "plan_contract",
    "Plan a contract: one testable promise a capability makes. Leave its number off the title: it is given the capability's next free one, past the numbers its contracts and its story package's numbered tests carry, even a test no contract carries yet, since that test may promise something else; the reply names those tests, so when this contract is one's promise you give that number in the title. It also names the capability's other contracts no numbered test carries yet, perhaps planned by a lane that backed off: build one of those rather than plan its promise again. A number another contract of the capability carries is refused. Write its test, see it fail, and report it red.",
    z.object({ capability: id("capability it belongs to"), title, description }),
    async ({ capability, title: name, description: about }, call) => {
      const tree = await call.library.projectTree();
      const tested = await testedNumbers(call, capability, tree);
      const contract = await call.library.addContract({ title: name, capability, ...optional({ description: about }) }, { ...call.writer, testedNumbers: tested });
      const orphans = await orphanTests(call, capability, contract.fields.title, tested);
      const named = orphans.length === 0 ? "" : ` Numbered ${orphans.length === 1 ? `test ${orphans[0]} has` : `tests ${orphans.slice(0, -1).join(", ")} and ${orphans.at(-1)} have`} no contract: if this contract is ${orphans.length === 1 ? "its" : "one's"} promise, give it that number with edit_plan.`;
      const untested = untestedContracts(tree, capability, tested);
      const open = untested.length === 0 ? "" : ` No numbered test carries ${untested.length === 1 ? "this other contract" : `these ${untested.length} other contracts`} of the capability yet, perhaps planned by a lane that backed off: ${untested.map(quoted).join(", ")}. If this contract repeats one's promise, retire it and build that one.`;
      const long = contract.fields.title.length > LONG_CONTRACT;
      const advice = long ? ` Its title runs past ${LONG_CONTRACT} characters, which often means more than one promise: ${CONTRACT_DEFINITION} Split it with edit_plan and plan_contract if so.` : "";
      return { text: `Planned contract ${quoted(contract.fields.title)} (${contract.id}).${named}${open}${advice} Write its test, see it fail, and report it red.`, data: { id: contract.id, orphans, untested, long } };
    },
  );

  define(
    "edit_plan",
    `Correct an arc, story, capability, contract or increment in place, or the project's anchor (id ${ANCHOR_ID}: what it is, and its audience, who it is for): change only the fields you give. An increment's capabilities list is filled here by the session that claims it, as it plans (ADR-0949 D2). While you hold an increment, a change to a story, capability or contract planned before it waits on the increment as a pending change until its branch merges, and the live plan is unchanged (ADR-0966); one it planned changes at once.`,
    z.object({
      id: id(`arc, story, capability, contract or increment to correct, or ${ANCHOR_ID} for the project's anchor`),
      what: z.string().min(1).optional().describe("The project's anchor: what it is, in a few words (\"a software factory\")"),
      audience,
      title: title.optional(),
      description,
      story: z.string().min(1).optional().describe("A capability's story, to move it"),
      capability: z.string().min(1).optional().describe("A contract's capability, to move it"),
      depends_on: z.array(z.string().min(1)).optional().describe("A capability's dependencies, replacing them"),
      covers: covers.describe("A mapped story's capability's folders and files, replacing them"),
      stories: z.array(z.string().min(1)).optional().describe("An arc's stories, replacing them"),
      intent: intent.optional(),
      end_state: endState.optional(),
      priority: z
        .union([z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), z.literal("none")])
        .optional()
        .describe("An arc's priority: a whole number, 1 first, or \"none\" to clear it; an arc with none comes after every arc that has one (ADR-0963)"),
      capabilities: z.array(z.string().min(1)).optional().describe("An increment's capabilities, replacing them: the ones it changes, and nothing else"),
      links: z.array(z.string().min(1)).optional().describe("An increment's links, replacing them: its stories, notes or decisions"),
      machine: z.string().min(1).optional().describe("The one machine that can take an increment, by the short name Machines knows it by, or \"none\" to clear it, so any machine can"),
      escape: z
        .union([z.object({ caused_by: z.string().min(1).describe("The pull request (#123) or increment that caused it"), story: z.string().min(1).describe("The story it hit") }), z.literal("none")])
        .optional()
        .describe("The escape an increment fixes, a defect that reached main: the change that caused it and the story it hit, or \"none\" to clear it"),
    }),
    async ({ id: target, ...changes }, call) => editPlan(target, changes, call),
  );

  define(
    "retire_from_plan",
    "Retire a capability or a contract that is no longer wanted, with the reason: it leaves the plan, and its history keeps it and the reason. While you hold an increment, one planned before it is retired when the increment's branch merges, waiting until then as a pending change (ADR-0966).",
    z.object({ id: id("capability or contract to retire"), reason: z.string().min(1).describe("Why it is retired, in a line") }),
    async ({ id: target, reason }, call) => {
      const { library, writer } = call;
      const found = partOf(await library.projectTree(), target);
      if (found === undefined) return { text: `${target} is not a capability or a contract in this project's plan: only those are retired here.`, refused: true };
      const held = await heldOnIncrement(call, { record: target, retire: reason });
      if (held !== undefined) return { text: `Retiring ${found.kind} ${quoted(found.title)} (${target}) is ${held}`, data: { id: target } };
      await library.retire(target, reason, writer);
      return { text: `Retired ${found.kind} ${quoted(found.title)} (${target}): ${reason}.`, data: { id: target } };
    },
  );

  define(
    "mark_built",
    "Say a capability is built, once you consider it built: it is no longer proposed, and its card's word then comes from what storytree verified, never from your report. Or say it is proposed again (built: false).",
    z.object({ capability: id("capability"), built: z.boolean().describe("true when it is built, false to make it proposed again") }),
    async ({ capability, built }, { library, writer }) => {
      const done = await library.setProposed(capability, !built, writer);
      if (done === null) return { text: `${capability} is not a capability in this project's plan.`, refused: true };
      return {
        text: built ? `Capability ${quoted(done.fields.title)} (${capability}) is no longer proposed. Its word now comes from what storytree verified.` : `Capability ${quoted(done.fields.title)} (${capability}) is proposed again.`,
        data: { id: capability },
      };
    },
  );

  define(
    "show_plan",
    "See the plan: every story, capability and contract with its health, who holds what, which sessions are about, and the live arcs with those closed yesterday or today. Give closed, or from and to, for only the arcs closed in that window instead.",
    z.object({
      closed: z.enum(["today", "yesterday", "week"]).optional().describe("Only the arcs closed today, yesterday or this week (the last seven days)"),
      from: z.string().regex(DAY).optional().describe("Only the arcs closed from this day (YYYY-MM-DD), with to"),
      to: z.string().regex(DAY).optional().describe("Only the arcs closed up to this day (YYYY-MM-DD), included, with from"),
    }),
    async (ask, call) => planAnswer(call, ask),
  );
}

interface Changes {
  title?: string | undefined;
  description?: string | undefined;
  story?: string | undefined;
  capability?: string | undefined;
  depends_on?: string[] | undefined;
  stories?: string[] | undefined;
  intent?: string | undefined;
  end_state?: string | undefined;
  priority?: number | "none" | undefined;
  capabilities?: string[] | undefined;
  links?: string[] | undefined;
  machine?: string | undefined;
  escape?: { caused_by: string; story: string } | "none" | undefined;
  what?: string | undefined;
  audience?: string | undefined;
}

/** The fields each kind of plan record can have corrected, as the tool names them. */
const EDITABLE = {
  story: ["title", "description"],
  capability: ["title", "description", "story", "depends_on", "covers"],
  contract: ["title", "description", "capability"],
  arc: ["title", "description", "stories", "intent", "end_state", "priority"],
  increment: ["title", "capabilities", "links", "machine", "escape"],
  anchor: ["what", "audience"],
} as const;

async function editPlan(target: string, changes: Changes, call: Call): Promise<Answer> {
  const { library, storytree, writer } = call;
  const kind = target === ANCHOR_ID ? "anchor" : (kindOf(await library.projectTree(), target) ?? ((await library.get(target))?.type === "increment" ? "increment" : undefined));
  if (kind === undefined) return { text: `Nothing in the plan has the id ${target}; show_plan lists every id.`, refused: true };
  const given = Object.entries(changes).filter(([, value]) => value !== undefined);
  const allowed: readonly string[] = EDITABLE[kind];
  const wrong = given.map(([field]) => field).filter((field) => !allowed.includes(field));
  if (wrong.length > 0) return { text: `A ${kind} has no ${wrong.join(" or ")} to correct; it has ${allowed.join(", ")}.`, refused: true };
  if (given.length === 0) return { text: `Nothing to correct: give the ${kind}'s ${allowed.join(", ")}.`, refused: true };
  if (kind === "anchor") {
    const anchor = (await library.setAnchor(optional({ what: changes.what, audience: changes.audience }), writer)).fields;
    return { text: `Corrected the project's anchor: ${anchorLine(anchor)}.`, data: { id: target } };
  }
  if (kind === "increment" && changes.capabilities !== undefined) {
    const shared = await sharedCapability(target, changes.capabilities, call);
    if (shared !== undefined) return { text: shared, refused: true };
  }
  const { depends_on: dependsOn, end_state: endState, priority, machine, escape, ...rest } = changes;
  const named = machine === undefined ? undefined : await machineChecked(storytree, machine);
  if (named !== undefined && "refused" in named) return named.refused;
  // "none" clears an arc's priority, and an increment's machine or escape: the library removes a field given as undefined (ADR-0963 D3).
  const fields = {
    ...optional({ ...rest, dependsOn, endState }),
    ...(priority === undefined ? {} : { priority: priority === "none" ? undefined : priority }),
    ...(named ?? {}),
    ...(escape === undefined ? {} : { escape: escape === "none" ? undefined : { causedBy: escape.caused_by, story: escape.story } }),
  };
  if (kind === "story" || kind === "capability" || kind === "contract") {
    const held = await heldOnIncrement(call, { record: target, fields });
    if (held !== undefined) return { text: `Your change to ${kind} ${quoted(String(((await library.get(target))?.fields as { title?: string } | undefined)?.title))} (${target}) is ${held}`, data: { id: target } };
  }
  const edited =
    kind === "story"
      ? await library.editStory(target, fields, writer)
      : kind === "capability"
        ? await library.editCapability(target, fields, writer)
        : kind === "contract"
          ? await library.editContract(target, fields, writer)
          : kind === "increment"
            ? await library.editIncrement(target, fields, writer)
            : await library.editArc(target, fields, writer);
  if (edited === null) return { text: `Nothing in the plan has the id ${target} any more.`, refused: true };
  return { text: `Corrected ${kind} ${quoted(edited.fields.title)} (${target}).`, data: { id: target } };
}

/**
 * Hold `change` on the increment the calling session holds, as a pending change that waits for its
 * branch to merge (ADR-0966 D1), and say so; undefined when it holds none, or the increment planned
 * the record itself, and the change is made live. Of several, the one it claimed last.
 */
async function heldOnIncrement({ library, log, project, quietMs, caller, writer }: Call, change: PlanChange): Promise<string | undefined> {
  const increment = (await readClaims(log, project, { quietMs }))
    .filter((claim) => claim.session === caller.session && claim.increment !== undefined)
    .sort((one, other) => one.since.localeCompare(other.since))
    .at(-1)?.increment;
  if (increment === undefined) return undefined;
  const pended = await library.pendChange(increment, change, writer);
  if (pended === null || !("pending" in pended)) return undefined;
  return `pending on increment ${increment} until its branch merges; the live plan is unchanged. Reading the increment lists it.`;
}

/**
 * Why `capabilities` may not be `target`'s list: one of them is on the list of an increment another
 * live session holds, since two sessions never plan changes to the same capability (ADR-0949 D2).
 * An entry whose capability another session's live claim holds is left behind by a lane that backed
 * off from it (ADR-0944 D3), and refuses nothing.
 */
async function sharedCapability(target: string, capabilities: readonly string[], { library, log, project, quietMs, caller }: Call): Promise<string | undefined> {
  const claims = await readClaims(log, project, { quietMs });
  const others = claims.filter((claim) => claim.session !== caller.session && claim.holder === "live" && claim.increment !== undefined && claim.increment !== target);
  for (const claim of others) {
    const listed = ((await library.get(claim.increment!))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
    const heldElsewhere = (id: string) => claims.some((one) => one.capability === id && one.holder === "live" && one.session !== claim.session);
    const capability = capabilities.find((id) => listed.includes(id) && !heldElsewhere(id));
    if (capability !== undefined)
      return `${capability} is already on the capabilities list of ${claim.increment}, which ${claim.label} session ${claim.session} holds (${claim.reason}): two sessions never plan changes to the same capability (ADR-0949 D2). Leave it off this list, or take other work.`;
  }
  return undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A local day (YYYY-MM-DD), `offset` days from `at`'s, as the arc board's Closed tab counts them (capability 3.12). */
function dayOf(at: number, offset = 0): string {
  const day = new Date(at);
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/**
 * The closing days show_plan reads closed arcs by, as `arc list` does: none given, undefined (the live arcs and those
 * closed yesterday or today); a preset, or from and to, both included, as the library's window (its end left out); or why not.
 */
function closedWindowOf(closed: "today" | "yesterday" | "week" | undefined, from: string | undefined, to: string | undefined, now: number): DayWindow | undefined | string {
  if (closed !== undefined && (from !== undefined || to !== undefined)) return "Give closed, or from and to, not both.";
  if (closed !== undefined) return { from: dayOf(now, { today: 0, yesterday: -1, week: -6 }[closed]), to: dayOf(now, closed === "yesterday" ? 0 : 1) };
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined || to === undefined) return "from and to are given together: the first and last closing day, both included.";
  if (from > to) return `from ${from} is after to ${to}.`;
  return { from, to: dayOf(Date.parse(`${to}T12:00:00`), 1) };
}

/** What show_plan reads the plan from: the project's library and activity log, and how long a quiet session stays live. */
export type PlanReading = Pick<Call, "library" | "log" | "project" | "quietMs">;

/** What show_plan answers, which the command line's `storytree plan` prints too (ADR-0793): the plan, or why the window given is wrong. */
export async function planAnswer(reading: PlanReading, { closed, from, to }: { closed?: "today" | "yesterday" | "week" | undefined; from?: string | undefined; to?: string | undefined }): Promise<Answer> {
  const window = closedWindowOf(closed, from, to, Date.now());
  return typeof window === "string" ? { text: window, refused: true } : showPlan(reading, window);
}

async function showPlan({ library, log, project, quietMs }: PlanReading, closed: DayWindow | undefined): Promise<Answer> {
  // Who holds what, and the sessions the running-sessions list shows: read from what decides them alone (contract 2.7).
  // The arcs as the board reads them (10.22): live ones and the recently closed, or a window's closed arcs alone.
  const now = Date.now();
  const arcRead = closed === undefined ? library.boardArcs({ from: dayOf(now, -1), to: dayOf(now, 1) }) : library.closedArcs(closed);
  const [tree, views, claims, inView] = await Promise.all([library.projectTree(), arcRead, readClaims(log, project, { quietMs }), readSessions(log, project, { quietMs, of: "in-view" })]);
  const closedOn = new Map(views.map((view) => [view.arc.id, view.closed]));
  const arcs = tree.arcs.filter((arc) => closedOn.has(arc.id));
  const incrementsOf = new Map(views.map((view) => [view.arc.id, view.increments]));
  const sessions = inView.filter((session) => session.listing !== "hidden");
  const holderOf = new Map(claims.map((claim) => [claim.capability ?? claim.increment, claim]));
  const heldBy = (id: string) => {
    const claim = holderOf.get(id);
    return claim === undefined ? "nobody holds it" : `held by ${claim.label} ${claim.session}${claim.holder === "idle" ? " (idle)" : ""}: ${claim.reason}`;
  };

  const out: string[] = [];
  const gaps = anchorGaps(tree);
  out.push(tree.anchor === undefined ? `The project has no anchor yet (${ANCHOR_ID}): say what it is and who it is for with edit_plan.` : `Anchor (${ANCHOR_ID}): ${anchorLine(tree.anchor)}`);
  const unsaid = [
    ...(gaps.anchor.length === 1 ? [`the anchor does not yet say ${gaps.anchor[0] === "what" ? "what the project is" : "who it is for"}`] : []),
  ];
  if (unsaid.length > 0) out.push(`Plan health (it fails nothing): ${unsaid.join("; ")}.`);
  if (tree.stories.length === 0) out.push(`The plan of ${quoted(project)} is empty: plan a story with plan_story.`);
  for (const story of tree.stories) {
    // A mapped story carries no health of its own (ADR-0993 D3): it says what it is instead.
    out.push(`Story ${quoted(story.title)} (${story.id}): ${story.mapped === undefined ? healthOf(story.health) : "mapped: here before storytree, and assumed to be working"}`);
    for (const capability of story.capabilities) {
      out.push(`  Capability ${quoted(capability.title)} (${capability.id}): ${healthOf(capability.health)}; ${wordAndWhy(capability)}; ${heldBy(capability.id)}`);
      for (const contract of capability.contracts) out.push(`    Contract ${quoted(contract.title)} (${contract.id}): ${healthOf(contract.health)}`);
    }
  }
  // Ranked arcs first, 1 first; the sort is stable, so the unranked and each priority's arcs keep creation order (ADR-0963 D2).
  const priorityOf = new Map(views.map((view) => [view.arc.id, view.arc.fields.priority]));
  const rank = (id: string) => priorityOf.get(id) ?? Infinity;
  for (const arc of [...arcs].sort((one, other) => rank(one.id) - rank(other.id) || 0)) {
    const priority = priorityOf.get(arc.id);
    const day = closedOn.get(arc.id);
    out.push(`Arc ${quoted(arc.title)} (${arc.id})${priority === undefined ? "" : `, priority ${priority},`}${day === undefined ? "" : `, closed ${day},`} grows ${arc.stories.length === 0 ? "no stories yet" : arc.stories.join(", ")}`);
    for (const increment of incrementsOf.get(arc.id) ?? []) {
      out.push(`  Increment ${quoted(increment.fields.title)} (${increment.id}): ${increment.fields.status}; ${heldBy(increment.id)}`);
    }
  }
  out.push(
    sessions.length === 0
      ? "No sessions yet."
      : `Sessions: ${sessions.map((session) => `${session.label} ${session.session}, ${session.state}${session.tier === "connected" ? ", connected" : session.hooksRunning ? "" : ", hooks not running"}`).join("; ")}`,
  );
  return {
    text: out.join("\n"),
    data: {
      ...(tree.anchor === undefined ? {} : { anchor: tree.anchor }),
      gaps,
      stories: tree.stories,
      arcs,
      claims,
      sessions,
    },
  };
}

/** The project's sentence as show_plan and edit_plan say it, a half not yet written said so. */
function anchorLine(anchor: { what?: string | undefined; audience?: string | undefined }): string {
  return `${anchor.what ?? "(what it is, not yet said)"}, for ${anchor.audience ?? "(who it is for, not yet said)"}`;
}

/** The kind of plan record `id` is, or undefined if the plan has none. */
function kindOf(tree: AnnotatedTree, id: string): keyof typeof EDITABLE | undefined {
  if (tree.arcs.some((arc) => arc.id === id)) return "arc";
  for (const story of tree.stories) {
    if (story.id === id) return "story";
    for (const capability of story.capabilities) {
      if (capability.id === id) return "capability";
      if (capability.contracts.some((contract) => contract.id === id)) return "contract";
    }
  }
  return undefined;
}

function healthOf(health: NodeHealth): string {
  return `reported ${said(health.reported.state)}, verified ${said(health.verified.state)}`;
}

function said(state: HealthState): string {
  return state === "not-checked" ? "not checked" : state;
}

/**
 * The numbers of `capability`'s numbered tests (`tested`) that none of its live contracts carries, in order:
 * the capability's number is read off `title`, a contract just planned on it.
 */
async function orphanTests({ library }: Call, capability: string, title: string, tested: readonly string[]): Promise<string[]> {
  const prefix = /^(\d+)\.\d+ · /.exec(title)?.[1];
  if (prefix === undefined) return [];
  const contracts = (await library.projectTree()).stories.flatMap((story) => story.capabilities).find((part) => part.id === capability)?.contracts ?? [];
  const carried = new Set(contracts.map((contract) => /^(\d+\.\d+) · /.exec(contract.title)?.[1]));
  const own = [...new Set(tested)].filter((number) => number.startsWith(`${prefix}.`) && !carried.has(number));
  return own.sort((a, b) => Number(a.slice(prefix.length + 1)) - Number(b.slice(prefix.length + 1)));
}

/** `fields` without the ones that are undefined: the library's inputs take no undefined values. */
function optional<T extends Record<string, unknown>>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** The capability or contract `id` names in the plan, if it names one. */
function partOf(tree: AnnotatedTree, id: string): { kind: "capability" | "contract"; title: string } | undefined {
  for (const capability of tree.stories.flatMap((story) => story.capabilities)) {
    if (capability.id === id) return { kind: "capability", title: capability.title };
    const contract = capability.contracts.find((node) => node.id === id);
    if (contract !== undefined) return { kind: "contract", title: contract.title };
  }
  return undefined;
}
