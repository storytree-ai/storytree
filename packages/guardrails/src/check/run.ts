/**
 * Capability 3 · The check command, as a user's CI runs it (ADR-0911 D3): storytree's workflow checks
 * storytree's source out at the user's release, installs only this package, and runs this file on the
 * project's checkout, `node --import tsx src/check/run.ts <folder>`, with no whole command line to install.
 */
import { fileURLToPath } from "node:url";

import { check, checkoutOf } from "./check.js";

/** Check the checkout `folder` is in, write the report, and return the exit code: 1 when either rule is broken. */
export async function main(folder: string, write: (text: string) => void): Promise<number> {
  const report = await check(checkoutOf(folder));
  write(`${report.text}\n`);
  return report.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv[2] ?? process.cwd(), (text) => process.stdout.write(text));
}
