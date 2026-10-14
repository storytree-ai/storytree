/**
 * Capability 1 · Front door. A verb its owning story declared once (ADR-0969 D2), mounted as a command: its usage is
 * read from the verb's inputs, its words and flags become the verb's input, a step it offers next is named as a
 * command, and the verb's own refusal is the door's, with the usage when the input was wrong. A word or flag the verb does
 * not take is refused with its usage, and a refusal's next steps are named as commands. A callerless verb is handed only
 * its place, with the shell's session when it names one alone, so it runs where no library opens. A
 * verb that writes is handed the writer, named below its answer once its work asks for it, so one that wrote nothing names
 * none; a raw answer is printed as it is. A declared family is
 * mounted with the families within it, its bare verb, its guesses and its retired words.
 */
import { commandInput, commandUsage, mounted, VerbRefusal, type DoorWords, type Verb, type VerbFamilies, type VerbInputs, type VerbPlace } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { Refusal, type Next } from "./answer.js";
import type { Context, Verb as Command, Family } from "./door.js";
import { commandSession, soleSession } from "./writer.js";

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
 * place; a callerless verb's is the place alone, the folder the command runs in and the shell's sole session, and no
 * library is opened for it.
 */
export function command(declared: Verb<VerbInputs, SessionVerbContext & CommandPlace>): Command {
  if (!mounted(declared.command)) throw new Error(`no command to mount: ${declared.command.absent}`);
  const face = declared.command;
  const usage = commandUsage(declared);
  const switches = Object.entries(declared.inputs).flatMap(([name, input]) => input.kind === "switch" ? [name] : []);
  const misused = (error: VerbRefusal): Refusal => new Refusal(error.misuse ? `${error.message}\nusage: storytree ${usage}` : error.message, {
    code: error.misuse ? 2 : 1,
    next: error.next.map((step) => ({ command: WORDS.say(step), why: step.why })),
  });
  return {
    name: face.name,
    usage,
    summary: face.summary,
    switches,
    async act(args, context) {
      try {
        const input = commandInput(declared, { word: (index) => args.words[index], flag: (name) => args.text(name), flags: (name) => args.texts(name), has: (name) => args.has(name), names: () => args.names });
        if (declared.agentOnly !== undefined && commandSession() === undefined) throw new Refusal(`Run storytree ${face.family} ${face.name} from the agent's shell: ${declared.agentOnly}.`);
        const place: CommandPlace = { folder: context.cwd, ...(context.script === undefined ? {} : { script: context.script }), journey: () => context.journey() };
        const caller = declared.callerless ? { ...place, ...soleSession() } as SessionVerbContext & CommandPlace : { ...place, ...await context.activityContext() };
        const answer = await declared.act(input, declared.writes ? writing(caller, context) : caller, WORDS);
        if (answer.raw) return { text: answer.text, raw: true };
        const next: Next[] = (answer.next ?? []).map((step) => ({ command: WORDS.say(step), why: step.why }));
        return { text: answer.text, ...(next.length === 0 ? {} : { next }) };
      } catch (error) {
        throw error instanceof VerbRefusal ? misused(error) : error;
      }
    },
  };
}

/** `caller` with the writer, asked of the door only when the work first reads it: the door names a writer it was asked for. */
function writing<C extends object>(caller: C, context: Pick<Context, "writer">): C & { readonly writer: ReturnType<Context["writer"]> } {
  let writer: ReturnType<Context["writer"]> | undefined;
  return Object.defineProperty({ ...caller }, "writer", { enumerable: true, get: () => (writer ??= context.writer()) }) as C & { readonly writer: ReturnType<Context["writer"]> };
}

/** The family for `declared`, with the families within it, each verb mounted as a command. */
export function family(declared: VerbFamilies<SessionVerbContext & CommandPlace>): Family {
  return {
    name: declared.name,
    ...(declared.aliases === undefined ? {} : { aliases: declared.aliases }),
    summary: declared.summary,
    verbs: declared.verbs.map(command),
    ...(declared.bare === undefined ? {} : { bare: command(declared.bare) }),
    ...(declared.families === undefined ? {} : { families: declared.families.map(family) }),
    ...(declared.guesses === undefined ? {} : { guesses: declared.guesses }),
    ...(declared.retired === undefined ? {} : { retired: declared.retired }),
  };
}
