// Capability 4 · The watcher also tells the owner when the secret-check exemptions list changes (question_82ab3da6eb69:
// awareness, not prevention). Every hour its look loop reads main's history of .github/secret-check-exemptions.txt from
// git, with no model, and records one FYI (ADR-1184 D3) for each commit on main's first-parent line that changed the
// paths the list exempts: what it added and took away, the pull request that carried it and who opened it. Nothing here
// blocks or delays a pull request.
//
// The watcher, not a scheduled process, is the detector: it already runs on the box all the time without a model and
// reads main, while a scheduled process needs a model's run to come round. It reads main's history rather than the
// pull requests handed to it, because a change can reach main by a pull request no lane handed over. Each FYI's `about`
// names the list and the commit (`<list>@<sha>`), and the library is asked for that before each one is recorded, so a
// change is told once however often the history is read, and every change since the list began is read each time, so
// none is missed between runs or while the box was down.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** The owner's list of files check:secrets passes over (packages/repo-checks/src/leak-scan.mjs's SECRET_EXEMPTIONS). */
export const EXEMPTIONS = ".github/secret-check-exemptions.txt";
export const EXEMPTIONS_EVERY_MS = 60 * 60_000;
const run = promisify(execFile);

/** The paths a diff of the list adds and takes away; comments and blank lines are no entries, and an entry both taken away and added (its comment edited) is neither. */
export function entryChanges(diff) {
  const entries = (sign) => new Set(diff.split("\n")
    .filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .map((line) => line.slice(1).replace(/#.*/, "").trim()).filter(Boolean));
  const added = entries("+"), removed = entries("-");
  return { added: [...added].filter((path) => !removed.has(path)), removed: [...removed].filter((path) => !added.has(path)) };
}

/**
 * Each commit on `ref`'s first-parent line that changed the list's entries, oldest first: its sha, commit time, the pull
 * request its merge subject names (none for a commit pushed straight to main), who opened that pull request
 * (`openerOf`, else the commit's author), and the entries it added and took away.
 */
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

/** What an FYI is about: the list at the commit that changed it. */
export const aboutOf = (change) => `${EXEMPTIONS}@${change.sha}`;

/** The FYI one change makes, in plain words. */
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

/** One look: each change `readExemptions` gives that the library has no FYI about (`recorded`) is recorded (`record`), oldest first. */
export async function watchExemptions({ readExemptions, recorded, record, say = () => {} }) {
  for (const change of await readExemptions()) {
    if (await recorded(aboutOf(change))) continue;
    await record(fyiOf(change));
    say(`exemptions: ${change.sha.slice(0, 12)}${change.pr ? ` (PR #${change.pr})` : ""} changed ${EXEMPTIONS}: told the owner as an FYI`);
  }
}
