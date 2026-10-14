/**
 * Capability 1 · Front door. A verb its owning story declared once (ADR-0969 D2), mounted as a command: its usage is
 * read from the verb's inputs, its words and flags become the verb's input, a step it offers next is named as a
 * command, and the verb's own refusal is the door's, with the usage when the input was wrong. A word or flag the verb does
 * not take is refused with its usage. A callerless verb is handed only its place, so it runs where no library opens.
 */
import { commandInput, commandUsage, mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs, type VerbPlace } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { Refusal, type Next } from "./answer.js";
import type { Context, Verb as Command } from "./door.js";
import { commandSession } from "./writer.js";

const WORDS: DoorWords = {
  door: "command",
  say: (step) => step.command === undefined ? `the ${step.tool!} tool` : `storytree ${step.command}`,
};

/**
 * What this door hands every verb besides its caller: the command's own script, when known (storytree's other commands
 * sit beside an installed one), and the per-process journey runtime, which the door finishes after the answer.
 */
export interface CommandPlace extends VerbPlace {
  readonly script?: string;
  journey: Context["journey"];
}

/**
 * The command for `declared`, which must have one. Its context is the caller's, with the activity log, and this door's
 * place; a callerless verb's is the place alone, the folder the command runs in, and no library is opened for it.
 */
export function command(declared: Verb<VerbInputs, SessionVerbContext & CommandPlace>): Command {
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
        const input = commandInput(declared, { word: (index) => args.words[index], count: args.words.length, flag: (name) => args.text(name), has: (name) => args.has(name), names: args.names });
        if (declared.agentOnly !== undefined && commandSession() === undefined) throw new Refusal(`Run storytree ${face.family} ${face.name} from the agent's shell: ${declared.agentOnly}.`);
        const place: CommandPlace = { folder: context.cwd, ...(context.script === undefined ? {} : { script: context.script }), journey: () => context.journey() };
        const caller = declared.callerless ? place as SessionVerbContext & CommandPlace : { ...place, ...await context.activityContext() };
        const answer = await declared.act(input, caller, WORDS);
        const next: Next[] = (answer.next ?? []).map((step) => ({ command: WORDS.say(step), why: step.why }));
        return { text: answer.text, ...(next.length === 0 ? {} : { next }) };
      } catch (error) {
        throw error instanceof VerbRefusal ? misused(error) : error;
      }
    },
  };
}
