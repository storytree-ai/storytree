/**
 * Capability 17 · Friction, the draft issue for friction about storytree itself (question_03c165b887c7, option A): a
 * link to a new issue on storytree's repository, the same one Help > Send feedback opens, pre-filled from the friction
 * with the user's paths and project name stripped. storytree sends nothing: the user reviews it and submits it.
 */
import { homedir } from "node:os";
import path from "node:path";

/** What a draft is made from: the friction as filed, and what would name the user's project or computer. */
export interface DraftFrom {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
  readonly project: string;
  readonly folder: string;
}

/** GitHub refuses a very long new-issue link, so the body is cut well short of it. */
const MOST = 4_000;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with the project's folder, the home folder, other absolute paths (each kept to its last name) and the project's name stripped. */
function stripped(text: string, from: DraftFrom): string {
  let out = text;
  for (const folder of new Set([from.folder, from.folder.replaceAll("\\", "/")])) out = out.replaceAll(folder, "<project folder>");
  for (const home of new Set([homedir(), homedir().replaceAll("\\", "/")])) {
    out = out.replace(new RegExp(`${escaped(home)}((?:[\\\\/][^\\s\\\\/"'\`<>|]+)*)`, "g"), (_, rest: string) => (rest ? `<path>/${rest.split(/[\\/]/).at(-1)}` : "<home>"));
  }
  out = out
    .replace(/(?<![\w.:/~<>-])\/(?:[^\s/"'`<>|]+\/)+([^\s/"'`<>|]*)/g, "<path>/$1")
    .replace(/\b[A-Za-z]:\\(?:[^\s\\"'`<>|]+\\)*([^\s\\"'`<>|]*)/g, "<path>\\$1");
  for (const name of new Set([from.project, path.basename(from.folder)].filter((one) => one.trim()))) {
    out = out.replace(new RegExp(`(?<![\\w-])${escaped(name)}(?![\\w-])`, "gi"), "<project>");
  }
  return out;
}

/** The new-issue link for friction about storytree, its title and body the friction's, stripped. */
export function issueDraft(from: DraftFrom): string {
  const body = stripped([
    from.description,
    `**What went wrong**\n${from.statement}`,
    `**Evidence**\n${from.evidence}`,
    `**What it cost**\n${from.impact}`,
    "_Drafted from friction an agent recorded; paths and the project's name were stripped. Review it before submitting._",
  ].join("\n\n"), from);
  const url = new URL("https://github.com/storytree-ai/storytree/issues/new");
  url.searchParams.set("title", stripped(from.title, from));
  url.searchParams.set("body", body.length > MOST ? `${body.slice(0, MOST)}…` : body);
  return url.href;
}
