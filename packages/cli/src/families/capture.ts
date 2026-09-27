/**
 * Capability 9 · Friction and re-steers: the agent link owns evidence validation and recurrence
 * dates. This door only reads the fields, resolves the current branch and passes the writer.
 */
import { execFileSync } from "node:child_process";
import { recordFriction, recordResteer, reinforceFriction } from "@storytree/agent-link";

import type { Args } from "../args.js";
import type { Family, Verb } from "../door.js";
import { valueOf } from "./library.js";

/** Capture takes only its own fields: routing a friction remains the librarian's work. */
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
    const note = await recordFriction(await context.library(), fields(args, ["title", "description", "statement", "evidence", "impact"]) as never, context.writer());
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
  summary: "file friction with its evidence, or add a recurrence",
  verbs: [frictionNew, reinforce],
};

export const resteer: Family = {
  name: "resteer",
  summary: "file a re-steer, with the owner's own words",
  verbs: [resteerNew],
};
