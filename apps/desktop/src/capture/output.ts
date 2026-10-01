/**
 * Where a capture writes its pictures and measurements. A run to check that a capture still works
 * writes to a scratch folder, so the landing's committed evidence stays as it was; re-taking the
 * evidence into its own folder is a deliberate act, named on the command line with --retake.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CaptureRun {
  readonly argv: readonly string[];
  /** The machine's temporary folder, under which each evidence folder gets its own scratch folder. */
  readonly tmp: string;
}

const CHECKOUT = path.resolve(import.meta.dirname, "../../../..");

/** The folder a capture of the evidence `folder` writes to: `folder` itself under --retake, else its scratch folder. */
export function outputFolder(folder: string, { argv, tmp }: CaptureRun = { argv: process.argv, tmp: tmpdir() }): string {
  if (argv.includes("--retake")) return folder;
  const inCheckout = path.relative(CHECKOUT, folder);
  const name = inCheckout.startsWith("..") || path.isAbsolute(inCheckout) ? path.basename(folder) : inCheckout;
  return path.join(tmp, "storytree-captures", name);
}

/** outputFolder for this run, made if it is missing and said on stderr, so the capture's reader knows where to look. */
export function captureOutput(folder: string): string {
  const out = outputFolder(folder);
  mkdirSync(out, { recursive: true });
  console.error(out === folder ? `re-taking the evidence in ${out}` : `writing to the scratch folder ${out} (--retake writes into the evidence folder)`);
  return out;
}
