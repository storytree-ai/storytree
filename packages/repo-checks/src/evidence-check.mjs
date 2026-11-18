// Capability 1 · Leak, secret and push scans
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { changedFiles } from "@storytree/base-dev-loop/test-scope";

const MEDIA = /\.(png|webm|json\.gz)$/i;
const FOLDERS = /(^|\/)evidence\/|^docs\/design\//;
const DURABLE = /(^|\/)inputs\/|(^|\/)seed\.json\.gz$/;
const APPROVED = /(^|\/)approved\//;

export function isCommittedEvidence(file) {
  return MEDIA.test(file) && FOLDERS.test(file) && !DURABLE.test(file);
}

export function checkEvidence({ root, log = console.log, error = console.error }) {
  let files;
  try {
    const untracked = new Set(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0"));
    files = changedFiles(root).filter((file) => !untracked.has(file));
  } catch (failure) {
    error(`check:evidence: the changes against origin/main could not be read (${String(failure.stderr ?? failure.message).trim().split("\n")[0]})`);
    return 1;
  }
  const present = files.filter((file) => statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile());
  const refused = present.filter(isCommittedEvidence).sort();
  const approved = refused.filter((file) => APPROVED.test(file));
  const evidence = refused.filter((file) => !APPROVED.test(file));
  const said = [];
  if (evidence.length > 0) {
    said.push(
      `The branch commits evidence media, which goes to the evidence bucket instead (ADR-1234 D1). Upload each file under its pull request with \`pnpm evidence:upload --pr <n> --readme <the evidence folder's README> <file…>\` on the Mint box, link it from the pull request body, and take it out of the branch; an input a build reads goes under an inputs/ folder:\n${evidence.map((file) => `  ${file}`).join("\n")}`,
    );
  }
  if (approved.length > 0) {
    said.push(
      `The branch commits an owner-approved reference, which the library keeps beside the note citing it instead (ADR-1234 D3). Attach each and take it out of the branch:\n${approved.map((file) => `  storytree media attach <the note citing it> ${file} --project <project>`).join("\n")}`,
    );
  }
  if (said.length > 0) {
    error(said.join("\n"));
    return 1;
  }
  log(`${present.length} changed file${present.length === 1 ? "" : "s"}, no evidence media among them`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = checkEvidence({ root: fileURLToPath(new URL("../../..", import.meta.url)) });
}
