// What each caller gets from the installed command as it stands (evidence for ADR-0854's red).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installCommand, toolPaths } from "../../src/deliver/index.js";

const dir = mkdtempSync(path.join(tmpdir(), "storytree red "));
const tools = toolPaths(path.join(dir, "install"), "win32");
mkdirSync(tools.dir, { recursive: true });
const stub = process.env.STUB;
if (stub) writeFileSync(path.join(tools.dir, "storytree-launcher.exe"), readFileSync(stub));
const heard = path.join(dir, "heard.jsonl");
writeFileSync(tools.cli, 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.STORYTREE_HEARD, JSON.stringify(process.argv.slice(2)) + "\\n");');
const installed = installCommand({ home: path.join(dir, "home"), tools: { ...tools, node: process.execPath }, searchPath: "" });
console.log("installed:", path.basename(installed.file));
const folder = path.join(dir, "a project");
mkdirSync(folder);
const env = { ...process.env, PATH: installed.pathEntry, Path: installed.pathEntry, STORYTREE_HEARD: heard };
const plain = ["a&echo", "INJECTED", "x|y", "x>y", "100%PATH%", "^caret"];
const words = [...plain, 'he said "website -> forest -> the rest" ok', "C:\\a folder\\"];
const report = (caller: string, ran: { stdout: string; stderr: string; error?: Error }) => {
  console.log(`--- ${caller}`);
  console.log("heard:", existsSync(heard) ? readFileSync(heard, "utf8").trim() : "(nothing)");
  console.log("files written in the folder:", JSON.stringify(readdirSync(folder)));
  console.log("output:", JSON.stringify(`${ran.error?.message ?? ""}${ran.stdout}${ran.stderr}`.trim()).slice(0, 300));
  for (const file of readdirSync(folder)) rmSync(path.join(folder, file), { force: true });
  rmSync(heard, { force: true });
};
const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
const sh = (list: string[]) => list.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ");
report("Git Bash, by name", spawnSync(bash, ["-c", `storytree ${sh(words)}`], { cwd: folder, env, encoding: "utf8" }));
report("Git Bash, as storytree.cmd", spawnSync(bash, ["-c", `storytree.cmd ${sh(words)}`], { cwd: folder, env, encoding: "utf8" }));
report("a program (Node, no shell)", spawnSync("storytree", words, { cwd: folder, env, encoding: "utf8" }));
const script = `& storytree ${plain.map((word) => `'${word.replaceAll("'", "''")}'`).join(" ")}`;
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
report("Windows PowerShell 5.1", spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd: folder, env, encoding: "utf8" }));
rmSync(dir, { recursive: true, force: true });
