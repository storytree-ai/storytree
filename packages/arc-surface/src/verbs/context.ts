// Capability 3 · Arc surface.
import { contextIn, librariesNamed, PROJECT_INPUT, PROJECTS_INPUT, unopenedSaid } from "@storytree/library/commands";
import { mounted, VerbRefusal, type Verb, type VerbInputs } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

export interface ArcVerbContext extends SessionVerbContext {
  readonly journey?: () => Promise<{ incrementClosed(outcome: unknown): unknown }>;
}

export function valueOf(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false" || /^-?\d+$/.test(trimmed) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

export function listOf(value: string | undefined, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  const parsed = valueOf(value);
  if (Array.isArray(parsed)) return parsed as string[];
  const ids = value.split(",").map((one) => one.trim()).filter((one) => one !== "");
  if (ids.some((id) => /\s/.test(id))) {
    throw new VerbRefusal(
      `--${name} contains whitespace inside an id. PowerShell may have converted an unquoted comma list to an array and joined it with spaces. Retry with the whole comma-separated list quoted, for example --${name} "id1,id2" (replace id1 and id2 with your intended ids). No ids were guessed or split on whitespace.`,
      { misuse: true },
    );
  }
  return ids;
}

export function labelOf(fields: Readonly<Record<string, unknown>>): string {
  const title = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : typeof fields.text === "string" ? fields.text : "";
  const line = title.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

export async function releasedAsking(context: SessionVerbContext, increment: string): Promise<string> {
  const { releaseAsked } = await import("@storytree/session-management");
  const released = await releaseAsked(context, increment);
  return released.length === 0 ? "" : ` Released your claims on ${released.join(", ")}.`;
}

export function readsElsewhere(declared: Verb<VerbInputs, ArcVerbContext>, input: VerbInputs[string] = PROJECT_INPUT): Verb<VerbInputs, ArcVerbContext> {
  const command = mounted(declared.command) ? declared.command : undefined;
  return {
    ...declared,
    ...(command?.usage === undefined ? {} : { command: { ...command, usage: `${command.usage} [--project <project>]` } }),
    inputs: { ...declared.inputs, project: input },
    async act({ project, ...input }, context, words) {
      const there = await contextIn(context, project as string | undefined);
      const answer = await declared.act(input, there, words);
      return there === context ? answer : { ...answer, text: `project ${there.project}:\n${answer.text}` };
    },
  };
}

export const WRITE_PROJECT_INPUT = { ...PROJECT_INPUT, describe: "Write to this project's library instead of this folder's: its factory's, or a project that factory builds" } as const;

export function readsAcross(declared: Verb<VerbInputs, ArcVerbContext>): Verb<VerbInputs, ArcVerbContext> {
  const command = mounted(declared.command) ? declared.command : undefined;
  return {
    ...declared,
    ...(command?.usage === undefined ? {} : { command: { ...command, usage: `${command.usage} [--project <project|all>]` } }),
    inputs: { ...declared.inputs, project: PROJECTS_INPUT },
    async act({ project, ...input }, context, words) {
      const named = typeof project === "string" ? [project] : (project as string[] | undefined);
      if (named === undefined || named.length === 0) return declared.act(input, context, words);
      const sections: string[] = [];
      for (const reached of await librariesNamed(context.library, named)) {
        if (reached.opened === undefined) {
          sections.push(unopenedSaid(reached.project, reached.unopened));
          continue;
        }
        const there = reached.opened === context.library ? context : { ...context, library: reached.opened, project: reached.opened.name };
        sections.push(`project ${reached.project}:\n${(await declared.act(input, there, words)).text}`);
      }
      return { text: sections.join("\n\n") };
    },
  };
}
