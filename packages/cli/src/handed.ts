/**
 * Capability 1 · Front door. The words given to storytree, as they were handed on, so a word changed on its way is refused.
 *
 * - `pnpm storytree` (ADR-0851 D2, front door contract 1.11): pnpm runs a package script by appending
 *   each word to the script's line as a JSON string and handing that line to a shell, which can still
 *   change a word on its way here: the shell emulator this repository runs scripts through (.npmrc)
 *   expands a `$` and leaves a line break as `\n`. pnpm also leaves the line it built in
 *   `npm_lifecycle_script`, which no shell reads, so the words can be read back from it.
 * - The installed command on Windows (ADR-0856 D2, contract 1.12): its launcher passes the caller's line
 *   on in STORYTREE_COMMAND_LINE (ADR-0854), and a word whose quotes the caller's own quoting changed,
 *   as Windows PowerShell 5.1's does, shows in how that line is quoted.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * The words pnpm appended to the script that ran `entry`, this command's own script; undefined when no
 * pnpm script ran it, or pnpm's line is not in that form.
 */
export function handedToPnpm(env: NodeJS.ProcessEnv, entry: string | undefined): string[] | undefined {
  const { npm_lifecycle_event: name, npm_lifecycle_script: line, PNPM_SCRIPT_SRC_DIR: dir } = env;
  if (name === undefined || line === undefined || dir === undefined || entry === undefined) return undefined;
  try {
    const script = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts?.[name];
    // Only the words of a script that ends by running this command are its words: a variable inherited from another script's run is not.
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

/**
 * The first word the installed command was handed changed by its caller's own quoting (ADR-0856 D2, front door
 * contract 1.12), or undefined when every word reads as written. On Windows the launcher passes the caller's line
 * on in STORYTREE_COMMAND_LINE (ADR-0854); read by Windows' rules, the ones Node's own words come from, it gives the
 * words that arrived. A standard quoter closes a word's quotes only at the word's end, and always closes them:
 * a closing quote with text right after it, or a quote never closed, is how Windows PowerShell 5.1 writes a word
 * that holds a space and a double quote. A line whose reading is not the words that arrived is not this command's
 * own, and says nothing.
 */
export function changedByQuoting(line: string, argv: readonly string[]): number | undefined {
  const read = windowsWords(line);
  if (read.words.length !== argv.length || read.words.some((word, index) => word !== argv[index])) return undefined;
  return read.odd;
}

/** A program's words by the C runtime's rules on Windows, and the first one quoted as no standard quoter writes it. */
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
        // Backslashes not before a quote are themselves.
        word += "\\".repeat(slashes);
        if (at < line.length && (quoted || !blank(at))) word += line[at++];
        continue;
      }
      word += "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) { word += '"'; at++; continue; }
      // Inside quotes, two quotes are one quote, written.
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
