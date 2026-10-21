/**
 * Capability 1 · Front door. `storytree friction drain` runs the doors learner after the drain (ADR-1045 D7): the drain is
 * Friction's verb and the learner this door's usage reading (capability 14, which reaches both doors' surfaces), so the
 * command line mounts the one with the other. A learner that fails says so under the drain's answer and never stops it.
 */
import type { WriteOptions } from "@storytree/library";
import { mounted, type VerbFamilies, type VerbPlace } from "@storytree/library/verbs";

import type { Context, Family, Verb } from "../door.js";
import type { Surfaces } from "../usage/learn.js";

/** Each verb both doors mount, as its command and its tool, walked from the families its stories declare. */
export function twinsOf(declared: readonly VerbFamilies<VerbPlace>[] , path = "storytree"): { command: string; tool: string }[] {
  return declared.flatMap((family) => {
    const at = `${path} ${family.name}`;
    const verbs = [...family.verbs.map((verb) => ({ verb, command: mounted(verb.command) ? `${at} ${verb.command.name}` : undefined })), ...(family.bare === undefined ? [] : [{ verb: family.bare, command: at }])];
    return [
      ...verbs.flatMap(({ verb, command }) => (command !== undefined && mounted(verb.command) && mounted(verb.tool) ? [{ command, tool: verb.tool.name }] : [])),
      ...twinsOf(family.families ?? [], at),
    ];
  });
}

/** `family` with its `drain` verb followed by the doors learner, when it is the friction family; any other as it is. */
export function learning(family: Family, surfaces: (cwd: string) => Promise<Surfaces>): Family {
  const drain = family.name === "friction" ? family.verbs.find((verb) => verb.name === "drain") : undefined;
  if (drain === undefined) return family;
  const learned: Verb = {
    ...drain,
    async act(args, context) {
      const answer = await drain.act(args, context);
      const said = await learn(context, surfaces).catch((error: unknown) => [`The doors learner did not run: ${error instanceof Error ? error.message : String(error)}`]);
      return { ...answer, text: [answer.text, ...said].join("\n") };
    },
  };
  return { ...family, verbs: family.verbs.map((verb) => (verb === drain ? learned : verb)) };
}

/**
 * Run the doors learner for `caller`, writing as `writer`: by default the session running the command and its writer. The
 * tool server names its own caller (`storytree doors learn`), so its drain learns on the session that called the tool.
 */
export async function learn(context: Context, surfaces: (cwd: string) => Promise<Surfaces>, as?: { readonly caller: { readonly session: string; readonly harness?: string }; readonly writer: WriteOptions }): Promise<string[]> {
  const [{ log, project, library, session, harness }, { ARCS, learnInDrain }] = await Promise.all([context.activityContext(), import("../usage/learner.js")]);
  const caller = as?.caller ?? { session, ...(harness === undefined ? {} : { harness }) };
  return learnInDrain({ log, project, library, writer: as?.writer ?? context.writer(), caller, surfaces: await surfaces(context.cwd), arcs: ARCS, now: new Date() });
}
