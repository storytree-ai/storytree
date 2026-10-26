/**
 * Capability 3 · Arc surface. What the `arc` and `question` verbs share: the context the doors hand them, and how a
 * given value and a record are read and named.
 */
import { VerbRefusal } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

/** The caller with its activity log, and the journey runtime when the door has one, told when an increment closes. */
export interface ArcVerbContext extends SessionVerbContext {
  readonly journey?: () => Promise<{ incrementClosed(outcome: unknown): unknown }>;
}

/** A field's value: text, or JSON for `true`, `false`, a whole number, a list or an object. */
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

/**
 * A list: `a,b` or `["a","b"]`. A comma list holding whitespace inside an id is refused rather than split: PowerShell
 * turns an unquoted comma list into an array and joins it with spaces.
 */
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

/** A record's one-line label: its title, term or text, cut at 100 characters. */
export function labelOf(fields: Readonly<Record<string, unknown>>): string {
  const title = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : typeof fields.text === "string" ? fields.text : "";
  const line = title.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/**
 * Asking the owner about an increment releases the work the caller holds for it, through Session management's
 * releaseAsked (ADR-0944 D4): the question's `--hold` and an owner wait both say so. A caller holding none of it, a
 * person's shell included, releases nothing and is told nothing.
 */
export async function releasedAsking(context: SessionVerbContext, increment: string): Promise<string> {
  const { releaseAsked } = await import("@storytree/session-management");
  const released = await releaseAsked(context, increment);
  return released.length === 0 ? "" : ` Released your claims on ${released.join(", ")}.`;
}
