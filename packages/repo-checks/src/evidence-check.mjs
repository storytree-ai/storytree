// Capability 1 · Leak, secret and push scans. Evidence media is not committed (ADR-1234 D1): a screenshot, clip, trace
// or coverage file (.png, .webm, .json.gz) under a folder named evidence or under docs/design goes to the evidence
// bucket under its pull request (`pnpm evidence:upload`, on the Mint box) and is linked, since git history never
// shrinks. `pnpm check:evidence` (the gate's check:evidence, and CI) refuses a branch that adds or changes such a file
// against origin/main. Durable media stays committed until the library can hold it (ADR-1234 D3): an input a build,
// test or script reads (a capture's seed.json.gz, or a file under a folder named inputs) and an owner-approved
// reference (a file under a folder named approved). A deletion passes, as the arc-close sweep makes them.
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { changedFiles } from "@storytree/base-dev-loop/test-scope";

/** Evidence media: a picture, clip, trace or coverage file under an evidence folder or docs/design. */
const MEDIA = /\.(png|webm|json\.gz)$/i;
const FOLDERS = /(^|\/)evidence\/|^docs\/design\//;
/** Durable media, which stays committed: a capture's seed, an input, an approved reference. */
const DURABLE = /(^|\/)(approved|inputs)\/|(^|\/)seed\.json\.gz$/;

/** Whether `file` (a path in the checkout, forward slashes) is evidence media that must not be committed. */
export function isCommittedEvidence(file) {
  return MEDIA.test(file) && FOLDERS.test(file) && !DURABLE.test(file);
}

/** The check: each file the branch at `root` adds or changes against origin/main, failing on evidence media. */
export function checkEvidence({ root, log = console.log, error = console.error }) {
  let files;
  try {
    files = changedFiles(root);
  } catch (failure) {
    error(`check:evidence: the changes against origin/main could not be read (${String(failure.stderr ?? failure.message).trim().split("\n")[0]})`);
    return 1;
  }
  const present = files.filter((file) => statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile());
  const evidence = present.filter(isCommittedEvidence).sort();
  if (evidence.length > 0) {
    error(
      `The branch commits evidence media, which goes to the evidence bucket instead (ADR-1234 D1). Upload each file under its pull request with \`pnpm evidence:upload --pr <n> --readme <the evidence folder's README> <file…>\` on the Mint box, link it from the pull request body, and take it out of the branch; an input a build reads goes under an inputs/ folder, an owner-approved reference under an approved/ one:\n${evidence.map((file) => `  ${file}`).join("\n")}`,
    );
    return 1;
  }
  log(`${present.length} changed file${present.length === 1 ? "" : "s"}, no evidence media among them`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = checkEvidence({ root: fileURLToPath(new URL("../../..", import.meta.url)) });
}
