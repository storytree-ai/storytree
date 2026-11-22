// Capability 3 · Hooks
import { statSync } from "node:fs";
import path from "node:path";

type Token = { word: string } | { op: string };

const OPS = ["&>>", "<<<", "<<-", ">>", ">|", ">&", "&>", "<<", "<>", "<&", "||", "|&", "&&", ";;", "|", "&", ";", "<", ">", "(", ")"];
const WRITES = new Set([">", ">>", ">|", "&>", "&>>", ">&"]);
const REDIRECTS = new Set([...WRITES, "<", "<<", "<<-", "<<<", "<>", "<&"]);

function tokens(command: string): Token[] {
  const found: Token[] = [];
  const pending: { end: string; tabs: boolean }[] = [];
  let word: string | undefined;
  let quoted = false;
  let heredoc: string | undefined;
  const end = () => {
    if (word === undefined) return;
    found.push({ word });
    if (heredoc !== undefined) pending.push({ end: word, tabs: heredoc === "<<-" });
    word = undefined;
    quoted = false;
    heredoc = undefined;
  };
  let i = 0;
  while (i < command.length) {
    const c = command[i]!;
    if (c === "\\") {
      if (command[i + 1] !== "\n") word = (word ?? "") + (command[i + 1] ?? "");
      quoted = true;
      i += 2;
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const stop = close < 0 ? command.length : close;
      word = (word ?? "") + command.slice(i + 1, stop);
      quoted = true;
      i = stop + 1;
    } else if (c === '"') {
      let text = "";
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && '"\\$`'.includes(command[i + 1] ?? "")) i += 1;
        text += command[i] ?? "";
        i += 1;
      }
      word = (word ?? "") + text;
      quoted = true;
      i += 1;
    } else if (c === " " || c === "\t" || c === "\r") {
      end();
      i += 1;
    } else if (c === "\n") {
      end();
      found.push({ op: "\n" });
      i += 1;
      for (const { end: last, tabs } of pending.splice(0)) {
        while (i < command.length) {
          const stop = command.indexOf("\n", i) < 0 ? command.length : command.indexOf("\n", i);
          const line = command.slice(i, stop);
          i = stop + 1;
          if ((tabs ? line.replace(/^\t+/, "") : line) === last) break;
        }
      }
    } else if (c === "#" && word === undefined) {
      while (i < command.length && command[i] !== "\n") i += 1;
    } else if ("|&;<>()".includes(c)) {
      if ((c === "<" || c === ">") && !quoted && word !== undefined && /^\d+$/.test(word)) word = undefined;
      else end();
      const op = OPS.find((candidate) => command.startsWith(candidate, i))!;
      found.push({ op });
      if (op === "<<" || op === "<<-") heredoc = op;
      i += op.length;
    } else {
      word = (word ?? "") + c;
      i += 1;
    }
  }
  end();
  return found;
}

function operands(args: readonly string[], valued: readonly string[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--") return [...found, ...args.slice(i + 1)];
    if (valued.includes(arg)) i += 1;
    else if (!arg.startsWith("-") || arg === "-") found.push(arg);
  }
  return found;
}

function inPlace(args: readonly string[], scripts: readonly string[]): string[] {
  if (!args.some((arg) => /^-[^-]*i/.test(arg) || arg.startsWith("--in-place"))) return [];
  const files = operands(args, scripts);
  return args.some((arg) => scripts.includes(arg) || arg.startsWith("--expression") || arg.startsWith("--file")) ? files : files.slice(1);
}

function copied(args: readonly string[], folder: string, valued: readonly string[]): string[] {
  if (args.includes("-d")) return [];
  const named = args.find((arg) => arg.startsWith("--target-directory="))?.slice("--target-directory=".length) ?? (args.includes("-t") ? args[args.indexOf("-t") + 1] : undefined);
  const files = operands(args, [...valued, "-t"]);
  const into = named ?? files.at(-1);
  if (into === undefined || (named === undefined && files.length < 2)) return [];
  const sources = named === undefined ? files.slice(0, -1) : files;
  const folderTarget = named !== undefined || into.endsWith("/") || statSync(path.resolve(folder, into), { throwIfNoEntry: false })?.isDirectory() === true;
  return folderTarget ? sources.map((source) => path.join(into, path.basename(source))) : [into];
}

const SCRIPTS: [RegExp, string[], RegExp][] = [
  [/^node$/, ["-e", "--eval", "-p", "--print"], /\b(writeFile|appendFile|createWriteStream|copyFile|cp|rename|truncate)(Sync)?\s*\(/],
  [/^python(\d+(\.\d+)*)?$/, ["-c"], /\bopen\s*\([^)]*,\s*(mode\s*=\s*)?['"][^'"]*[wax+]|\.write_(text|bytes)\s*\(|\bshutil\.(copy\w*|move)\s*\(|\bos\.(rename|replace)\s*\(/],
  [/^ruby$/, ["-e"], /\b(File|IO)\.(write|binwrite|rename)\b|\bFile\.open[ (][^)]*,\s*['"][^'"]*[wa+]|\bFileUtils\./],
  [/^perl$/, ["-e"], /\bopen[ (][^;]*['"](\+?>|>>|\+<)|\brename\s*\(/],
];

function oneLiner(name: string, args: readonly string[]): boolean {
  const [, flags, writes] = SCRIPTS.find(([pattern]) => pattern.test(name)) ?? [];
  if (flags === undefined || writes === undefined) return false;
  return args.some((arg, i) => flags.includes(arg) && writes.test(args[i + 1] ?? ""));
}

function script(args: readonly string[]): string | undefined {
  const flag = args.findIndex((arg) => /^-[A-Za-z]+$/.test(arg) && arg.includes("c"));
  return flag < 0 ? undefined : args.slice(flag + 1).find((arg) => !arg.startsWith("-"));
}

function written(argv: readonly string[], folder: string): ShellWrites {
  const none = { files: [], interpreters: [] };
  const start = argv.findIndex((word) => !/^[A-Za-z_]\w*=/.test(word));
  if (start < 0) return none;
  const name = path.basename(argv[start]!);
  const args = argv.slice(start + 1);
  const files = (found: string[]) => ({ files: found.map((file) => path.resolve(folder, file)), interpreters: [] });
  if (oneLiner(name, args)) return { files: [], interpreters: [name] };
  if ((name === "sh" || name === "bash") && script(args) !== undefined) return shellWrites(script(args)!, folder);
  if (name === "tee") return files(operands(args, []));
  if (name === "touch") return files(operands(args, ["-d", "-r", "-t"]));
  if (name === "sed") return files(inPlace(args, ["-e", "-f"]));
  if (name === "perl") return files(inPlace(args, ["-e", "-E"]));
  if (name === "cp" || name === "mv") return files(copied(args, folder, ["-S"]));
  if (name === "install") return files(copied(args, folder, ["-m", "-o", "-g", "-S"]));
  return none;
}

export type ShellWrites = { files: string[]; interpreters: string[] };

export function shellWrites(command: string, folder: string): ShellWrites {
  const found: ShellWrites = { files: [], interpreters: [] };
  const outer: string[] = [];
  let here = folder;
  let argv: string[] = [];
  const all = [...tokens(command), { op: ";" }];
  for (let i = 0; i < all.length; i += 1) {
    const token = all[i]!;
    if ("word" in token) argv.push(token.word);
    else if (REDIRECTS.has(token.op)) {
      const next = all[i + 1];
      const target = next !== undefined && "word" in next ? next.word : undefined;
      if (target === undefined) continue;
      i += 1;
      if (WRITES.has(token.op) && !(token.op === ">&" && /^(\d+|-)$/.test(target)) && !target.startsWith("/dev/")) found.files.push(path.resolve(here, target));
    } else {
      const { files, interpreters } = written(argv, here);
      found.files.push(...files);
      found.interpreters.push(...interpreters);
      const into = argv[0] === "cd" || argv[0] === "pushd" ? operands(argv.slice(1), [])[0] : undefined;
      if (into !== undefined && into !== "-") here = path.resolve(here, into);
      if (token.op === "(") outer.push(here);
      if (token.op === ")") here = outer.pop() ?? here;
      argv = [];
    }
  }
  return found;
}
