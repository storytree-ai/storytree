/**
 * Capability 6 · Unclaimed work (the forest story): the edits and commands made by agents holding
 * no claim, who made them, which files, and when, with a count always in view. It is how work
 * outside the plan stays visible, even from an agent that never calls storytree, since its hooks
 * record its edits and commands anyway.
 *
 * Its shelf: unclaimed work is never guessed onto a story (storytree cannot know which it belongs
 * to), so it touches no story node and is listed beside the forest (U1). Whether an edit is
 * unclaimed is decided by the claim, never by the files: the agent link's own attribution
 * (`attributeFrom`) says which capability each counts toward, and one it gives none is unclaimed.
 */
import { attributeFrom, labelOf, type Line } from "@storytree/agent-link/readings";

/** One unclaimed edit or command. */
export interface UnclaimedEntry {
  session: string;
  /** The agent as people call it: "Claude Code", "Codex". */
  agent: string;
  /** The files an edit touched; none for a command. */
  files: string[];
  /** The command run, for a command. */
  command?: string;
  /** When, as an ISO 8601 timestamp. */
  at: string;
}

/** The project's unclaimed work: its count, and its entries, newest first. */
export interface UnclaimedWork {
  count: number;
  entries: UnclaimedEntry[];
}

/** The unclaimed work `lines` show. */
export function unclaimedWork(lines: readonly Line[]): UnclaimedWork {
  const harnesses = new Map<string, string>();
  for (const line of lines) if (line.harness !== undefined && !harnesses.has(line.session)) harnesses.set(line.session, line.harness);
  const entries = attributeFrom(lines)
    .filter(({ capability, increment }) => capability === undefined && increment === undefined)
    .map(({ line }): UnclaimedEntry => ({
      session: line.session,
      agent: labelOf(line.harness ?? harnesses.get(line.session)),
      files: line.kind === "file-edited" ? [...line.files] : [],
      ...(line.kind === "command-run" ? { command: line.command } : {}),
      at: line.at,
    }))
    .reverse();
  return { count: entries.length, entries };
}
