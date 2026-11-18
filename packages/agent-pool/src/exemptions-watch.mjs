// Capability 4 · The watcher also tells the owner when the secret-check exemptions list changes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const EXEMPTIONS = ".github/secret-check-exemptions.txt";
export const EXEMPTIONS_EVERY_MS = 60 * 60_000;
const run = promisify(execFile);

export function entryChanges(diff) {
  const entries = (sign) => new Set(diff.split("\n")
    .filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .map((line) => line.slice(1).replace(/#.*/, "").trim()).filter(Boolean));
  const added = entries("+"), removed = entries("-");
  return { added: [...added].filter((path) => !removed.has(path)), removed: [...removed].filter((path) => !added.has(path)) };
}

export async function exemptionChanges({ repo, ref = "origin/main", fetch = true, openerOf = async () => undefined }) {
  const git = async (args) => (await run("git", args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout;
  if (fetch) await git(["fetch", "--quiet", "origin", "main"]);
  const changes = [];
  for (const line of (await git(["log", "--first-parent", "--reverse", "--format=%H%x09%cI%x09%an%x09%s", ref, "--", EXEMPTIONS])).split("\n").filter(Boolean)) {
    const [sha, at, author, subject] = line.split("\t");
    const { added, removed } = entryChanges(await git(["show", "--diff-merges=first-parent", "--format=", "--unified=0", sha, "--", EXEMPTIONS]));
    if (added.length === 0 && removed.length === 0) continue;
    const pr = /^Merge pull request #(\d+) /.exec(subject)?.[1];
    const by = (pr && await openerOf(pr).catch(() => undefined)) || author;
    changes.push({ sha, at, pr, by, added, removed });
  }
  return changes;
}

export const aboutOf = (change) => `${EXEMPTIONS}@${change.sha}`;

export function fyiOf(change) {
  const carried = change.pr ? `PR #${change.pr}, opened by ${change.by},` : `A commit by ${change.by}, pushed straight to main with no pull request,`;
  const parts = [change.added.length && `now also exempts ${change.added.join(", ")}`, change.removed.length && `no longer exempts ${change.removed.join(", ")}`].filter(Boolean);
  return {
    title: `The secret-check exemptions list changed${change.pr ? ` (PR #${change.pr})` : ""}`,
    what: `${carried} changed the files the secret check passes over (${EXEMPTIONS}) on main: it ${parts.join(", and ")}. Commit ${change.sha.slice(0, 12)}.`,
    about: aboutOf(change),
    at: change.at,
  };
}

export async function watchExemptions({ readExemptions, recorded, record, say = () => {} }) {
  for (const change of await readExemptions()) {
    if (await recorded(aboutOf(change))) continue;
    await record(fyiOf(change));
    say(`exemptions: ${change.sha.slice(0, 12)}${change.pr ? ` (PR #${change.pr})` : ""} changed ${EXEMPTIONS}: told the owner as an FYI`);
  }
}
