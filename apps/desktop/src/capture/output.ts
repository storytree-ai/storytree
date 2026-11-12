/**
 * Capability 2 · Storytree projects. Where a capture writes its pictures and measurements. A run to check that a capture still works
 * writes to a scratch folder, so the evidence folder stays as it was; re-taking the evidence into its own
 * folder is a deliberate act, named on the command line with --retake. A retake's pictures are not committed:
 * check:evidence refuses them (ADR-1234 D1), so they go to the evidence bucket with `pnpm evidence:upload --pr <n>`.
 * A scratch folder starts each run empty, so it holds only what that run took, never an older capture's shot.
 */
import { mkdirSync, rmSync } from "node:fs";
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

/**
 * The folder an evidence `folder`'s capture build (its bundled page) goes to, `parts` naming one of several builds:
 * under the checkout's ignored .evidence-builds/, never beside the evidence, so a build leaves no untracked output
 * in a package's source or evidence folders, and deleting that one folder clears every build.
 */
export function buildFolder(folder: string, ...parts: string[]): string {
  const inCheckout = path.relative(CHECKOUT, folder);
  const name = inCheckout.startsWith("..") || path.isAbsolute(inCheckout) ? path.basename(folder) : inCheckout;
  return path.join(CHECKOUT, ".evidence-builds", name, ...parts);
}

const UPLOAD = "pnpm evidence:upload --pr <n> --readme <the evidence folder's README> <file…>";

/** The scratch folders this process has emptied: a capture asks for its folder once per shot, and keeps each. */
const emptied = new Set<string>();

/**
 * outputFolder for this run, made if it is missing (a scratch folder emptied on the run's first ask) and said on
 * stderr, so the capture's reader knows where to look and that a retake's pictures go to the evidence bucket, not
 * into a commit.
 */
export function captureOutput(folder: string, run?: CaptureRun): string {
  const out = outputFolder(folder, run);
  if (out !== folder && !emptied.has(out)) {
    rmSync(out, { recursive: true, force: true });
    emptied.add(out);
  }
  mkdirSync(out, { recursive: true });
  console.error(out === folder
    ? `re-taking the evidence in ${out}: upload its pictures with ${UPLOAD} on the Mint box and link them, never commit them`
    : `writing to the scratch folder ${out} (--retake writes into the evidence folder, whose pictures go up with ${UPLOAD})`);
  return out;
}
