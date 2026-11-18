// Capability 2 · Storytree projects
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CaptureRun {
  readonly argv: readonly string[];
  readonly tmp: string;
  readonly name?: string;
}

const CHECKOUT = path.resolve(import.meta.dirname, "../../../..");

export function outputFolder(folder: string, { argv = process.argv, tmp = tmpdir() }: Partial<CaptureRun> = {}): string {
  if (argv.includes("--retake")) return folder;
  const inCheckout = path.relative(CHECKOUT, folder);
  const name = inCheckout.startsWith("..") || path.isAbsolute(inCheckout) ? path.basename(folder) : inCheckout;
  return path.join(tmp, "storytree-captures", name);
}

export function buildFolder(folder: string, ...parts: string[]): string {
  const inCheckout = path.relative(CHECKOUT, folder);
  const name = inCheckout.startsWith("..") || path.isAbsolute(inCheckout) ? path.basename(folder) : inCheckout;
  return path.join(CHECKOUT, ".evidence-builds", name, ...parts);
}

const UPLOAD = "pnpm evidence:upload --pr <n> --readme <the evidence folder's README> <file…>";

function namedFor(entry: string, name: string): boolean {
  const stem = entry.slice(0, entry.length - path.extname(entry).length);
  return stem === name || stem.startsWith(`${name}-`) || stem.endsWith(`-${name}`);
}

const emptied = new Set<string>();

export function captureOutput(folder: string, run: Partial<CaptureRun> = {}): string {
  const out = outputFolder(folder, run);
  const { name } = run;
  if (out !== folder && !emptied.has(out)) {
    const cleared = name === undefined ? [out] : existsSync(out) ? readdirSync(out).filter(entry => namedFor(entry, name)).map(entry => path.join(out, entry)) : [];
    for (const entry of cleared) rmSync(entry, { recursive: true, force: true });
    emptied.add(out);
  }
  mkdirSync(out, { recursive: true });
  console.error(out === folder
    ? `re-taking the evidence in ${out}: upload its pictures with ${UPLOAD} on the Mint box and link them, never commit them`
    : `writing to the scratch folder ${out} (--retake writes into the evidence folder, whose pictures go up with ${UPLOAD})`);
  return out;
}
