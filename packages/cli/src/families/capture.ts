/**
 * Capability 9 · Friction and re-steers: the agent link owns evidence validation and recurrence
 * dates, and the librarian owns the drain and the routing judgement. This door only reads the
 * fields, resolves the current branch and passes the writer.
 */
import { execFileSync } from "node:child_process";
import { recordFriction, recordResteer, reinforceFriction } from "@storytree/agent-link";
import { frictionDrain, route, type Route } from "@storytree/librarian";

import type { Args } from "../args.js";
import type { Family, Verb } from "../door.js";
import { valueOf } from "./library.js";

/** Capture takes only its own fields: routing is its own verb, the librarian's work. */
function fields(args: Args, names: readonly string[]): Record<string, unknown> {
  const given: Record<string, unknown> = {};
  for (const name of names) {
    const text = args.text(name);
    if (text !== undefined) given[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = text;
  }
  const links = args.text("links");
  if (links !== undefined) {
    const parsed = valueOf(links);
    given.links = Array.isArray(parsed) ? parsed : links.split(",").map((id) => id.trim()).filter(Boolean);
  }
  return given;
}

function branchIn(folder: string): string {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim() || "(no branch)";
  } catch {
    return "(no branch)";
  }
}

const frictionNew: Verb = {
  name: "new",
  usage: "friction new --title <t> --description … --statement … --evidence <text|@file> --impact … [--links a,b]",
  summary: "file friction with concrete evidence and its impact",
  async act(args, context) {
    const note = await recordFriction(await context.library(), { ...fields(args, ["title", "description", "statement", "evidence", "impact"]), branch: branchIn(context.cwd) } as never, context.writer());
    return { text: `Recorded friction ${note.id}.`, next: [{ command: `storytree library read ${note.id}`, why: "read it whole" }] };
  },
};

const reinforce: Verb = {
  name: "reinforce",
  usage: "friction reinforce <friction> --evidence <text|@file> [--branch <branch>]",
  summary: "add a dated recurrence on this branch, with its concrete evidence",
  async act(args, context) {
    const id = args.word(0, "the friction's id", this.usage);
    const note = await reinforceFriction(await context.library(), id, {
      branch: args.text("branch") ?? branchIn(context.cwd),
      evidence: args.need("evidence", this.usage),
    }, context.writer());
    return { text: `Reinforced friction ${note.id}.`, next: [{ command: `storytree library read ${note.id}`, why: "see its recurrences" }] };
  },
};

const drain: Verb = {
  name: "drain",
  usage: "friction drain",
  summary: "the reports a landing's librarian pass routes: up to three from other branches, most recurrences first",
  async act(_args, context) {
    const due = await frictionDrain(await context.library(), { branch: branchIn(context.cwd) });
    if (due.length === 0) return { text: "No friction is due: every report from another branch is routed." };
    const lines = due.map((note) => `  ${note.id}  (${note.fields.reinforcedBy?.length ?? 0} recurrences)  ${note.fields.title}`);
    return {
      text: [`${due.length} friction report${due.length === 1 ? "" : "s"} due for routing:`, ...lines].join("\n"),
      next: [
        { command: "storytree library read <friction>", why: "read one whole before judging it" },
        { command: "storytree friction route <friction> --to <route> --reason …", why: "record the route and its reason" },
      ],
    };
  },
};

const routeVerb: Verb = {
  name: "route",
  usage: "friction route <friction> --to <adr|tool|principle|guardrail|process|definition|edit-existing|nothing> --reason <text|@file> [--discharged-by <pr or decision>]",
  summary: "record the librarian's route and reason, or stamp the remedy that landed",
  async act(args, context) {
    const id = args.word(0, "the friction's id", this.usage);
    const to = args.need("to", this.usage) as Route;
    const dischargedBy = args.text("discharged-by");
    const note = await route(await context.library(), id, to, args.need("reason", this.usage), { ...context.writer(), ...(dischargedBy === undefined ? {} : { dischargedBy }) });
    return { text: `Routed ${note.id} to ${to}.`, next: [{ command: `storytree library read ${note.id}`, why: "read it back" }] };
  },
};

const resteerNew: Verb = {
  name: "new",
  usage: "resteer new --title <t> --description … --doing … --redirect … --evidence <quote|@file> --disposition <defect|taste> --judged-by <owner|agent> [--mode <failure-mode>] [--self-report <text|@file>] [--links a,b]",
  summary: "file a re-steer with the owner's quoted words, keeping your account apart",
  async act(args, context) {
    const given = fields(args, ["title", "description", "doing", "redirect", "evidence", "disposition", "mode", "self-report"]);
    const note = await recordResteer(await context.library(), { ...given, dispositionBy: args.text("judged-by") } as never, context.writer());
    return { text: `Recorded re-steer ${note.id}.`, next: [{ command: `storytree library read ${note.id}`, why: "read it whole" }] };
  },
};

export const friction: Family = {
  name: "friction",
  summary: "file friction with its evidence, add a recurrence, or drain and route it",
  verbs: [frictionNew, reinforce, drain, routeVerb],
};

export const resteer: Family = {
  name: "resteer",
  summary: "file a re-steer, with the owner's own words",
  verbs: [resteerNew],
};
