// Capability 17 · Friction
import { homedir } from "node:os";
import path from "node:path";

export interface DraftFrom {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
  readonly project: string;
  readonly folder: string;
}

const MOST = 4_000;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
