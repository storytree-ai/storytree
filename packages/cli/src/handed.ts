/**
 * The words given to `pnpm storytree`, as pnpm was handed them (front door contract 1.11). pnpm runs a
 * package script by appending each word to the script's line as a JSON string and handing that line
 * to a shell, which can still change a word on its way here: the shell emulator this repository runs
 * scripts through (.npmrc) expands a `$` and leaves a line break as `\n`. pnpm also leaves the line it
 * built in `npm_lifecycle_script`, which no shell reads, so the words can be read back from it.
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
