/**
 * Capability 9 · Plan tools (the MCP server). The planning tools: plan an arc, a story, a capability or a contract, correct any of them, retire
 * a capability or a contract (ADR-0641 D2 step 3), and see the plan with its health, who holds what and which sessions are about. A story or capability is planned with its founding decision, the
 * first book on its shelf, so none planned here starts with an empty shelf (ADR-0627 D5).
 */
import { ANCHOR_ID, anchorGaps, CONTRACT_DEFINITION, CONTRACT_PROOFS, CONTRACT_PLACEMENT, LONG_CONTRACT_TITLE as LONG_CONTRACT, listedNotice, wordAndWhy, type AnnotatedTree, type Library, type DayWindow, type DecisionView, type HealthState, type NodeHealth } from "@storytree/library";
import { z } from "zod";

import { bareSaid, editPlanRecord, heldPending, heldSaid, holdPlanChange } from "@storytree/library/commands";
import { oversizedSaid } from "@storytree/arc-surface/verbs";
import { unimportedPackages, unimportedSentence } from "@storytree/app-setup/project";
import { elsewhereSaid, type MapNode } from "@storytree/map";
import { readMap } from "@storytree/map/read";
import { storyTests, SURVEYED_LANGUAGES, testedNumbers as testedNumbersIn, untestedContracts } from "@storytree/map/code-survey";
import { readClaims } from "@storytree/session-management";
import { readSessions } from "@storytree/session-management";
import type { Answer, Call, Define, ToolHost } from "./server.js";
import { quoted } from "./text.js";
import { incrementFields } from "./work-tools.js";

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
  .describe("On an imported story only, and required there: the folders and files of its imported project this capability covers, each from the imported folder (a folder covers everything under it); none may overlap another capability's of the story");

const provedBy = z
  .array(z.string().min(1))
  .min(1)
  .optional()
  .describe("The existing tests that prove it when they carry no contract number, as an imported repository's own: each a pytest node id (tests/test_api.py::TestAuth::test_login; a file or a class names every test it holds) or another runner's test or suite title");

const proof = z
  .object({
    by: z.enum(CONTRACT_PROOFS).describe("test-criterion when a test can see the answer (a stored record, a returned value, a refusal, a state change); agentic-user-acceptance-testing only when a user sees or does something on screen and no plain test can judge it"),
    reason: z.string().min(1).describe("Why, in a line"),
  })
  .optional()
  .describe("How the contract is proved, with a one-line reason (ADR-1294)");

const founding = z
  .object({
    title: z.string().min(1).describe("The one choice that shapes it, as a short title"),
    text: z.string().min(1).describe("What it is for, and why that choice"),
  })
  .describe("Its founding decision, the first book on its shelf: an object of a title, the one choice that shapes it as a short title, and a text, what it is for and why that choice");

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
    "Plan a story: something a user of the project can do, one package of its own, with its founding decision: what it is for, and the one choice that shapes it. Plan its capabilities next. A story is never a task: a task or ticket is an increment, with contracts on the capabilities it changes. On an existing codebase, call import_project first: each package it declares becomes an imported story, and this refuses while the project's folder declares packages none of which has a story; after it, plan a story only for a new package built on them. Never move or restructure a user's code to fit storytree: a flat repository imports as it stands, as one imported story.",
    z.object({ title, description, founding }),
    async ({ title: name, description: about, founding: decision }, { library, writer, folder }) => {
      // An existing codebase is imported before its stories are planned (9.23, ADR-0993, ADR-1071 D1).
      const unimported = await unimportedPackages(folder, library);
      if (unimported.length > 0) {
        return {
          text: `Not planned: ${unimportedSentence(unimported)} Call import_project with this project's folder first: each package it declares becomes an imported story, since a story is one package, and a flat repository with one manifest at its top is one story, imported in place: never move its code to fit storytree. Then plan a story only for a new package built on them; the work itself, such as a task, is an increment, with contracts on the capabilities it changes.`,
          refused: true,
          data: { unimported: unimported.map((one) => one.title) },
        };
      }
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
    "Plan a capability: one part that makes a story work, with its founding decision: what it is for, and the one choice that shapes it. Leave its number off the title: it is given the story's next free one. Claim it before you build it. On an imported story it is a capability you mapped there, drawn as its own territory: give the folders and files it covers. Where it starts and ends is your call; one overlapping another of the story's is refused, naming that one, so correct it with edit_plan rather than adding another.",
    z.object({
      story: id("story it belongs to"),
      title,
      description,
      depends_on: z.array(z.string().min(1)).optional().describe("The ids of capabilities it needs first"),
      covers,
      founding,
    }),
    async ({ story, title: name, description: about, depends_on: dependsOn, covers: paths, founding: decision }, call) => {
      const { library, writer } = call;
      const capability = await library.addCapability({ title: name, story, ...optional({ description: about, dependsOn, covers: paths }) }, { ...writer, pending: await heldPending(library, await claimsOf(call), call.caller.session) });
      const book = await library.recordDecision({ ...decision, status: "accepted", frontCoverOf: capability.id }, writer);
      return {
        text: `Planned capability ${quoted(name)} (${capability.id}), founded on ${quoted(decision.title)} (${book.id}). Plan its contracts, then claim it before you build it.`,
        data: { id: capability.id, founding: book.id },
      };
    },
  );

  define(
    "plan_contract",
    `Plan a contract: one testable guarantee a capability makes. ${CONTRACT_PLACEMENT} Leave its number off the title: it is given the capability's next free one, past the numbers its contracts and its story package's numbered tests carry, even a test no contract carries yet, since that test may prove another contract; the reply names those tests, so when this contract is the one a test proves you give that number in the title. It also counts the capability's other contracts no numbered test carries yet, planned but not built, which the focus tool lists: build one of those rather than plan it again. It names a test numbered for one that sits in another story's package, which credits that package's story, not this one. A number another contract of the capability carries is refused. Write its test, see it fail, and report it red. On an imported story, as you map each capability, plan a contract for what each of its existing tests checks, naming that test in proved_by and no number in its title: the repository's own tests then prove their contracts as they stand, so never rename or edit them.`,
    z.object({
      capability: id("capability it belongs to").optional(),
      edge: id("edge it belongs to instead, a link inside one story: a loose contract, even one line, on how one capability depends on the other, numbered from the dependent capability").optional(),
      title,
      description,
      proved_by: provedBy,
      proof,
      increment: id("open increment that makes it true: the contract joins its links, so selecting its arc rings the gate of the part or edge it pins").optional(),
    }),
    async ({ capability, edge, title: name, description: about, proved_by: proved, proof: how, increment }, call) => {
      if ((capability === undefined) === (edge === undefined)) return { text: "Give the capability the contract belongs to, or the edge: one of them.", refused: true };
      // The increment is checked before anything is written, so a wrong one leaves no contract behind (9.31).
      const work = increment === undefined ? undefined : await call.library.get(increment);
      const cited = (work?.fields as { links?: string[] } | undefined)?.links ?? [];
      if (increment !== undefined && (work?.type !== "increment" || (work.fields as { status?: string }).status === "closed")) {
        return { text: `${increment} is not an open increment, so no contract was planned: give the open increment that makes it true, or none.`, refused: true };
      }
      // An open increment's links naming a contract are what ring its gate when the arc is selected (ADR-1279 D4).
      const linked = async (contract: string): Promise<string> => {
        if (increment === undefined) return "";
        await call.library.editIncrement(increment, { links: [...cited, contract] }, call.writer);
        return ` It joins ${increment}'s links, so selecting that increment's arc rings its gate.`;
      };
      const tree = await call.library.projectTree();
      if (edge !== undefined) {
        // An edge's contract is numbered from its dependent capability, past that capability's tests, so a test can carry it.
        const from = tree.stories.flatMap((story) => story.edges ?? []).find((one) => one.id === edge)?.from;
        const tested = from === undefined ? [] : await testedNumbers(call, from, tree);
        const contract = await call.library.addContract({ title: name, edge, ...optional({ description: about, provedBy: proved, proof: how }) }, { ...call.writer, testedNumbers: tested });
        const number = /^(\d+\.\d+) · /.exec(contract.fields.title)?.[1];
        const naming = number === undefined ? " A test named in its proved_by proves it" : ` A test titled "${number} · …", or named in proved_by, proves it`;
        return { text: `Planned contract ${quoted(contract.fields.title)} (${contract.id}) on edge ${edge}.${naming} under \`storytree health local\`.${await linked(contract.id)}`, data: { id: contract.id } };
      }
      const owner = capability!;
      const tested = await testedNumbers(call, owner, tree);
      const contract = await call.library.addContract({ title: name, capability: owner, ...optional({ description: about, provedBy: proved, proof: how }) }, { ...call.writer, testedNumbers: tested });
      const joined = await linked(contract.id);
      const orphans = await orphanTests(call, owner, contract.fields.title, tested);
      const named = orphans.length === 0 ? "" : ` Numbered ${orphans.length === 1 ? `test ${orphans[0]} has` : `tests ${orphans.slice(0, -1).join(", ")} and ${orphans.at(-1)} have`} no contract: if this contract is the one ${orphans.length === 1 ? "it proves" : "one proves"}, give it that number with edit_plan.`;
      const untested = untestedContracts(tree, owner, tested);
      // Counted, not named, so the reply stays short however many there are (9.13, F2.10).
      const one = untested.length === 1;
      const open = untested.length === 0 ? "" : ` ${untested.length} other ${one ? "contract" : "contracts"} of this capability ${one ? "has" : "have"} no test yet. If this one repeats ${one ? "it" : "any of them"}, retire it and build that one (list ${one ? "it" : "them"} with \`focus\`, select "cap:${owner}", down 1, kind contract).`;
      const elsewhere = await testsElsewhere(call, owner, untested);
      const strays = Object.entries(elsewhere).map(([title, tests]) => ` ${quoted(title)}: ${tests.map(elsewhereSaid).join("; ")}.`).join("");
      const long = contract.fields.title.length > LONG_CONTRACT;
      const advice = long ? ` Its title runs past ${LONG_CONTRACT} characters, which often means more than one contract: ${CONTRACT_DEFINITION} Split it with edit_plan and plan_contract if so.` : "";
      // A contract its existing tests prove asks for no test: their results credit it when the project's tests next run (9.27).
      const build = proved === undefined
        ? " Write its test, see it fail, and report it red."
        : ` ${proved.length === 1 ? proved[0] : `${proved.slice(0, -1).join(", ")} and ${proved.at(-1)}`} already ${proved.length === 1 ? "exists" : "exist"}, so write no test for it: ${proved.length === 1 ? "its result credits" : "their results credit"} it at the project's next test run, \`storytree health local\` in your shell.`;
      return { text: `Planned contract ${quoted(contract.fields.title)} (${contract.id}).${joined}${named}${open}${strays}${advice}${build}`, data: { id: contract.id, orphans, untested, long, ...(strays === "" ? {} : { elsewhere }) } };
    },
  );

  define(
    "plan_edge",
    "Plan an edge: a link inside one story, where one capability depends on another of the same story, as a record that holds its own contracts (ADR-1282): plan_contract with edge then adds a loose contract, even one line, on how the one depends on the other, apart from either capability's own. A capability's depends_on lists it like any other link. A link between two stories is no edge: give it as the capability's depends_on.",
    z.object({
      from: id("capability that depends on the other"),
      to: id("capability it depends on, of the same story"),
      description: z.string().min(1).optional().describe("A sentence on what passes between them"),
    }),
    async ({ from, to, description: about }, { library, writer }) => {
      // A depends_on inside one story is already an edge (ADR-1282 D1), so the link the agent means is that one (F3.6).
      const tree = await library.projectTree();
      const there = tree.stories.flatMap((story) => story.edges ?? []).find((edge) => edge.from === from && edge.to === to);
      if (there !== undefined) {
        if (about !== undefined) await library.editEdge(there.id, { description: about }, writer);
        const titled = (id: string): string => quoted(capabilityTitle(tree, id) ?? id);
        return { text: `${titled(from)} already depends on ${titled(to)} through edge ${there.id}, which holds the link's contracts${about === undefined ? "" : ", and now its description"}. Plan them with plan_contract and edge ${there.id}.`, data: { id: there.id } };
      }
      const edge = await library.addEdge({ from, to, ...optional({ description: about }) }, writer);
      return { text: `Planned edge ${edge.id}: ${from} depends on ${to}. Plan its contracts with plan_contract and edge ${edge.id}.`, data: { id: edge.id } };
    },
  );

  define(
    "edit_plan",
    `Correct an arc, story, capability, contract or increment in place, or the project's anchor (id ${ANCHOR_ID}: what it is, and its audience, who it is for): change only the fields you give. An increment's capabilities list is filled here by the session that claims it, as it plans (ADR-0949 D2), and its objective and body, its breakdown, are rewritten here. While you hold an increment claimed on a branch, a change to a story, capability or contract planned before it waits on the increment as a pending change until its branch merges, and the live plan is unchanged (ADR-0966); one claimed on no branch or the main line has none to merge, so its changes are live; one it planned changes at once, and so does one given live: true, with the increment's claim kept.`,
    z.object({
      id: id(`arc, story, capability, contract or increment to correct, or ${ANCHOR_ID} for the project's anchor`),
      what: z.string().min(1).optional().describe("The project's anchor: what it is, in a few words (\"a software factory\")"),
      audience,
      title: title.optional(),
      description,
      story: z.string().min(1).optional().describe("A capability's story, to move it"),
      capability: z.string().min(1).optional().describe("A contract's capability, to move it: with no title given, a contract whose number is another capability's takes this one's next free number"),
      edge: z.string().min(1).optional().describe("A contract's edge, to move it onto that link inside its story"),
      depends_on: z.array(z.string().min(1)).optional().describe("A capability's dependencies, replacing them"),
      covers: covers.describe("An imported story's capability's folders and files, replacing them"),
      proved_by: provedBy.describe("A contract's existing tests that prove it, replacing them"),
      proof: proof.describe("How a contract is proved, with a one-line reason (ADR-1294), replacing it"),
      stories: z.array(z.string().min(1)).optional().describe("An arc's stories, replacing them"),
      intent: intent.optional(),
      end_state: endState.optional(),
      priority: z
        .union([z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), z.literal("none")])
        .optional()
        .describe("An arc's priority: a whole number, 1 first, or \"none\" to clear it; an arc with none comes after every arc that has one (ADR-0963)"),
      objective: z.string().min(1).optional().describe("What an increment delivers, in a sentence"),
      body: z.string().min(1).optional().describe("An increment's body, replacing it: how the work breaks down"),
      capabilities: z.array(z.string().min(1)).optional().describe("An increment's capabilities, replacing them: the ones it changes, and nothing else"),
      links: z.array(z.string().min(1)).optional().describe("An increment's links, replacing them: its stories, notes or decisions, and the contracts it makes true"),
      machine: z.string().min(1).optional().describe("The one machine that can take an increment, by the short name Machines knows it by, \"cloud\" for work only a cloud container can prove (no dispatcher takes it), or \"none\" to clear it, so any machine can"),
      escape: z
        .union([z.object({ caused_by: z.string().min(1).describe("The pull request (#123) or increment that caused it"), commit: z.string().min(1).optional().describe("A pull request's merge commit, required with one, since pull-request numbers restarted at #2 on 2026-10-26"), story: z.string().min(1).describe("The story it hit") }), z.literal("none")])
        .optional()
        .describe("The escape an increment fixes, a defect that reached main: the change that caused it and the story it hit, or \"none\" to clear it"),
      live: z.boolean().optional().describe("While you hold an increment, make this change to a story, capability or contract live instead of pending, keeping the increment's claim: for a correction the increment does not change"),
    }),
    async ({ id: target, live, ...changes }, call) => editPlan(target, changes, call, live === true),
  );

  define(
    "retire_from_plan",
    "Retire a capability, a contract or an edge that is no longer wanted, with the reason: it leaves the plan, and its history keeps it and the reason. While you hold an increment, one planned before it is retired when the increment's branch merges, waiting until then as a pending change (ADR-0966).",
    z.object({ id: id("capability, contract or edge to retire"), reason: z.string().min(1).describe("Why it is retired, in a line") }),
    async ({ id: target, reason }, call) => {
      const { library, writer } = call;
      const found = partOf(await library.projectTree(), target);
      if (found === undefined) return { text: `${target} is not a capability, contract or edge in this project's plan: only those are retired here.`, refused: true };
      // An edge is retired live: an increment holds pending changes only to stories, capabilities and contracts (ADR-0966 D1).
      const held = found.kind === "edge" ? undefined : await holdPlanChange(library, await claimsOf(call), call.caller.session, { record: target, retire: reason }, writer);
      if (held !== undefined) return { text: `Retiring ${found.kind} ${quoted(found.title)} (${target}) is ${heldSaid(held)}`, data: { id: target } };
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
    "See the plan: every story, capability and contract with its health, who holds what, which sessions are about, and the live arcs with those closed yesterday or today. Give closed, or from and to, for only the arcs closed in that window instead. A plan too large to read whole is given as an overview, each story and arc counted: give id for one story, capability or arc whole.",
    z.object({
      id: z.string().optional().describe("A story's, a capability's or an arc's id: that part of the plan whole, instead of the whole plan"),
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
  edge?: string | undefined;
  depends_on?: string[] | undefined;
  proved_by?: string[] | undefined;
  proof?: { by: (typeof CONTRACT_PROOFS)[number]; reason: string } | undefined;
  stories?: string[] | undefined;
  intent?: string | undefined;
  end_state?: string | undefined;
  priority?: number | "none" | undefined;
  objective?: string | undefined;
  body?: string | undefined;
  capabilities?: string[] | undefined;
  links?: string[] | undefined;
  machine?: string | undefined;
  escape?: { caused_by: string; commit?: string | undefined; story: string } | "none" | undefined;
  what?: string | undefined;
  audience?: string | undefined;
}

/** The fields each kind of plan record can have corrected, as the tool names them. */
const EDITABLE = {
  story: ["title", "description"],
  capability: ["title", "description", "story", "depends_on", "covers"],
  contract: ["title", "description", "capability", "edge", "proved_by", "proof"],
  edge: ["description"],
  arc: ["title", "description", "stories", "intent", "end_state", "priority"],
  increment: ["title", "objective", "body", "capabilities", "links", "machine", "escape"],
  anchor: ["what", "audience"],
} as const;

async function editPlan(target: string, changes: Changes, call: Call, live = false): Promise<Answer> {
  const { library, writer } = call;
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
  const { depends_on: dependsOn, end_state: endState, proved_by: provedBy, priority, capabilities, machine, escape, ...rest } = changes;
  const own = kind === "increment" ? await incrementFields(target, { capabilities, machine, escape }, call) : { fields: {} };
  if ("refused" in own) return own.refused;
  // "none" clears an arc's priority: the library removes a field given as undefined (ADR-0963 D3).
  const fields = {
    ...optional({ ...rest, dependsOn, endState, provedBy }),
    ...(priority === undefined ? {} : { priority: priority === "none" ? undefined : priority }),
    ...own.fields,
  };
  const listing = (fields as { capabilities?: string[] }).capabilities;
  const had = kind !== "increment" || listing === undefined ? [] : ((await library.get(target))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
  // A contract moved to another capability with no title given takes that capability's next number, past its tests (4.45).
  const move = kind === "contract" && changes.capability !== undefined && changes.title === undefined ? await movedNumber(target, changes.capability, call) : undefined;
  const options = move === undefined ? writer : { ...writer, testedNumbers: move.tested };
  // The part a contract moved onto a link leaves, said when the move leaves it with none of its own (9.37).
  const leaves = kind === "contract" && changes.edge !== undefined ? ((await library.get(target))?.fields as { capability?: string } | undefined)?.capability : undefined;
  const done = await editPlanRecord(library, await claimsOf(call), call.caller.session, { type: kind, id: target, fields, live }, options);
  if (done === null) return { text: `Nothing in the plan has the id ${target} any more.`, refused: true };
  if ("held" in done) {
    const renumbers = move?.renumbers === true ? ` Its number ${move.from} is not its new capability's, so it takes that capability's next free number when the change applies: rename its tests' titles to that number then.` : "";
    return { text: `Your change to ${kind} ${quoted(String(((await library.get(target))?.fields as { title?: string } | undefined)?.title))} (${target}) is ${heldSaid(done.held)}${renumbers}`, data: { id: target } };
  }
  const title = (done.edited.fields as { title: string }).title;
  const to = /^(\d+\.\d+) · /.exec(title)?.[1];
  const renumbered = move?.from !== undefined && to !== undefined && to !== move.from ? ` Renumbered ${move.from} to ${to}: rename its tests' titles to ${to}, since a test's number is what credits its contract.` : "";
  // Told, not refused, of another open increment already listing a capability this one newly lists (10.35, ADR-1228).
  const shared = kind === "increment" ? await library.openListing((listing ?? []).filter((capability) => !had.includes(capability)), target) : [];
  const placed = kind === "contract" && to !== undefined && (changes.capability !== undefined || changes.edge !== undefined) ? placedSaid(await library.projectTree(), target, to) : "";
  const bare = await bareSaid(library, leaves, "plan_contract");
  return { text: [`Corrected ${kind} ${quoted(title)} (${target})${placed === "" ? "." : `: ${placed}`}${renumbered}${bare}`, ...shared.map((other) => `${listedNotice(other)}.`)].join("\n"), data: { id: target } };
}

/**
 * What moving contract `id` to `capability` does to its number: the number it carries, whether that number's leading
 * part is not the capability's (so the move renumbers it), and the capability's tested numbers, which the new one is past.
 */
async function movedNumber(id: string, capability: string, call: Call): Promise<{ from?: string; renumbers: boolean; tested: string[] }> {
  const tree = await call.library.projectTree();
  const titleOf = (want: string) => tree.stories.flatMap((story) => story.capabilities).find((one) => one.id === want)?.title;
  const own = ((await call.library.get(id))?.fields as { title?: string } | undefined)?.title ?? "";
  const from = /^(\d+\.\d+)(?![\d.])/.exec(own)?.[1];
  const prefix = /^(\d+) · /.exec(titleOf(capability) ?? "")?.[1];
  const renumbers = from !== undefined && prefix !== undefined && !from.startsWith(`${prefix}.`);
  return { ...(from === undefined ? {} : { from }), renumbers, tested: renumbers ? await testedNumbers(call, capability, tree) : [] };
}

/** The project's claims, as the calling door reads them. */
function claimsOf({ log, project, quietMs }: Call): ReturnType<typeof readClaims> {
  return readClaims(log, project, { quietMs });
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
export async function planAnswer(
  reading: PlanReading,
  { closed, from, to, id }: { closed?: "today" | "yesterday" | "week" | undefined; from?: string | undefined; to?: string | undefined; id?: string | undefined },
  budget = PLAN_BUDGET,
): Promise<Answer> {
  if (id !== undefined && (closed !== undefined || from !== undefined || to !== undefined)) return { text: "Give an id, or a closing window (closed, or from and to), not both.", refused: true };
  const window = closedWindowOf(closed, from, to, Date.now());
  return typeof window === "string" ? { text: window, refused: true } : showPlan(reading, window, id, budget);
}

async function showPlan({ library, log, project, quietMs }: PlanReading, closed: DayWindow | undefined, id: string | undefined, budget: number): Promise<Answer> {
  // Who holds what, and the sessions the running-sessions list shows: read from what decides them alone (contract 2.7).
  // The arcs as the board reads them (10.22): live ones and the recently closed, or a window's closed arcs alone.
  const now = Date.now();
  const arcRead = closed === undefined ? library.boardArcs({ from: dayOf(now, -1), to: dayOf(now, 1) }) : library.closedArcs(closed);
  const [tree, views, claims, inView, decisions] = await Promise.all([library.projectTree(), arcRead, readClaims(log, project, { quietMs }), readSessions(log, project, { quietMs, of: "in-view" }), library.decisions()]);
  const shelfOf = shelvesOf(decisions);
  const closedOn = new Map(views.map((view) => [view.arc.id, view.closed]));
  const arcs = tree.arcs.filter((arc) => closedOn.has(arc.id));
  const incrementsOf = new Map<string, readonly { id: string; fields: { title: string; status: string } }[]>(views.map((view) => [view.arc.id, view.increments]));
  const sessions = inView.filter((session) => session.listing !== "hidden");
  const holderOf = new Map(claims.map((claim) => [claim.capability ?? claim.increment, claim]));
  const heldBy = (id: string) => {
    const claim = holderOf.get(id);
    return claim === undefined ? "nobody holds it" : `held by ${claim.label} ${claim.session}${claim.holder === "idle" ? " (idle)" : ""}: ${claim.reason}`;
  };
  type Story = AnnotatedTree["stories"][number];
  type Capability = Story["capabilities"][number];
  // A mapped story carries no health of its own (ADR-0993 D3): it says what it is instead.
  const storyLine = (story: Story) => `Story ${quoted(story.title)} (${story.id}): ${story.mapped === undefined ? healthOf(story.health) : "imported: here before storytree, and assumed to be working"}`;
  const capabilityLine = (capability: Capability) => `  Capability ${quoted(capability.title)} (${capability.id}): ${healthOf(capability.health)}; ${wordAndWhy(capability)}; ${heldBy(capability.id)}`;
  const capabilityLines = (capability: Capability) => [
    capabilityLine(capability),
    // Its reason, for the agent to read before it changes the part (F3.8, ADR-0627): what it is for, and its shelf.
    capability.description === undefined ? "    No description yet: say what it is for with edit_plan." : `    About: ${capability.description.replace(/\s+/g, " ").trim()}`,
    `    ${shelfSaid(capability.id, shelfOf.get(capability.id) ?? [])}`,
    ...capability.contracts.map((contract) => `    Contract ${quoted(contract.title)} (${contract.id}): ${healthOf(contract.health)}; ${proofSaid(contract)}`),
  ];
  // Its edges, each a link inside the story holding its own contracts (ADR-1282 D1).
  const edgeLines = (story: Story, edges: Story["edges"]) => {
    const titleOf = new Map(story.capabilities.map((capability) => [capability.id, capability.title]));
    return (edges ?? []).flatMap((edge) => [
      `  Edge (${edge.id}): ${quoted(titleOf.get(edge.from) ?? edge.from)} depends on ${quoted(titleOf.get(edge.to) ?? edge.to)}${edge.description === undefined ? "" : `: ${edge.description}`}`,
      ...edge.contracts.map((contract) => `    Contract ${quoted(contract.title)} (${contract.id}): ${proofSaid(contract)}`),
    ]);
  };
  const storyLines = (story: Story) => [storyLine(story), ...story.capabilities.flatMap(capabilityLines), ...edgeLines(story, story.edges)];
  const shelved = (story: Story, capabilities = story.capabilities) => ({ ...story, capabilities: capabilities.map((capability) => ({ ...capability, decisions: shelfOf.get(capability.id) ?? [] })) });
  const priorityOf = new Map(views.map((view) => [view.arc.id, view.arc.fields.priority]));
  const arcLine = (arc: (typeof tree.arcs)[number]) => {
    const priority = priorityOf.get(arc.id);
    const day = closedOn.get(arc.id);
    return `Arc ${quoted(arc.title)} (${arc.id})${priority === undefined ? "" : `, priority ${priority},`}${day === undefined ? "" : `, closed ${day},`} grows ${arc.stories.length === 0 ? "no stories yet" : arc.stories.join(", ")}`;
  };
  const arcLines = (arc: (typeof tree.arcs)[number], increments: readonly { id: string; fields: { title: string; status: string } }[]) => {
    const oversized = oversizedSaid(increments.length);
    return [arcLine(arc), ...(oversized === undefined ? [] : [`  ${oversized}`]), ...increments.map((increment) => `  Increment ${quoted(increment.fields.title)} (${increment.id}): ${increment.fields.status}; ${heldBy(increment.id)}`)];
  };

  // One part of the plan whole, named by its id (9.40): a story, a capability or an arc.
  if (id !== undefined) {
    for (const story of tree.stories) {
      if (story.id === id) {
        const whole: Answer = { text: storyLines(story).join("\n"), data: { stories: [shelved(story)] } };
        if (sizeOf(whole) <= budget) return whole;
        // A story too large to give whole is given capability by capability, its contracts counted.
        const counted = story.capabilities.map((capability) => `${capabilityLine(capability)}; ${countSaid(capability.contracts.length, "contract")}`);
        return {
          text: [storyLine(story), ...counted, `The story runs past ${budget.toLocaleString("en")} characters whole: give show_plan a capability's id to read that capability whole.`].join("\n"),
          data: { stories: [{ id: story.id, title: story.title, health: story.health, capabilities: story.capabilities.map((capability) => ({ id: capability.id, title: capability.title, health: capability.health, contracts: capability.contracts.length })) }] },
        };
      }
      const capability = story.capabilities.find((one) => one.id === id);
      if (capability !== undefined) {
        const edges = (story.edges ?? []).filter((edge) => edge.from === id || edge.to === id);
        return { text: [storyLine(story), ...capabilityLines(capability), ...edgeLines(story, edges)].join("\n"), data: { stories: [{ ...shelved(story, [capability]), edges }] } };
      }
    }
    const arc = tree.arcs.find((one) => one.id === id);
    if (arc === undefined) return { text: `Nothing in the plan has the id ${id}: give show_plan a story's, a capability's or an arc's id, or none for the whole plan.`, refused: true };
    const increments = incrementsOf.get(id) ?? (await library.arcView(id))?.increments ?? [];
    return { text: arcLines(arc, increments).join("\n"), data: { arcs: [arc], increments: increments.map((increment) => ({ id: increment.id, title: increment.fields.title, status: increment.fields.status })) } };
  }

  const head: string[] = [];
  const gaps = anchorGaps(tree);
  head.push(tree.anchor === undefined ? `The project has no anchor yet (${ANCHOR_ID}): say what it is and who it is for with edit_plan.` : `Anchor (${ANCHOR_ID}): ${anchorLine(tree.anchor)}`);
  const unsaid = [
    ...(gaps.anchor.length === 1 ? [`the anchor does not yet say ${gaps.anchor[0] === "what" ? "what the project is" : "who it is for"}`] : []),
  ];
  if (unsaid.length > 0) head.push(`Plan health (it fails nothing): ${unsaid.join("; ")}.`);
  if (tree.stories.length === 0) head.push(`The plan of ${quoted(project)} is empty: plan a story with plan_story.`);
  // Ranked arcs first, 1 first; the sort is stable, so the unranked and each priority's arcs keep creation order (ADR-0963 D2).
  const rank = (id: string) => priorityOf.get(id) ?? Infinity;
  const ranked = [...arcs].sort((one, other) => rank(one.id) - rank(other.id) || 0);
  const sessionsLine =
    sessions.length === 0
      ? "No sessions yet."
      : `Sessions: ${sessions.map((session) => `${session.label} ${session.session}, ${session.state}${session.tier === "connected" ? ", connected" : session.hooksRunning ? "" : ", hooks not running"}`).join("; ")}`;
  const anchor = tree.anchor === undefined ? {} : { anchor: tree.anchor };
  const full: Answer = {
    text: [...head, ...tree.stories.flatMap(storyLines), ...ranked.flatMap((arc) => arcLines(arc, incrementsOf.get(arc.id) ?? [])), sessionsLine].join("\n"),
    data: { ...anchor, gaps, stories: tree.stories.map((story) => shelved(story)), arcs, claims, sessions },
  };
  if (sizeOf(full) <= budget) return full;

  // A plan too large to read whole is given as its overview (9.39): each story and arc counted, and how to read one whole.
  const contractsIn = (story: Story) => story.capabilities.reduce((sum, capability) => sum + capability.contracts.length, 0) + (story.edges ?? []).reduce((sum, edge) => sum + edge.contracts.length, 0);
  const statusesOf = (arc: string) => {
    const counts: Record<string, number> = {};
    for (const increment of incrementsOf.get(arc) ?? []) counts[increment.fields.status] = (counts[increment.fields.status] ?? 0) + 1;
    return counts;
  };
  const statusesSaid = (counts: Record<string, number>) => Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ");
  const sessionStates: Record<string, number> = {};
  for (const session of sessions) sessionStates[session.state] = (sessionStates[session.state] ?? 0) + 1;
  return {
    text: [
      ...head,
      `The whole plan runs past ${budget.toLocaleString("en")} characters, so this is its overview, each story and arc counted: give show_plan a story's, a capability's or an arc's id to read that part whole.`,
      ...tree.stories.map((story) => `${storyLine(story)}; ${countSaid(story.capabilities.length, "capability", "capabilities")}, ${countSaid(contractsIn(story), "contract")}`),
      ...ranked.map((arc) => {
        const counts = statusesOf(arc.id);
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        return `${arcLine(arc)}; ${countSaid(total, "increment")}${total === 0 ? "" : `: ${statusesSaid(counts)}`}`;
      }),
      sessions.length === 0 ? "No sessions yet." : `Sessions: ${countSaid(sessions.length, "session")}, ${statusesSaid(sessionStates)}; the sessions list names each.`,
    ].join("\n"),
    data: {
      ...anchor,
      gaps,
      overview: true,
      stories: tree.stories.map((story) => ({ id: story.id, title: story.title, health: story.health, ...(story.mapped === undefined ? {} : { mapped: story.mapped }), capabilities: story.capabilities.length, contracts: contractsIn(story) })),
      arcs: ranked.map((arc) => ({ id: arc.id, title: arc.title, ...(priorityOf.get(arc.id) === undefined ? {} : { priority: priorityOf.get(arc.id) }), ...(closedOn.get(arc.id) === undefined ? {} : { closed: closedOn.get(arc.id) }), increments: statusesOf(arc.id) })),
      claims,
      sessions: sessionStates,
    },
  };
}

/** How many characters a show_plan answer may run to, its text and its data as JSON together, before it gives less (friction_f258e77c3ff7). */
export const PLAN_BUDGET = 40_000;

/** An answer's size as the harness receives it: its text, and its data as JSON. */
function sizeOf(answer: Answer): number {
  return answer.text.length + (answer.data === undefined ? 0 : JSON.stringify(answer.data).length);
}

/** A count with its noun, one or many. */
function countSaid(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A decision on a shelf as show_plan gives it: enough to read it whole with open or library read. */
interface Spine {
  id: string;
  title: string;
  number?: number;
}

/** Every story's and capability's shelf (ADR-0627): its live front covers, founding first, a superseded one left for its successor. */
function shelvesOf(decisions: readonly DecisionView[]): Map<string, Spine[]> {
  const shelves = new Map<string, Spine[]>();
  for (const { record, status } of decisions) {
    const node = record.fields.frontCoverOf;
    if (node === undefined || status === "superseded") continue;
    const { title, number } = record.fields;
    shelves.set(node, [...(shelves.get(node) ?? []), { id: record.id, title, ...(number === undefined ? {} : { number }) }]);
  }
  return shelves;
}

/** How many of a shelf's decisions show_plan names before it counts the rest, so a large shelf cannot flood the reply. */
const SHELF_SHOWN = 4;

/** A capability's shelf in one line: its founding decision, then the next few, each by title and id, the rest counted. */
function shelfSaid(id: string, shelf: readonly Spine[]): string {
  if (shelf.length === 0) return "No decision on its shelf yet: record its founding decision with write_note.";
  const spine = ({ id: decision, title, number }: Spine) => `${quoted(title)} (${decision}${number === undefined ? "" : `, ADR-${String(number).padStart(4, "0")}`})`;
  const [founding, ...rest] = shelf.slice(0, SHELF_SHOWN);
  const more = shelf.length - SHELF_SHOWN;
  return `Decisions: founded on ${spine(founding!)}${rest.length === 0 ? "" : `; also ${rest.map(spine).join(", ")}`}${more > 0 ? `, and ${more} more (open ${id} lists them)` : ""}.`;
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
    for (const edge of story.edges ?? []) {
      if (edge.id === id) return "edge";
      if (edge.contracts.some((contract) => contract.id === id)) return "contract";
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

/**
 * The tests numbered for each of `untested`, `capability`'s contracts no test of its story's packages proves, that sit in a
 * dependent story's package, as the map reads the checkout the session works in; none to read when nothing is untested.
 */
async function testsElsewhere({ library, folder }: Call, capability: string, untested: readonly string[]): Promise<Record<string, NonNullable<MapNode["elsewhere"]>>> {
  if (untested.length === 0) return {};
  const graph = await readMap(library, folder);
  const ids = new Set(graph.edges.filter((edge) => edge.kind === "belongs-to" && edge.to === capability).map((edge) => edge.from));
  return Object.fromEntries(graph.nodes.filter((node) => ids.has(node.id) && untested.includes(node.title) && node.elsewhere !== undefined).map((node) => [node.title, node.elsewhere!]));
}

/** `fields` without the ones that are undefined: the library's inputs take no undefined values. */
function optional<T extends Record<string, unknown>>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** The title of capability `id` in `tree`, when it has one. */
function capabilityTitle(tree: AnnotatedTree, id: string): string | undefined {
  return tree.stories.flatMap((story) => story.capabilities).find((capability) => capability.id === id)?.title;
}

/**
 * Where moved contract `id`, numbered `number`, now sits and the test title that proves it there (F3.7): a test's number
 * credits a contract across its story, so one moved onto an edge keeps its tests, though its number may be another part's.
 */
function placedSaid(tree: AnnotatedTree, id: string, number: string): string {
  const proves = (still: string): string => ` A test titled "${number} · …", or named in proved_by, ${still}proves it there under \`storytree health local\`.`;
  for (const story of tree.stories) {
    const capability = story.capabilities.find((node) => node.contracts.some((contract) => contract.id === id));
    if (capability !== undefined) return `now on capability ${quoted(capability.title)}.${proves("")}`;
    const edge = (story.edges ?? []).find((node) => node.contracts.some((contract) => contract.id === id));
    if (edge === undefined) continue;
    const from = capabilityTitle(tree, edge.from) ?? edge.from;
    const to = capabilityTitle(tree, edge.to) ?? edge.to;
    const owner = story.capabilities.find((node) => /^(\d+) · /.exec(node.title)?.[1] === number.split(".")[0]);
    const foreign = owner === undefined || owner.id === edge.from ? "" : ` Its number ${number} is ${quoted(owner.title)}'s, not the link's: the link's own contracts take ${quoted(from)}'s numbers, so retitle it with edit_plan if you want one of those.`;
    return `now on edge ${quoted(from)} → ${quoted(to)} (${edge.id}).${proves("still ")}${foreign}`;
  }
  return "";
}

/** The capability or contract `id` names in the plan, if it names one. */
function partOf(tree: AnnotatedTree, id: string): { kind: "capability" | "contract" | "edge"; title: string } | undefined {
  for (const capability of tree.stories.flatMap((story) => story.capabilities)) {
    if (capability.id === id) return { kind: "capability", title: capability.title };
    const contract = capability.contracts.find((node) => node.id === id);
    if (contract !== undefined) return { kind: "contract", title: contract.title };
  }
  for (const edge of tree.stories.flatMap((story) => story.edges ?? [])) {
    if (edge.id === id) return { kind: "edge", title: `${edge.from} depends on ${edge.to}` };
    const contract = edge.contracts.find((node) => node.id === id);
    if (contract !== undefined) return { kind: "contract", title: contract.title };
  }
  return undefined;
}

/**
 * The titles of `capability`'s planned contracts that no numbered test in its story's package names, in the
 * checkout the session works in, read with the map's survey as CI health reads proofs, and whether that package was
 * seen there at all (unseen, every planned contract is named, none proven missing), with the languages that leave it
 * unseen when the checkout's code is only in languages the survey cannot read; none for a capability the plan
 * lacks. A title prefixed with another package proves that package's contracts, not these. A mapped story's tests are
 * read where it was imported from: the checkout itself, or a folder this machine imports.
 */
export async function untestedOf(capability: string, { folder, library, storytree, project }: Call, imports: ToolHost["imports"]): Promise<{ titles: string[]; seen: boolean; unreadable?: { languages: string[]; reads: readonly string[] } }> {
  const tree = await library.projectTree();
  // The survey reads the checkout `folder` is in, from its top.
  const { numbers, seen, unreadable } = await storyTests(folder, tree, capability, { imports: await imports(storytree, project) });
  return { titles: untestedContracts(tree, capability, numbers), seen, ...(unreadable === undefined ? {} : { unreadable: { languages: unreadable, reads: SURVEYED_LANGUAGES } }) };
}

/** The contract numbers the numbered tests in `capability`'s story package carry, in the checkout the session works in, read against `tree`. */
async function testedNumbers({ folder }: Call, capability: string, tree: Awaited<ReturnType<Library["projectTree"]>>): Promise<string[]> {
  // The survey reads the checkout `folder` is in, from its top.
  return testedNumbersIn(folder, tree, capability);
}

/** How a contract is proved, in full words (ADR-1294), or that its story-author has not chosen yet. */
function proofSaid(contract: { proof?: { by: (typeof CONTRACT_PROOFS)[number]; reason: string } }): string {
  if (contract.proof === undefined) return "how it is proved is not chosen yet";
  return `proved by ${contract.proof.by === "test-criterion" ? "a test criterion" : "agentic user acceptance testing"}: ${contract.proof.reason}`;
}
