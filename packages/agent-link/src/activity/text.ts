/**
 * Capability 2 · the activity log as a person reads it (contract 7.4's board shows it): one line of
 * text per line, with its number, time, session, what happened, and the line that caused it, or
 * "cause not recorded" when its writer named none (ADR-0746 D2). Never "no cause": an absent stamp
 * says only that nothing recorded one.
 */
import { labelOf } from "../sessions/index.js";
import type { Line } from "./lines.js";

/** The words after a line's kind: what it was about. */
function about(line: Line, full: boolean): string {
  switch (line.kind) {
    case "tool-requested":
    case "tool-called":
      return ` ${line.tool}`;
    case "note-read":
      return ` ${line.note} (${line.read}, found by ${line.found})`;
    case "claimed":
    case "released":
      return ` ${line.increment ?? line.capability}`;
    case "landed":
      return ` ${line.capability}`;
    case "closed":
      return ` ${line.increment} ${line.disposition}`;
    case "merged":
      return ` ${line.increment ?? line.capability}, pull request ${line.pr}`;
    case "command-started":
    case "command-run":
      return ` ${!full && line.command.length > 60 ? `${line.command.slice(0, 57)}...` : line.command}`;
    case "file-edited":
      return ` ${line.files.length} file${line.files.length === 1 ? "" : "s"}`;
    case "subagent-started":
      return ` ${line.type ?? line.subagent}`;
    case "closed-out":
      return ` ${line.safe ? "safe" : "not safe"}: ${line.why}`;
    default:
      return "";
  }
}

/** Shared line identity and cause, whatever command detail the reader asks for. */
function text(line: Line, full: boolean): string {
  const cause = line.causedBy === undefined ? "cause not recorded" : `caused by #${line.causedBy}`;
  return `#${line.seq}  ${line.at}  ${labelOf(line.harness)} ${line.session}  ${line.kind}${about(line, full)}  · ${cause}`;
}

/** One log line as text, with long commands clipped to 60 characters. */
export function lineText(line: Line): string {
  return text(line, false);
}

/** One log line with its complete recorded command, including quotes and line breaks (2.9). */
export function fullLineText(line: Line): string {
  return text(line, true);
}
