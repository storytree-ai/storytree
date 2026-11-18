// Capability 1 · Front door
import type { Library, WriteOptions } from "@storytree/library";
import { mounted, type VerbFamilies, type VerbPlace } from "@storytree/library/verbs";

import type { Context, Family, Verb } from "../door.js";
import { writtenFor } from "../mount.js";
import type { Surfaces } from "../usage/learn.js";

export function twinsOf(declared: readonly VerbFamilies<VerbPlace>[] , path = "storytree"): { command: string; tool: string }[] {
  return declared.flatMap((family) => {
    const at = `${path} ${family.name}`;
    const verbs = [...family.verbs.map((verb) => ({ verb, command: mounted(verb.command) ? `${at} ${verb.command.name}` : undefined })), ...(family.bare === undefined ? [] : [{ verb: family.bare, command: at }])];
    return [
      ...verbs.flatMap(({ verb, command }) => {
        const tool = mounted(verb.tool) ? verb.tool.name : verb.tool.twin;
        return command !== undefined && tool !== undefined ? [{ command, tool }] : [];
      }),
      ...twinsOf(family.families ?? [], at),
    ];
  });
}

export function learning(family: Family, surfaces: (cwd: string) => Promise<Surfaces>): Family {
  const drain = family.name === "friction" ? family.verbs.find((verb) => verb.name === "drain") : undefined;
  if (drain === undefined) return family;
  const learned: Verb = {
    ...drain,
    async act(args, context) {
      const answer = await drain.act(args, context);
      const said = await writtenFor(args, context, drain.usage).then((library) => learn(context, surfaces, { library })).catch((error: unknown) => [`The doors learner did not run: ${error instanceof Error ? error.message : String(error)}`]);
      return { ...answer, text: [answer.text, ...said].join("\n") };
    },
  };
  return { ...family, verbs: family.verbs.map((verb) => (verb === drain ? learned : verb)) };
}

export async function learn(context: Context, surfaces: (cwd: string) => Promise<Surfaces>, as: { readonly caller?: { readonly session: string; readonly harness?: string }; readonly writer?: WriteOptions; readonly library: Library }): Promise<string[]> {
  const [{ log, project, session, harness }, { ARCS, learnInDrain }] = await Promise.all([context.activityContext(), import("../usage/learner.js")]);
  const caller = as.caller ?? { session, ...(harness === undefined ? {} : { harness }) };
  return learnInDrain({ log, project, library: as.library, writer: as.writer ?? context.writer(), caller, surfaces: await surfaces(context.cwd), arcs: ARCS, now: new Date() });
}
