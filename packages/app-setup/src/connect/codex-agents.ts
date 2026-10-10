/**
 * Capability 2 · Connect an agent: instructions for Codex (contract 2.9). Codex keeps a tool server's tools out of
 * the agent's first view until it searches for them, and never shows the server's instructions, so
 * the habits card does not reach a Codex session. The AGENTS.md in Codex's home does, in every
 * session, whether or not the user has trusted storytree's hooks yet. So connecting Codex writes one
 * short storytree section there, between markers, that sends the agent to check_setup before its
 * first change in a storytree project and keeps it silent everywhere else (ADR-0752 D3). Only that
 * section is ever written or taken out: the rest of the file is the user's.
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BEGIN = "<!-- storytree: begin -->";
const END = "<!-- storytree: end -->";

const SECTION = `${BEGIN}
## storytree
A folder with a \`.storytree.json\` file is a storytree project: storytree keeps its plan and records the work, so the user can watch it grow. Before your first change in such a folder, find storytree's tools (search your tools for "storytree"), call \`check_setup\`, tell the user in plain words anything it asks of them, and do what it says. In any other folder, ignore storytree and do not mention it.
${END}
`;

/** What writing found: the section written now, already there as it is, or no Codex home here. */
export type CodexInstructionsWrite = "written" | "already written" | "not here";

/** Write storytree's section into `codexHome`'s AGENTS.md, replacing an older one, leaving the rest as it was. */
export function writeCodexInstructions(codexHome: string): CodexInstructionsWrite {
  if (!isFolder(codexHome)) return "not here";
  const file = path.join(codexHome, "AGENTS.md");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const { before, section, after } = split(current);
  if (section === SECTION) return "already written";
  const own = `${before}${after}`;
  writeFileSync(file, own.trim() === "" ? SECTION : `${own.replace(/\n*$/, "\n\n")}${SECTION}`);
  return "written";
}

/** Take storytree's section out of `codexHome`'s AGENTS.md; a file left with nothing else in it goes too. */
export function removeCodexInstructions(codexHome: string): "removed" | "none" {
  const file = path.join(codexHome, "AGENTS.md");
  if (!existsSync(file)) return "none";
  const { before, section, after } = split(readFileSync(file, "utf8"));
  if (section === undefined) return "none";
  const own = `${before.replace(/\n\n$/, "\n")}${after}`;
  if (own.trim() === "") rmSync(file);
  else writeFileSync(file, own);
  return "removed";
}

/** The text before storytree's section, the section with its line end, and the text after it. */
function split(text: string): { before: string; section?: string; after: string } {
  const start = text.indexOf(BEGIN);
  const end = start < 0 ? -1 : text.indexOf(END, start);
  if (start < 0 || end < 0) return { before: text, after: "" };
  const stop = end + END.length + (text.startsWith("\n", end + END.length) ? 1 : 0);
  return { before: text.slice(0, start), section: text.slice(start, stop), after: text.slice(stop) };
}

function isFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
