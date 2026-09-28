/**
 * Capability 6 · Unclaimed work (the forest story): the edits and commands made by agents holding
 * no claim, who made them, which files, and when, grouped into expandable session rows. It is how work
 * outside the plan stays visible, even from an agent that never calls storytree, since its hooks
 * record its edits and commands anyway.
 *
 * Its shelf: unclaimed work is never guessed onto a story (storytree cannot know which it belongs
 * to), so it touches no story node and appears as off-plan evidence in the session list (U1). Whether an edit is
 * unclaimed is decided by the claim, never by the files: the agent link's own attribution
 * (`attributeFrom`) says which capability each counts toward, and one it gives none is unclaimed.
 * Everything is recorded; a session's unclaimed work needs attention (and so gets a row) only past
 * the line `needsAttention` draws.
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

/** Distinct unclaimed files at which a session's off-plan work needs attention. */
export const OFF_PLAN_FILE_LINE = 5;

/** Whether one session's unclaimed entries need attention: 5 distinct files, or a push or pull request. */
export function needsAttention(entries: readonly UnclaimedEntry[]): boolean {
  return new Set(entries.flatMap(entry => entry.files)).size >= OFF_PLAN_FILE_LINE ||
    entries.some(entry => entry.command !== undefined && reachesRemote(entry.command));
}

/** A `git push` (options before the verb allowed) or a `gh pr create`, anywhere in a command line. */
function reachesRemote(command: string): boolean {
  return command.split(/[;&|\n]+/).some(segment => {
    const words = segment.trim().split(/\s+/);
    const tool = words[0]?.replace(/\.exe$/i, "").split(/[\\/]/).pop();
    if (tool === "gh") return words[1] === "pr" && words[2] === "create";
    if (tool !== "git") return false;
    let i = 1;
    while (words[i]?.startsWith("-")) i += ["-C", "-c", "--git-dir", "--work-tree"].includes(words[i]!) ? 2 : 1;
    return words[i] === "push";
  });
}
