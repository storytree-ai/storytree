// Capability 16 · Build and launch
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export function changedOnItsWay(argv: readonly string[], handed: readonly string[] | undefined, launched: string | undefined): string | undefined {
  const changed = handed === undefined ? -1 : changedWord(argv, handed);
  if (changed !== -1) {
    return `storytree did nothing: the shell pnpm runs scripts through changed word ${changed + 1} ("${preview(handed?.[changed] ?? "")}") on its way here, as it does a $ or a line break. Put that text in a file and pass @<file> in its place, as in --answer @answer.txt.`;
  }
  const requoted = launched === undefined ? undefined : changedByQuoting(launched, argv);
  if (requoted !== undefined) {
    return `storytree did nothing: word ${requoted + 1} ("${preview(argv[requoted] ?? "")}") arrived with its double quotes changed, as Windows PowerShell 5.1 hands on a word that holds a space and a double quote. Put that text in a file and pass @<file> in its place, as in --answer @answer.txt, or write each double quote inside it as \\".`;
  }
  return undefined;
}

function preview(word: string): string {
  const line = word.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 40 || line.length < word.length ? `${line.slice(0, 40)}…` : line;
}

function changedWord(argv: readonly string[], handed: readonly string[]): number {
  const at = handed.findIndex((word, index) => argv[index] !== word);
  return at !== -1 || argv.length === handed.length ? at : handed.length;
}

export function handedToPnpm(env: NodeJS.ProcessEnv, entry: string | undefined): string[] | undefined {
  const { npm_lifecycle_event: name, npm_lifecycle_script: line, PNPM_SCRIPT_SRC_DIR: dir } = env;
  if (name === undefined || line === undefined || dir === undefined || entry === undefined) return undefined;
  try {
    const script = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts?.[name];
    const ownEntry = path.relative(realpathSync(dir), realpathSync(entry)).split(path.sep).join("/");
    if (typeof script !== "string" || !script.endsWith(ownEntry) || !line.startsWith(script)) return undefined;
    const words: string[] = [];
    for (let at = script.length; at < line.length; ) {
      if (!line.startsWith(' "', at)) return undefined;
      let end = at + 2;
      while (end < line.length && line[end] !== '"') end += line[end] === "\\" ? 2 : 1;
      if (end >= line.length) return undefined;
      words.push(JSON.parse(line.slice(at + 1, end + 1)) as string);
      at = end + 1;
    }
    return words;
  } catch {
    return undefined;
  }
}

function changedByQuoting(line: string, argv: readonly string[]): number | undefined {
  const read = windowsWords(line);
  if (read.words.length !== argv.length || read.words.some((word, index) => word !== argv[index])) return undefined;
  return read.odd;
}

function windowsWords(line: string): { words: string[]; odd?: number } {
  const words: string[] = [];
  let odd: number | undefined;
  const blank = (at: number) => line[at] === " " || line[at] === "\t";
  let at = 0;
  for (;;) {
    while (blank(at)) at++;
    if (at >= line.length) break;
    let word = "";
    let quoted = false;
    while (at < line.length && (quoted || !blank(at))) {
      let slashes = 0;
      while (line[at] === "\\") { slashes++; at++; }
      if (line[at] !== '"') {
        word += "\\".repeat(slashes);
        if (at < line.length && (quoted || !blank(at))) word += line[at++];
        continue;
      }
      word += "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) { word += '"'; at++; continue; }
      if (quoted && line[at + 1] === '"') { word += '"'; at += 2; continue; }
      if (quoted && at + 1 < line.length && !blank(at + 1)) odd ??= words.length;
      quoted = !quoted;
      at++;
    }
    if (quoted) odd ??= words.length;
    words.push(word);
  }
  return odd === undefined ? { words } : { words, odd };
}
