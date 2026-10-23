/**
 * Capability 10 · Plan view (the command line story): `storytree plan` prints what the show_plan tool answers, the
 * plan's stories, capabilities and contracts with their health, who holds what, the arcs and the sessions about, so
 * the two front doors answer the word agents reach for alike (ADR-0793). The answer is the MCP server's own; this
 * door only reads its flags and prints it. A word naming what to plan points to the command that plans it. `storytree show`,
 * the word agents reach for by the tool's name, is this command too.
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const USAGE = "plan [--closed today|yesterday|week | --from <YYYY-MM-DD> --to <YYYY-MM-DD>]";

const CLOSED = ["today", "yesterday", "week"] as const;

const show: Verb = {
  name: "plan",
  usage: USAGE,
  summary: "the plan as show_plan answers it: stories, capabilities and contracts with their health, claims, arcs and sessions",
  async act(args, context) {
    if (args.words.length > 0) throw wordsRefused(args.words[0]!);
    const closed = args.text("closed");
    if (closed !== undefined && !(CLOSED as readonly string[]).includes(closed)) throw new Refusal(`--closed is today, yesterday or week\nusage: storytree ${USAGE}`, { code: 2 });
    const [{ planAnswer }, { idleAfterMs }, { log, library, project }] = await Promise.all([
      import("@storytree/mcp-server"),
      import("@storytree/project-and-caller"),
      context.activityContext(),
    ]);
    const answer = await planAnswer({ library, log, project, quietMs: idleAfterMs() }, { closed: closed as (typeof CLOSED)[number] | undefined, from: args.text("from"), to: args.text("to") });
    if (answer.refused === true) throw new Refusal(answer.text);
    return { text: answer.text };
  },
};

/** A word after `plan` (or `show`) is most often a record's id: name the commands that read one thing on the plan. */
function wordsRefused(word: string): Refusal {
  const read = `storytree library read ${word}`;
  return new Refusal(`storytree plan takes no words, only flags\nusage: storytree ${USAGE}\nTo read one record, run ${read}; one arc, storytree arc show <arc>`, {
    code: 2,
    next: [{ command: read, why: "read that record" }, { command: "storytree arc show <arc>", why: "an arc with its increments and questions" }],
  });
}

export const plan: Family = {
  name: "plan",
  aliases: ["show"],
  summary: "the plan as the show_plan tool answers it",
  verbs: [],
  bare: show,
  guesses: {
    contract: "library new contract --capability <capability> --title <t>",
    story: "library new <story|capability|contract> --<field> <value|@file> …",
    capability: "library new <story|capability|contract> --<field> <value|@file> …",
    arc: "arc new --title <t> --intent <text|@file> --end-state <text|@file>",
    increment: "arc increment new --arc <arc> --title <t> --objective <o> --body <text|@file>",
  },
};
