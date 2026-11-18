// Capability 10 · Plan view
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const USAGE = "plan [--id <story|capability|arc> | --closed today|yesterday|week | --from <YYYY-MM-DD> --to <YYYY-MM-DD>]";

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
    const answer = await planAnswer({ library, log, project, quietMs: idleAfterMs() }, { closed: closed as (typeof CLOSED)[number] | undefined, from: args.text("from"), to: args.text("to"), id: args.text("id") });
    if (answer.refused === true) throw new Refusal(answer.text);
    return { text: answer.text };
  },
};

function wordsRefused(word: string): Refusal {
  const read = `storytree library read ${word}`;
  const part = `storytree plan --id ${word}`;
  return new Refusal(`storytree plan takes no words, only flags\nusage: storytree ${USAGE}\nTo read one story, capability or arc of the plan, run ${part}; one record, ${read}; one arc, storytree arc show <arc>`, {
    code: 2,
    next: [{ command: part, why: "that story, capability or arc of the plan" }, { command: read, why: "read that record" }, { command: "storytree arc show <arc>", why: "an arc with its increments and questions" }],
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
