/**
 * Capability 17 · Friction, its verbs (ADR-1097). The `friction` and `resteer` verbs, declared once here
 * (ADR-0969 D2) and mounted by both front doors: by the command line as its families of those names, 13th and 14th
 * (ADR-1033), and by the MCP server as the tools record_friction, reinforce, friction_drain, route and record_resteer.
 * File friction or a re-steer, add a recurrence, and drain and route the friction a landing's pass judges.
 */
import type { FieldsOf } from "@storytree/library";
import { verb, type VerbContext, type VerbFamily } from "@storytree/library/verbs";

/** A field's value as given: JSON for a list, else the text. */
function listOf(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // Not JSON: read it as comma-separated ids.
    }
  }
  return text.split(",").map((id) => id.trim()).filter(Boolean);
}

/** The fields given, each under its camel-cased name, and the links as a list: capture takes only its own fields. */
function fields(given: Readonly<Record<string, string | undefined>>): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) continue;
    named[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = name === "links" ? listOf(value) : value;
  }
  return named;
}

/** The branch checked out in `folder`, or "(no branch)". */
async function branchIn(folder: string): Promise<string> {
  const { runGit } = await import("../activity/git.js");
  try {
    return runGit(["branch", "--show-current"], { cwd: folder, timeout: 5_000 }).trim() || "(no branch)";
  } catch {
    return "(no branch)";
  }
}

const frictionNew = verb({
  command: {
    family: "friction",
    name: "new",
    summary: "file friction with concrete evidence and its impact",
    usage: "friction new --title <t> --description … --statement … --evidence <text|@file> --impact … [--links a,b]",
  },
  tool: {
    name: "record_friction",
    description: "Record friction: something that got in the way, with concrete evidence (a path, a pull request, a commit, a command and its output, an error, or a quoted excerpt) and what it cost. Record it; do not decide what to do about it.",
  },
  inputs: {
    title: { kind: "text", describe: "a short name for it" },
    description: { kind: "text", describe: "one line on what it is" },
    statement: { kind: "text", describe: "what went wrong" },
    evidence: { kind: "text", describe: "the concrete evidence for it" },
    impact: { kind: "text", describe: "what it cost" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
  },
  writes: true,
  async act(input, context: VerbContext) {
    const { recordFriction } = await import("./filing/capture.js");
    const note = await recordFriction(context.library, { ...fields(input), branch: await branchIn(context.folder) } as never, context.writer!);
    return { text: `Recorded friction ${note.id}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "read it whole" }] };
  },
});

const reinforce = verb({
  command: { family: "friction", name: "reinforce", summary: "add a dated recurrence on this branch, with its concrete evidence", usage: "friction reinforce <friction> --evidence <text|@file> [--branch <branch>]" },
  tool: {
    name: "reinforce",
    description: "Record a recurrence of existing friction with its own concrete evidence. It appends the date and this session's branch, keeping the original item and its route.",
  },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    evidence: { kind: "text", describe: "the concrete evidence of this recurrence" },
    branch: { kind: "text", optional: true, describe: "the branch it recurred on, when not this one" },
  },
  writes: true,
  async act({ friction, evidence, branch }, context: VerbContext) {
    const { reinforceFriction } = await import("./filing/capture.js");
    const note = await reinforceFriction(context.library, friction, { branch: branch ?? await branchIn(context.folder), evidence }, context.writer!);
    return { text: `Reinforced friction ${note.id}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "see its recurrences" }] };
  },
});

const drain = verb({
  consumers: ["agent"],
  command: { family: "friction", name: "drain", summary: "the reports a landing's pass routes: up to three from other branches, most recurrences first" },
  tool: {
    name: "friction_drain",
    description: "Drain friction for the landing's pass: up to three open reports other branches filed, most recurrences first, leased to this session for a few minutes. Read each whole, then route it.",
  },
  inputs: {},
  // It leases what it lists to the asking session (17.13).
  writes: true,
  async act(_input, context: VerbContext) {
    const { leaseFriction, openFriction } = await import("./drain/drain.js");
    const open = await openFriction(context.library, { branch: await branchIn(context.folder) });
    const { taken: due, free } = await leaseFriction(context.library, open, context.writer === undefined ? {} : { writer: context.writer });
    if (due.length === 0) return { text: "No friction is due: every report from another branch is routed." };
    const lines = due.map((note) => `  ${note.id}  (${note.fields.reinforcedBy?.length ?? 0} recurrences)  ${note.fields.title}`);
    const more = free > due.length ? [`${free - due.length} more wait.`] : [];
    return {
      text: [`${due.length} friction report${due.length === 1 ? "" : "s"} due for routing:`, ...lines, ...more].join("\n"),
      data: { due: due.map((note) => note.id), ...(more.length === 0 ? {} : { more: free - due.length }) },
      next: [{ tool: "open", command: "library read <friction>", why: "read one whole before judging it" }],
    };
  },
});

const routeVerb = verb({
  command: {
    family: "friction",
    name: "route",
    summary: "record a report's route and reason, or stamp the remedy that landed",
    usage: "friction route <friction> --to <adr|tool|principle|guardrail|process|definition|edit-existing|nothing> --reason <text|@file> [--discharged-by <pr or decision>]",
  },
  tool: {
    name: "route",
    description: "Record the routing judgement and reason on friction, or add its delivery stamp later. Every route but nothing needs an open increment naming this friction in remedies, unless the remedy is already stamped as delivered.",
  },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    to: { kind: "text", describe: "the route: adr, tool, principle, guardrail, process, definition, edit-existing or nothing" },
    reason: { kind: "text", describe: "why that route" },
    "discharged-by": { kind: "text", optional: true, describe: "the pull request or decision that discharged it" },
  },
  writes: true,
  async act({ friction, to, reason, "discharged-by": dischargedBy }, context: VerbContext) {
    const { route } = await import("./drain/drain.js");
    const routed = to as NonNullable<FieldsOf<"friction">["route"]>;
    const note = await route(context.library, friction, routed, reason, { ...context.writer, ...(dischargedBy === undefined ? {} : { dischargedBy }) });
    return { text: `Routed ${note.id} to ${routed}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "read it back" }] };
  },
});

const resteerNew = verb({
  command: {
    family: "resteer",
    name: "new",
    summary: "file a re-steer with the owner's quoted words, keeping your account apart",
    usage: "resteer new --title <t> --description … --doing … --redirect … --evidence <quote|@file> --disposition <defect|taste> --judged-by <owner|agent> [--mode <failure-mode>] [--self-report <text|@file>] [--links a,b]",
  },
  tool: {
    name: "record_resteer",
    description: "Record a re-steer: the user (the project's owner) redirected what you were doing. Put their own words inside double quotation marks as the evidence; your own account of it goes in self-report. Say whether it was a defect or a matter of taste, and who judged that (judged-by): the owner, or you. A defect needs its failure mode (no-mast-home when none fits).",
  },
  inputs: {
    title: { kind: "text", describe: "a short name for it" },
    description: { kind: "text", describe: "one line on what it is" },
    doing: { kind: "text", describe: "what you were doing" },
    redirect: { kind: "text", describe: "what the owner redirected you to" },
    evidence: { kind: "text", describe: "their own words, inside double quotation marks" },
    disposition: { kind: "text", describe: "defect (something went wrong) or taste (a preference)" },
    "judged-by": { kind: "text", describe: "who judged it a defect or taste: owner only when the owner said so, else agent" },
    mode: { kind: "text", optional: true, describe: "a defect's failure mode" },
    "self-report": { kind: "text", optional: true, describe: "your own account of it, kept apart" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
  },
  writes: true,
  async act({ "judged-by": judgedBy, ...given }, context: VerbContext) {
    const { recordResteer } = await import("./filing/capture.js");
    const note = await recordResteer(context.library, { ...fields(given), dispositionBy: judgedBy } as never, context.writer!);
    return { text: `Recorded re-steer ${note.id}.`, data: { id: note.id }, next: [{ command: `library read ${note.id}`, why: "read it whole" }] };
  },
});

/** Session management's friction command families, which its manifest names under `verbs` (ADR-1033), 13th and 14th among `storytree`'s. */
export const FRICTION_FAMILIES: readonly VerbFamily[] = [
  { name: "friction", summary: "file friction with its evidence, add a recurrence, or drain and route it", order: 13, verbs: [frictionNew, reinforce, drain, routeVerb] },
  { name: "resteer", summary: "file a re-steer, with the owner's own words", order: 14, verbs: [resteerNew] },
];

/** Its section of the habits card (ADR-1021, the guidance kind): filing what fought you, and draining what others filed. */
export const frictionGuidance: readonly string[] = [
  "File what fought you: `record_friction` when something got in your way, with concrete evidence, and `reinforce` the existing item when it happens again, with its own; `record_resteer` when the owner redirects you, quoting their own words. Before landing, `friction_drain` hands you up to three reports other sessions filed: read each, then `route` it with its reason.",
];

/** Friction's verbs that are tools, which the MCP server mounts (17.18). */
export const FRICTION_TOOLS = FRICTION_FAMILIES.flatMap((family) => family.verbs);
