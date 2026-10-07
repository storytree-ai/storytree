/**
 * Capability 6 · Agent tools (the MCP server). The planning tools: plan an arc, a story, a capability or a contract, correct any of them, retire
 * a capability or a contract (ADR-0641 D2 step 3), and see the plan with its health, who holds what
 * and which sessions are about. A story or capability is planned with its founding decision, the
 * first book on its shelf, so none planned here starts with an empty shelf (ADR-0627 D5).
 */
import { wordAndWhy, type AnnotatedTree, type HealthState, type NodeHealth } from "@storytree/library";
import { z } from "zod";

import { readClaims } from "../claims/index.js";
import { readSessions } from "../sessions/index.js";
import type { Answer, Call, Define } from "./server.js";
import { quoted } from "./text.js";

const title = z.string().min(1).describe("What it is called: a short name");
const description = z.string().min(1).optional().describe("A sentence or two on what it is for");
const intent = z.string().min(1).describe("What the arc exists to deliver, in a sentence");
const endState = z.string().min(1).describe("What closed looks like: the condition under which it is delivered");
const id = (what: string) => z.string().min(1).describe(`The id of the ${what}, as the plan shows it`);
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
    "Plan a capability: one part that makes a story work, with its founding decision: what it is for, and the one choice that shapes it. Leave its number off the title: it is given the story's next free one. Claim it before you build it.",
    z.object({
      story: id("story it belongs to"),
      title,
      description,
      depends_on: z.array(z.string().min(1)).optional().describe("The ids of capabilities it needs first"),
      founding,
    }),
    async ({ story, title: name, description: about, depends_on: dependsOn, founding: decision }, { library, writer }) => {
      const capability = await library.addCapability({ title: name, story, ...optional({ description: about, dependsOn }) }, writer);
      const book = await library.recordDecision({ ...decision, status: "accepted", frontCoverOf: capability.id }, writer);
      return {
        text: `Planned capability ${quoted(name)} (${capability.id}), founded on ${quoted(decision.title)} (${book.id}). Plan its contracts, then claim it before you build it.`,
        data: { id: capability.id, founding: book.id },
      };
    },
  );

  define(
    "plan_contract",
    "Plan a contract: one testable promise a capability makes. Leave its number off the title: it is given the capability's next free one, and a number another contract of the capability carries is refused. Write its test, see it fail, and report it red.",
    z.object({ capability: id("capability it belongs to"), title, description }),
    async ({ capability, title: name, description: about }, { library, writer }) => {
      const contract = await library.addContract({ title: name, capability, ...optional({ description: about }) }, writer);
      return { text: `Planned contract ${quoted(contract.fields.title)} (${contract.id}). Write its test, see it fail, and report it red.`, data: { id: contract.id } };
    },
  );

  define(
    "edit_plan",
    "Correct an arc, story, capability or contract in place: change only the fields you give.",
    z.object({
      id: id("arc, story, capability or contract to correct"),
      title: title.optional(),
      description,
      story: z.string().min(1).optional().describe("A capability's story, to move it"),
      capability: z.string().min(1).optional().describe("A contract's capability, to move it"),
      depends_on: z.array(z.string().min(1)).optional().describe("A capability's dependencies, replacing them"),
      stories: z.array(z.string().min(1)).optional().describe("An arc's stories, replacing them"),
      intent: intent.optional(),
      end_state: endState.optional(),
    }),
    async ({ id: target, ...changes }, call) => editPlan(target, changes, call),
  );

  define(
    "retire_from_plan",
    "Retire a capability or a contract that is no longer wanted, with the reason: it leaves the plan, and its history keeps it and the reason.",
    z.object({ id: id("capability or contract to retire"), reason: z.string().min(1).describe("Why it is retired, in a line") }),
    async ({ id: target, reason }, { library, writer }) => {
      const found = partOf(await library.projectTree(), target);
      if (found === undefined) return { text: `${target} is not a capability or a contract in this project's plan: only those are retired here.`, refused: true };
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

  define("show_plan", "See the plan: every story, capability and contract with its health, who holds what, and which sessions are about.", z.object({}), async (_args, call) =>
    showPlan(call),
  );

  define(
    "health_worklist",
    "See the oldest three capabilities that are not healthy, each with its reason, who moves it and since when, and how many more wait. One an open increment touches is already routed and not offered (ADR-0825 D4).",
    z.object({}),
    async (_args, { library }) => {
      const listed = await library.healthWorklist();
      if (listed.length === 0) return { text: "Nothing waits on the health worklist: every capability is healthy or already routed.", data: { items: [], more: 0 } };
      const items = listed.slice(0, 3);
      const more = listed.length - items.length;
      const lines = items.map(({ capability, title, status, why, since }) =>
        `Capability ${quoted(title)} (${capability}): ${status} — ${why.reason}, the ${why.mover}'s to move${why.contracts.length === 0 ? "" : `, carried by ${why.contracts.join(", ")}`}; since ${since.slice(0, 10)}`,
      );
      if (more > 0) lines.push(`${more} more wait.`);
      return { text: lines.join("\n"), data: { items, more } };
    },
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
}

/** The fields each kind of plan record can have corrected, as the tool names them. */
const EDITABLE = {
  story: ["title", "description"],
  capability: ["title", "description", "story", "depends_on"],
  contract: ["title", "description", "capability"],
  arc: ["title", "description", "stories", "intent", "end_state"],
} as const;

async function editPlan(target: string, changes: Changes, { library, writer }: Call): Promise<Answer> {
  const kind = kindOf(await library.projectTree(), target);
  if (kind === undefined) return { text: `Nothing in the plan has the id ${target}; show_plan lists every id.`, refused: true };
  const given = Object.entries(changes).filter(([, value]) => value !== undefined);
  const allowed: readonly string[] = EDITABLE[kind];
  const wrong = given.map(([field]) => field).filter((field) => !allowed.includes(field));
  if (wrong.length > 0) return { text: `A ${kind} has no ${wrong.join(" or ")} to correct; it has ${allowed.join(", ")}.`, refused: true };
  if (given.length === 0) return { text: `Nothing to correct: give the ${kind}'s ${allowed.join(", ")}.`, refused: true };
  const { depends_on: dependsOn, end_state: endState, ...rest } = changes;
  const fields = optional({ ...rest, dependsOn, endState });
  const edited =
    kind === "story"
      ? await library.editStory(target, fields, writer)
      : kind === "capability"
        ? await library.editCapability(target, fields, writer)
        : kind === "contract"
          ? await library.editContract(target, fields, writer)
          : await library.editArc(target, fields, writer);
  if (edited === null) return { text: `Nothing in the plan has the id ${target} any more.`, refused: true };
  return { text: `Corrected ${kind} ${quoted(edited.fields.title)} (${target}).`, data: { id: target } };
}

async function showPlan({ library, log, project, quietMs }: Call): Promise<Answer> {
  // Who holds what, and the sessions the running-sessions list shows: read from what decides them alone (contract 2.7).
  const [tree, views, claims, inView] = await Promise.all([library.projectTree(), library.arcViews(), readClaims(log, project, { quietMs }), readSessions(log, project, { quietMs, of: "in-view" })]);
  const incrementsOf = new Map(views.map((view) => [view.arc.id, view.increments]));
  const sessions = inView.filter((session) => session.listing !== "hidden");
  const holderOf = new Map(claims.map((claim) => [claim.capability ?? claim.increment, claim]));
  const heldBy = (id: string) => {
    const claim = holderOf.get(id);
    return claim === undefined ? "nobody holds it" : `held by ${claim.label} ${claim.session}${claim.holder === "idle" ? " (idle)" : ""}: ${claim.reason}`;
  };

  const out: string[] = [];
  if (tree.stories.length === 0) out.push(`The plan of ${quoted(project)} is empty: plan a story with plan_story.`);
  for (const story of tree.stories) {
    out.push(`Story ${quoted(story.title)} (${story.id}): ${healthOf(story.health)}`);
    for (const capability of story.capabilities) {
      out.push(`  Capability ${quoted(capability.title)} (${capability.id}): ${healthOf(capability.health)}; ${wordAndWhy(capability)}; ${heldBy(capability.id)}`);
      for (const contract of capability.contracts) out.push(`    Contract ${quoted(contract.title)} (${contract.id}): ${healthOf(contract.health)}`);
    }
  }
  for (const arc of tree.arcs) {
    out.push(`Arc ${quoted(arc.title)} (${arc.id}) grows ${arc.stories.length === 0 ? "no stories yet" : arc.stories.join(", ")}`);
    for (const increment of incrementsOf.get(arc.id) ?? []) {
      out.push(`  Increment ${quoted(increment.fields.title)} (${increment.id}): ${increment.fields.status}; ${heldBy(increment.id)}`);
    }
  }
  out.push(
    sessions.length === 0
      ? "No sessions yet."
      : `Sessions: ${sessions.map((session) => `${session.label} ${session.session}, ${session.state}${session.hooksRunning ? "" : ", hooks not running"}`).join("; ")}`,
  );
  return {
    text: out.join("\n"),
    data: {
      stories: tree.stories,
      arcs: tree.arcs,
      claims,
      sessions,
    },
  };
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
