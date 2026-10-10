// Builds the launcher (which hands its raw words on as STORYTREE_COMMAND_LINE, ADR-0856 D1), installs it around a
// script that records argv and that line, and starts it from each caller. Prints what each caller sent.
// Run on Windows from this checkout: node --import tsx packages/cli/evidence/powershell-quoting/probe.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLauncher } from "@storytree/app-setup/bins";

const dir = mkdtempSync(path.join(tmpdir(), "storytree ps51 "));
const bin = path.join(dir, "bin");
mkdirSync(bin);
const program = path.join(dir, "program.exe");
buildLauncher(program, process.arch === "arm64" ? "arm64" : "x64");
const script = path.join(dir, "record.mjs");
const heard = path.join(dir, "heard.jsonl");
writeFileSync(script, 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.HEARD, JSON.stringify({ argv: process.argv.slice(2), line: process.env.STORYTREE_COMMAND_LINE }) + "\\n");');
const text = Buffer.from(`storytree 0.3's command (put here by its setup check)\n${process.execPath}\n${script}\n`, "utf8");
const trailer = Buffer.alloc(8);
trailer.writeUInt32LE(text.length, 0);
trailer.write("stlr", 4, "latin1");
writeFileSync(path.join(bin, "storytree.exe"), Buffer.concat([readFileSync(program), text, trailer]));
const env = { ...process.env, PATH: bin, Path: bin, HEARD: heard };

const cases: [string, string[]][] = [
  ["inner quote with spaces", ['he said "website -> forest -> the rest" ok']],
  ["inner quote, no spaces", ['a"b']],
  ["quoted word, no spaces", ['"yes"']],
  ["starts with a quote", ['"A" (recommended)']],
  ["ends with a quote", ['say "hi"']],
  ["folder with a trailing backslash", ["C:\\a folder\\", "next"]],
  ["plain words", ["arc", "show", "a b", "x>y", "100%"]],
  ["escaped as PowerShell 5.1 needs", ['he said \\"x\\" ok']],
  ["flag with a quoted value", ['--title="a b"']],
];
const ps = (words: string[]) => `& storytree ${words.map((word) => `'${word.replaceAll("'", "''")}'`).join(" ")}`;
const sh = (words: string[]) => `storytree ${words.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ")}`;
const callers: [string, (words: string[]) => unknown][] = [
  ["PowerShell 5.1", (words) => spawnSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps(words), "utf16le").toString("base64")], { env, cwd: dir })],
  ["Git Bash", (words) => spawnSync("C:\\Program Files\\Git\\bin\\bash.exe", ["-c", sh(words)], { env, cwd: dir })],
  ["Node", (words) => spawnSync("storytree", words, { env, cwd: dir })],
];
for (const [name, words] of cases) {
  console.log(`== ${name}: ${JSON.stringify(words)}`);
  for (const [caller, start] of callers) {
    rmSync(heard, { force: true });
    start(words);
    let got = "(nothing heard)";
    try { got = readFileSync(heard, "utf8").trim(); } catch { /* nothing */ }
    console.log(`  ${caller.padEnd(15)} ${got}`);
  }
}
rmSync(dir, { recursive: true, force: true });
