/**
 * Capability 5 · Queues. The `friction` and `resteer` verbs, declared here (ADR-0969 D2) and mounted by the command line
 * as its families of those names (ADR-1033): file friction or a re-steer, add a recurrence, and drain and route the
 * friction a landing's librarian pass judges. Session management owns capture (evidence validation and recurrence
 * dates), imported in the act; the drain and the route are this capability's. None is a tool: the MCP server's own
 * record_friction, reinforce, worklist, route and record_resteer tools do these jobs.
 */
import { verb, type VerbContext } from "@storytree/project-and-caller/verbs";
import type { FieldsOf } from "@storytree/library";

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
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim() || "(no branch)";
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
  tool: { absent: "the MCP server's own record_friction tool files friction" },
  inputs: {
    title: { kind: "text", optional: true, describe: "its title" },
    description: { kind: "text", optional: true, describe: "what happened" },
    statement: { kind: "text", optional: true, describe: "the claim it makes" },
    evidence: { kind: "text", optional: true, describe: "the concrete evidence for it" },
    impact: { kind: "text", optional: true, describe: "what it cost" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
  },
  writes: true,
  async act(input, context: VerbContext) {
    const { recordFriction } = await import("@storytree/session-management");
    const note = await recordFriction(context.library, { ...fields(input), branch: await branchIn(context.folder) } as never, context.writer!);
    return { text: `Recorded friction ${note.id}.`, next: [{ command: `library read ${note.id}`, why: "read it whole" }] };
  },
});

const reinforce = verb({
  command: { family: "friction", name: "reinforce", summary: "add a dated recurrence on this branch, with its concrete evidence", usage: "friction reinforce <friction> --evidence <text|@file> [--branch <branch>]" },
  tool: { absent: "the MCP server's own reinforce tool adds a recurrence" },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    evidence: { kind: "text", describe: "the concrete evidence of this recurrence" },
    branch: { kind: "text", optional: true, describe: "the branch it recurred on, when not this one" },
  },
  writes: true,
  async act({ friction, evidence, branch }, context: VerbContext) {
    const { reinforceFriction } = await import("@storytree/session-management");
    const note = await reinforceFriction(context.library, friction, { branch: branch ?? await branchIn(context.folder), evidence }, context.writer!);
    return { text: `Reinforced friction ${note.id}.`, next: [{ command: `library read ${note.id}`, why: "see its recurrences" }] };
  },
});

const drain = verb({
  command: { family: "friction", name: "drain", summary: "the reports a landing's librarian pass routes: up to three from other branches, most recurrences first" },
  tool: { absent: "the MCP server's own worklist tool lists the friction due" },
  inputs: {},
  async act(_input, context: VerbContext) {
    const { frictionDrain } = await import("./queues.js");
    const due = await frictionDrain(context.library, { branch: await branchIn(context.folder) });
    if (due.length === 0) return { text: "No friction is due: every report from another branch is routed." };
    const lines = due.map((note) => `  ${note.id}  (${note.fields.reinforcedBy?.length ?? 0} recurrences)  ${note.fields.title}`);
    return {
      text: [`${due.length} friction report${due.length === 1 ? "" : "s"} due for routing:`, ...lines].join("\n"),
      next: [
        { command: "library read <friction>", why: "read one whole before judging it" },
        { command: "friction route <friction> --to <route> --reason …", why: "record the route and its reason" },
      ],
    };
  },
});

const routeVerb = verb({
  command: {
    family: "friction",
    name: "route",
    summary: "record the librarian's route and reason, or stamp the remedy that landed",
    usage: "friction route <friction> --to <adr|tool|principle|guardrail|process|definition|edit-existing|nothing> --reason <text|@file> [--discharged-by <pr or decision>]",
  },
  tool: { absent: "the MCP server's own route tool records a route" },
  inputs: {
    friction: { kind: "text", word: 0, describe: "the friction's id" },
    to: { kind: "text", describe: "the route: adr, tool, principle, guardrail, process, definition, edit-existing or nothing" },
    reason: { kind: "text", describe: "why that route" },
    "discharged-by": { kind: "text", optional: true, describe: "the pull request or decision that discharged it" },
  },
  writes: true,
  async act({ friction, to, reason, "discharged-by": dischargedBy }, context: VerbContext) {
    const { route } = await import("./queues.js");
    const routed = to as NonNullable<FieldsOf<"friction">["route"]>;
    const note = await route(context.library, friction, routed, reason, { ...context.writer, ...(dischargedBy === undefined ? {} : { dischargedBy }) });
    return { text: `Routed ${note.id} to ${routed}.`, next: [{ command: `library read ${note.id}`, why: "read it back" }] };
  },
});

const resteerNew = verb({
  command: {
    family: "resteer",
    name: "new",
    summary: "file a re-steer with the owner's quoted words, keeping your account apart",
    usage: "resteer new --title <t> --description … --doing … --redirect … --evidence <quote|@file> --disposition <defect|taste> --judged-by <owner|agent> [--mode <failure-mode>] [--self-report <text|@file>] [--links a,b]",
  },
  tool: { absent: "the MCP server's own record_resteer tool files a re-steer" },
  inputs: {
    title: { kind: "text", optional: true, describe: "its title" },
    description: { kind: "text", optional: true, describe: "what happened" },
    doing: { kind: "text", optional: true, describe: "what you were doing" },
    redirect: { kind: "text", optional: true, describe: "where the owner steered you" },
    evidence: { kind: "text", optional: true, describe: "the owner's own words, quoted" },
    disposition: { kind: "text", optional: true, describe: "defect or taste" },
    "judged-by": { kind: "text", optional: true, describe: "who judged it: owner or agent" },
    mode: { kind: "text", optional: true, describe: "the failure mode" },
    "self-report": { kind: "text", optional: true, describe: "your own account, kept apart" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
  },
  writes: true,
  async act({ "judged-by": judgedBy, ...given }, context: VerbContext) {
    const { recordResteer } = await import("@storytree/session-management");
    const note = await recordResteer(context.library, { ...fields(given), dispositionBy: judgedBy } as never, context.writer!);
    return { text: `Recorded re-steer ${note.id}.`, next: [{ command: `library read ${note.id}`, why: "read it whole" }] };
  },
});

/** The friction verbs, as the command line's `friction` family lists them. */
export const FRICTION_VERBS = [frictionNew, reinforce, drain, routeVerb];

/** The re-steer verbs, as the command line's `resteer` family lists them. */
export const RESTEER_VERBS = [resteerNew];
