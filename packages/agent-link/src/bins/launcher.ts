/**
 * Build the `storytree` command for Windows (ADR-0854): a small program of its own, compiled from
 * ../setup/launcher.c with LLVM alone (clang, lld-link and llvm-dlltool), so no C library or Windows
 * SDK is needed and either Windows architecture builds on any machine that has LLVM. The setup check
 * and the installer append to it what it runs (../setup/command.ts).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The built program's name, beside the scripts it is told to run. */
export const LAUNCHER_PROGRAM = "storytree-launcher.exe";

const SOURCE = fileURLToPath(new URL("../setup/launcher.c", import.meta.url));
const TARGETS = {
  x64: { clang: "x86_64-pc-windows-msvc", dlltool: "i386:x86-64" },
  arm64: { clang: "aarch64-pc-windows-msvc", dlltool: "arm64" },
} as const;

/** Compile the launcher program for one Windows architecture into `file`. */
export function buildLauncher(file: string, arch: keyof typeof TARGETS): void {
  const target = TARGETS[arch];
  const work = mkdtempSync(path.join(tmpdir(), "storytree-launcher-"));
  try {
    // The kernel32 calls the source declares, one IMPORT line each, become the import library it links against.
    const calls = [...readFileSync(SOURCE, "utf8").matchAll(/^IMPORT\b[^(]*?(\w+)\(/gm)].map((match) => match[1]);
    const definition = path.join(work, "kernel32.def");
    const library = path.join(work, "kernel32.lib");
    const object = path.join(work, "launcher.obj");
    writeFileSync(definition, `LIBRARY kernel32.dll\nEXPORTS\n${calls.join("\n")}\n`);
    run("llvm-dlltool", ["-m", target.dlltool, "-d", definition, "-l", library]);
    run("clang", [`--target=${target.clang}`, "-O2", "-ffreestanding", "-fno-builtin", "-fno-stack-protector", "-mno-stack-arg-probe", "-Wall", "-Wextra", "-c", SOURCE, "-o", object]);
    run("lld-link", ["-nologo", "-entry:start", "-subsystem:console", "-nodefaultlib", "-Brepro", `-out:${file}`, object, library]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function run(tool: string, args: string[]): void {
  const t0 = performance.now();
  const ran = spawnSync(llvm(tool), args, { encoding: "utf8" });
  if (ran.error !== undefined || ran.status !== 0) throw new Error(`${tool} could not build storytree's Windows command: ${ran.error?.message ?? ""}${ran.stdout}${ran.stderr}`.trim());
  console.log(`EXP launcher ${tool} ${Math.round(performance.now() - t0)} ms`);
}

/** An LLVM tool on the PATH, or in LLVM's own folder on Windows. */
function llvm(tool: string): string {
  const name = process.platform === "win32" ? `${tool}.exe` : tool;
  const folders = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform === "win32") folders.push(path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LLVM", "bin"));
  const found = folders.map((folder) => path.join(folder, name)).find((file) => existsSync(file));
  if (found === undefined) throw new Error(`storytree's Windows command is built with LLVM, and ${tool} is not installed: install LLVM (winget install LLVM.LLVM on Windows), then build again.`);
  return found;
}
