// Capability 2 · Agent activity log
import { labelOf } from "../sessions/index.js";
import type { Line } from "@storytree/library";

const BECAUSE = { idle: "idle", gone: "gone", restart: "machine restarted", "closed-out": "closed out", stopped: "heartbeat stopped" } as const;

function quiet(line: Extract<Line, { kind: "claimed" }>): string {
  if (line.quietSince === undefined || line.takenBecause === undefined) return "";
  const ms = Math.max(0, Date.parse(line.at) - Date.parse(line.quietSince));
  const span = ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 120 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
  return ` after ${span} quiet (${BECAUSE[line.takenBecause]})`;
}

function about(line: Line, full: boolean): string {
  switch (line.kind) {
    case "tool-requested":
    case "tool-called":
      return ` ${line.tool}`;
    case "note-read":
      return ` ${line.note} (${line.read}, found by ${line.found})`;
    case "claimed":
      return ` ${line.increment ?? line.capability}${line.file === undefined ? "" : `, editing ${line.file}`}${line.takenOverFrom === undefined ? "" : `, taken over from ${line.takenOverFrom}${quiet(line)}`}`;
    case "claim-refused":
      return ` ${line.increment ?? line.capability} held by ${line.holder}${line.file === undefined ? "" : `, editing ${line.file}`}: ${line.reason}`;
    case "released":
      return ` ${line.increment ?? line.capability}${line.holder === undefined ? "" : ` for ${line.holder}${line.reason === undefined ? "" : `: ${line.reason}`}`}`;
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

function text(line: Line, full: boolean): string {
  const cause = line.causedBy === undefined ? "cause not recorded" : `caused by #${line.causedBy}`;
  return `#${line.seq}  ${line.at}  ${labelOf(line.harness)} ${line.session}  ${line.kind}${about(line, full)}  · ${cause}`;
}

export function lineText(line: Line): string {
  return text(line, false);
}

export function fullLineText(line: Line): string {
  return text(line, true);
}
