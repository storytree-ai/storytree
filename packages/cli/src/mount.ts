/**
 * Capability 1 · Front door. A verb its owning story declared once (ADR-0969 D2), mounted as a command: its usage is
 * read from the verb's inputs, its words and flags become the verb's input, a step it offers next is named as a
 * command, and the verb's own refusal is the door's, with the usage when the input was wrong.
 */
import { commandInput, commandUsage, mounted, VerbRefusal, type DoorWords, type Verb as Declared } from "@storytree/agent-link/verbs";

import { Refusal, type Next } from "./answer.js";
import type { Verb } from "./door.js";
import { commandSession } from "./writer.js";

const WORDS: DoorWords = {
  door: "command",
  say: (step) => step.command === undefined ? `the ${step.tool!} tool` : `storytree ${step.command}`,
};

/** The command for `declared`, which must have one. */
export function command(declared: Declared): Verb {
  if (!mounted(declared.command)) throw new Error(`no command to mount: ${declared.command.absent}`);
  const face = declared.command;
  const usage = commandUsage(declared);
  const switches = Object.entries(declared.inputs).flatMap(([name, input]) => input.kind === "switch" ? [name] : []);
  const misused = (error: VerbRefusal): Refusal => new Refusal(error.misuse ? `${error.message}\nusage: storytree ${usage}` : error.message, { code: error.misuse ? 2 : 1 });
  return {
    name: face.name,
    usage,
    summary: face.summary,
    switches,
    async act(args, context) {
      try {
        const input = commandInput(declared, { word: (index) => args.words[index], flag: (name) => args.text(name), has: (name) => args.has(name) });
        if (declared.agentOnly !== undefined && commandSession() === undefined) throw new Refusal(`Run storytree ${face.family} ${face.name} from the agent's shell: ${declared.agentOnly}.`);
        const caller = await context.activityContext();
        const answer = await declared.act(input, caller, WORDS);
        const next: Next[] = (answer.next ?? []).map((step) => ({ command: WORDS.say(step), why: step.why }));
        return { text: answer.text, ...(next.length === 0 ? {} : { next }) };
      } catch (error) {
        throw error instanceof VerbRefusal ? misused(error) : error;
      }
    },
  };
}
