import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { disconnectAgents, installedToolServerCommand } from "@storytree/app-setup/connect";

import { finishDelivery, installCommand, toolPaths, verifyPayload, writePayloadManifest } from "./index.js";
import { waitForApp } from "./delivery.js";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree delivery "));
  const install = path.join(dir, "Program Files", "storytree-0.3");
  const home = path.join(dir, ".storytree", "0.3");
  const tools = toolPaths(install, "win32");
  mkdirSync(path.join(tools.dir, "chunks"), { recursive: true });
  for (const file of [tools.node, tools.mcp, tools.hook, tools.setup, tools.cli, tools.deliver, tools.app]) writeFileSync(file, "a runnable fixture");
  writeFileSync(path.join(tools.dir, "chunks", "shared.mjs"), "export const compatible = true;");
  writePayloadManifest(tools.dir, "arm64", "24.21.0");
  return { dir, install, home, tools, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("1.1 / 1.5: a delivered payload includes every imported chunk and rejects a damaged or wrong-architecture runtime", () => {
  const f = fixture();
  try {
    const runtime = path.join(f.tools.dir, "node_modules", "@huggingface", "transformers", "package.json");
    mkdirSync(path.dirname(runtime), { recursive: true });
    writeFileSync(runtime, '{"name":"@huggingface/transformers"}');
    writePayloadManifest(f.tools.dir, "arm64", "24.21.0");
    assert.equal(verifyPayload(f.install, "arm64", "win32").node, f.tools.node);
    writeFileSync(runtime, "changed without a release");
    assert.throws(() => verifyPayload(f.install, "arm64", "win32"), /Damaged payload file/);
    writeFileSync(runtime, '{"name":"@huggingface/transformers"}');
    assert.throws(() => verifyPayload(f.install, "x64", "win32"), /architecture/i);
    rmSync(path.join(f.tools.dir, "chunks", "shared.mjs"));
    assert.throws(() => verifyPayload(f.install, "arm64", "win32"), /shared.mjs/);
    writeFileSync(path.join(f.tools.dir, "chunks", "shared.mjs"), "changed without a release");
    assert.throws(() => verifyPayload(f.install, "arm64", "win32"), /shared.mjs/);
  } finally { f.close(); }
});

test("1.2 / 1.3: first delivery and a repeat always launch the app visibly, wait for its database, and preserve projects and settings", async () => {
  const f = fixture();
  const events: string[] = [];
  mkdirSync(f.home, { recursive: true });
  const old = path.join(f.dir, ".storytree", "secrets.json");
  writeFileSync(old, "0.2 must survive");
  writeFileSync(path.join(f.home, "project-choice.json"), "existing project choice");
  const options = { installDir: f.install, home: f.home, arch: "arm64" as const, platform: "win32" as const, searchPath: "" };
  const effects = {
    launch: async (exe: string) => { assert.equal(exe, f.tools.app); events.push("launch"); },
    waitForApp: async (home: string) => { assert.equal(home, f.home); events.push("database"); },
  };
  try {
    assert.equal(existsSync(path.join(f.home, "app.json")), false);
    const first = await finishDelivery(options, effects);
    const record = readFileSync(path.join(f.home, "delivery.json"), "utf8");
    const again = await finishDelivery(options, effects);
    assert.deepEqual(events, ["launch", "database", "launch", "database"]);
    assert.equal(first.command.status, "installed");
    assert.equal(again.command.status, "already installed");
    assert.equal(readFileSync(path.join(f.home, "delivery.json"), "utf8"), record);
    assert.equal(readFileSync(old, "utf8"), "0.2 must survive");
    assert.equal(readFileSync(path.join(f.home, "project-choice.json"), "utf8"), "existing project choice");
    assert.equal(existsSync(path.join(f.dir, ".storytree.json")), false);
    // Ordinary release replacement keeps the registered paths while changing the tools together.
    writeFileSync(f.tools.cli, "new compatible release");
    writePayloadManifest(f.tools.dir, "arm64", "24.21.0");
    assert.equal(verifyPayload(f.install, "arm64", "win32").cli, first.tools.cli);
  } finally { f.close(); }
});

test("1.4: failure to launch or reach the app never publishes a successful installation over the last usable record", async () => {
  const f = fixture();
  mkdirSync(f.home, { recursive: true });
  writeFileSync(path.join(f.home, "delivery.json"), "last usable installation");
  try {
    for (const failed of ["launch", "database"] as const) {
      await assert.rejects(finishDelivery({ installDir: f.install, home: f.home, arch: "arm64", platform: "win32", searchPath: "" }, {
        launch: async () => { if (failed === "launch") throw new Error("launch refused"); },
        waitForApp: async () => { throw new Error("database timeout"); },
      }), new RegExp(failed));
      assert.equal(readFileSync(path.join(f.home, "delivery.json"), "utf8"), "last usable installation");
      assert.equal(existsSync(path.join(f.home, "bin", "storytree.cmd")), false);
    }
  } finally { f.close(); }
});

test("1.6: command conflicts of every Windows executable kind are named and left untouched", () => {
  const f = fixture();
  const external = path.join(f.dir, "Other tools");
  mkdirSync(external);
  try {
    for (const ext of ["exe", "cmd", "bat", "com", "ps1", "vbs", "js", "custom", ""]) {
      const file = path.join(external, `storytree${ext ? `.${ext}` : ""}`);
      writeFileSync(file, "another installation");
      const result = installCommand({ home: f.home, tools: f.tools, platform: "win32", searchPath: external, pathExt: ".EXE;.CMD;.BAT;.COM;.VBS;.JS;.CUSTOM" });
      assert.equal(result.status, "conflict");
      assert.equal(result.conflict, file);
      assert.equal(readFileSync(file, "utf8"), "another installation");
      assert.equal(existsSync(path.join(f.home, "bin", "storytree.cmd")), false);
      rmSync(file);
    }
    const result = installCommand({ home: f.home, tools: f.tools, platform: "win32", searchPath: "" });
    assert.equal(result.status, "installed");
    assert.ok(readFileSync(result.file, "utf8").includes(`"${f.tools.node}" "${f.tools.cli}"`));
    assert.equal(result.pathEntry, path.join(f.home, "bin"));
    const nonDirectory = path.join(f.dir, "not a PATH directory");
    writeFileSync(nonDirectory, "ordinary file");
    assert.equal(installCommand({ home: f.home, tools: f.tools, platform: "win32", searchPath: nonDirectory }).status, "already installed");
  } finally { f.close(); }
});

test("1.6: finish repoints an older storytree launcher on PATH and says which one it replaced", () => {
  const f = fixture();
  const cargo = path.join(f.dir, ".cargo", "bin");
  mkdirSync(cargo, { recursive: true });
  const older = path.join(cargo, "storytree.cmd");
  writeFileSync(older, "@echo off\r\nrem storytree 0.3's command (put here by its setup check)\r\n\"node\" \"source build storytree.mjs\" %*\r\n");
  try {
    const first = installCommand({ home: f.home, tools: f.tools, platform: "win32", searchPath: cargo });
    assert.deepEqual(first.replaced, [older]);
    assert.equal(readFileSync(older, "utf8"), readFileSync(first.file, "utf8"));
    assert.deepEqual(installCommand({ home: f.home, tools: f.tools, platform: "win32", searchPath: cargo }).replaced, []);
  } finally { f.close(); }
});

test("1.1: a payload cannot bless a missing entry point or a path outside its installation", () => {
  const f = fixture();
  try {
    rmSync(f.tools.setup);
    assert.throws(() => writePayloadManifest(f.tools.dir, "arm64", "24.21.0"), /storytree-setup/);
    const file = path.join(f.tools.dir, "payload.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.files["../outside"] = createHash("sha256").update("secret").digest("hex");
    writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => verifyPayload(f.install, "arm64", "win32"), /payload|outside|setup/i);
  } finally { f.close(); }
});

test("1.6: a fresh shell runs the installed command with spaces and preserves its exit code", () => {
  const f = fixture();
  try {
    writeFileSync(f.tools.cli, 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 23;');
    const installed = installCommand({ home: f.home, tools: { ...f.tools, node: process.execPath }, searchPath: "" });
    const result = spawnSync('storytree "an argument with spaces"', {
      shell: true, cwd: f.dir, env: { ...process.env, PATH: installed.pathEntry, Path: installed.pathEntry }, encoding: "utf8",
    });
    assert.equal(result.status, 23, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["an argument with spaces"]);
  } finally { f.close(); }
});

test("1.9 on Windows, the installed command hands each word on as the caller's line spelled it: run by name from Git Bash, Windows PowerShell or a program, no word is cut at a > or &, nothing else runs and no file is written (ADR-0854)", {
  skip: process.platform !== "win32" && "platform:win32: only Windows starts a command's file through cmd.exe, which reads its words as its own syntax",
}, () => {
  const f = fixture();
  try {
    const heard = path.join(f.dir, "heard.jsonl");
    writeFileSync(f.tools.cli, 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.STORYTREE_HEARD, JSON.stringify(process.argv.slice(2)) + "\\n");');
    const installed = installCommand({ home: f.home, tools: { ...f.tools, node: process.execPath }, searchPath: "" });
    const folder = path.join(f.dir, "a project");
    mkdirSync(folder);
    const env = { ...process.env, PATH: installed.pathEntry, Path: installed.pathEntry, STORYTREE_HEARD: heard };
    const hears = (caller: string, words: string[], run: () => { stdout: string; stderr: string; error?: Error }) => {
      rmSync(heard, { force: true });
      const ran = run();
      const said = `${caller}: ${ran.error?.message ?? ""}${ran.stdout}${ran.stderr}`;
      assert.deepEqual(existsSync(heard) ? readFileSync(heard, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [], [words], said);
      assert.deepEqual(readdirSync(folder), [], `${caller} wrote a file: ${said}`);
      assert.doesNotMatch(ran.stdout, /INJECTED/, `${caller} ran a second command: ${said}`);
    };
    // Words cmd.exe would read as its own syntax; then free text with an inner double quote, and a folder.
    const plain = ["a&echo", "INJECTED", "x|y", "x>y", "100%PATH%", "^caret"];
    const words = [...plain, 'he said "website -> forest -> the rest" ok', "C:\\a folder\\"];
    const bash = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
    assert.ok(existsSync(bash), `Git for Windows, which storytree needs, brings Git Bash: ${bash}`);
    const quoted = words.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ");
    hears("Git Bash", words, () => spawnSync(bash, ["-c", `storytree ${quoted}`], { cwd: folder, env, encoding: "utf8", timeout: 30_000 }));
    hears("a program", words, () => spawnSync("storytree", words, { cwd: folder, env, encoding: "utf8", timeout: 30_000 }));
    // Windows PowerShell 5.1 quotes a word with a space for every program it starts without escaping what is in it
    // (increment_e95ceec15288), so it is given only the words cmd.exe would misread.
    const script = `& storytree ${plain.map((word) => `'${word.replaceAll("'", "''")}'`).join(" ")}`;
    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    hears("Windows PowerShell", plain, () => spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd: folder, env, encoding: "utf8", timeout: 60_000 }));
  } finally { f.close(); }
});

test("1.6 / 2.5: disconnect recognises the delivered launcher and removes it once no agent is connected", async () => {
  const f = fixture();
  try {
    const launcher = installCommand({ home: f.home, tools: f.tools, searchPath: "" });
    const report = await disconnectAgents({
      harnesses: ["claude-code"], installed: installedToolServerCommand(f.tools.node, f.tools.mcp), home: f.dir,
      env: { PATH: launcher.pathEntry, CLAUDE_CONFIG_DIR: path.join(f.dir, ".claude"), CODEX_HOME: path.join(f.dir, ".codex") },
    });
    assert.equal(report.command, "removed");
    assert.equal(existsSync(launcher.file), false);
  } finally { f.close(); }
});

test("delivery on a Cloud SQL library waits for the app itself, not for a local database it never starts (app lifecycle 1.11)", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-delivery-cloud-"));
  const app = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ library: { location: "cloudsql", instance: "my-project:australia-southeast1:my-instance", user: "you@example.com" } }));
    writeFileSync(path.join(home, "app.json"), JSON.stringify({ command: "app.exe", args: [], pid: app.pid }));
    const started = Date.now();
    await waitForApp(home, 5_000);
    assert.ok(Date.now() - started < 5_000);
  } finally {
    app.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
