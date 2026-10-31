/**
 * Capability 2 · Change review and capability 4 · Review loop bound (ADR-0956 D1, D7, ADR-1120). What the
 * change-reviewer reads, the brief, and what it returns, taken into the QA ledger; and the loop of reviews of
 * one change, bounded at three.
 *
 * - A change is one increment's branch, named by the increment. Each review of it is one iteration: a brief
 *   issued, then the reviewer's return taken. A brief not yet taken is replaced by the next one issued.
 * - The brief holds the branch's diff against origin/main, its uncommitted work included (2.6), or in a repository with no
 *   origin/main against its local default branch, which the brief names (2.7), read from the worktree on the branch the increment
 *   was claimed on wherever the brief runs, and refused when no worktree is on it (2.8), every contract of the capabilities the increment
 *   names, and every live check; never the increment's body or the implementer's reasoning (contract 2.1).
 *   Each contract is listed under its story and capability, and every capability named is listed even with no
 *   contracts, so two stories' contracts sharing a number both appear, each with its story (2.5).
 *   A contract the increment changes pending its merge (ADR-0966 D1) is briefed as the change leaves it: in
 *   its pending text, marked pending, and one it retires listed as retired with the reason, not answered; either is listed
 *   once, its plan change not again among the pending plan changes (2.4).
 *   Every change the increment makes to the plan pending its merge is listed too, so a plan-only change, whose diff touches no file,
 *   is briefed with those changes as the thing under review, in the package `plan`, where a hit names the record as its file;
 *   with neither a diff nor a pending change the brief is refused (2.10).
 *   Every library record the sessions that claimed the increment wrote or edited since their first claim on it is listed too, as it
 *   was written, the increment itself and health left out: in the package `library`, where a hit names the record as its file, so a
 *   change whose substance is a record (a process, a note) is briefed on it, and is not refused for a diff that touches no file (2.22).
 *   From the second review on it also holds each earlier hit with the implementer's answer, and the
 *   rejections the reviewer must judge (4.2). A brief read from the change's worktree then holds only the diff since the last
 *   review taken, naming it, unless that review's commit has left the branch's history or the branch has taken in its default
 *   branch since, when it holds the whole diff again (4.5, ADR-1120 D2).
 * - A return is taken whole or not at all: it answers every check and contract in its brief, and judges every
 *   rejection, and nothing else (2.2, 4.2), and names the review it answers, so a return left from an earlier
 *   review, as one read from another folder's /tmp may be, is refused (2.9).
 * - A finding stands while it is unanswered, or rejected for a reason no later review accepted (4.1), and one a later review returns
 *   again after its rejection was accepted is not taken as a new hit (4.8); a contract found not met stands
 *   only while the increment still names it, so narrowing its capabilities list clears the rest (4.7). With
 *   one standing after the third review, the fourth brief is refused, naming the arc for the session's
 *   question (4.3, ADR-1120 D1); the refusal itself writes nothing. The three are the branch's: a brief read from a worktree
 *   does not count a review whose commit its default branch has taken in, an earlier merged pull request's of the same increment,
 *   nor one whose commit the repository does not hold at all, another repository's (4.6).
 * - Capability 5 · Graduation (ADR-0956 D5): a check graduated whole leaves the brief, and one graduated in part stays in the brief with the part Architecture checks
 *   now enforces named (5.2), and what Architecture checks' graduated checks find on the change is taken with the return,
 *   recorded as theirs under the check each graduated from (5.3).
 * - Review depth follows the change's own risk tier (ADR-1144 D1), read from its whole diff and the package graph of its
 *   worktree, or, for a diff given by hand, from the increment's written risk line: a low-tier change gets a light pass,
 *   judged from the diff alone; medium and high, or a change whose tier was not read, the full brief (2.11).
 * - The brief lists each guardrail a change sets off (trigger `change`, question_4cec0ba23052) of the capabilities the increment
 *   names and of their stories, each story's once, as the increment's pending plan changes leave them; the return answers each
 *   passed or failed, with its pictures, and a failed one stands until a later review passes it (2.12, ADR-1148).
 * - The return says of each contract it finds met whether the change touches it, and one the change adds or rewords pending its merge is
 *   touched; a touched contract answered met names the test covering the changed behaviour, or the changed line no test
 *   covers, which is taken as a hit asking for one (2.13, ADR-1153 D2).
 * - A brief read from a worktree lists each test the diff it reviews adds, and whether the worktree's saved red runs
 *   (.pgtest/red-runs.jsonl, which `pnpm test` keeps: packages/dev-loop/src/red-runs.mjs) name it failing, by its name or its
 *   file failing to load; taking the return records a hit at each one none names, asking for its red, and re-runs nothing (2.14, ADR-1153 D3).
 *   A red run any worktree of the same clone saved counts too when it was saved at a commit the worktree's HEAD carries: `pnpm test`
 *   also keeps each in the clone's shared copy, so a lane resuming a pushed branch in a fresh worktree keeps its reds (2.15).
 *   Each outside checkout the brief reads, the factory worktree (2.18) or a checkout named as the change's other half (2.19),
 *   has the tests its diff adds listed the same way under its folder, read against that checkout's saved red runs (2.20).
 * - A capability the increment names whose story is a factory plugin's (ADR-1187) has its change read from the worktree of the factory
 *   repo on a branch carrying the increment's id: the brief holds that worktree's diff, its files in the plugin's package, and the
 *   capability's contracts as the plugin's plan file there numbers them, a contract only the plan holds briefed as `<plugin>:<number>`
 *   and one it no longer holds listed as retired. With no such worktree the brief says the plugin's change was not read, and a return
 *   answering any of those contracts met is refused (2.18, friction_cda9575aee9f).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import type { HistoryEntry, Library, PendingChange, PluginPlan, Storytree } from "@storytree/library";
import { pluginPlan } from "@storytree/plugin-loader/factory";

import { checks as liveChecks, type Graduated } from "../checks/checks.js";
import type { GraduatedFindings } from "../graduation/graduation.js";
import { HIT_COLUMNS, hitRow, inTransaction, ledgerDatabase, writeReview, type HitRecord, type HitRow } from "../ledger/ledger.js";
import { PackageGraph, readChange, readPackages, riskLineText, type ChangeReading } from "../risk/risk.js";

/** The reviews of one change that may run while a finding still stands (ADR-1120 D1, replacing ADR-0956 D7's ten). */
export const REVIEW_LIMIT = 3;

/** The check a hit is recorded under when a contract the change touches is answered met with no test covering the changed behaviour (contract 2.13, ADR-1153 D2). */
export const COVERING_TEST = "covering-test";

/** The check a hit is recorded under when a test the change adds has no saved red run naming it failing (contract 2.14, ADR-1153 D3). */
export const RED_RUN = "red-run";

/** One review's brief: everything the change-reviewer reads. */
export interface Brief {
  readonly project: string;
  /** The change: the increment whose branch it is. */
  readonly change: string;
  readonly iteration: number;
  /** The branch's diff against origin/main, or, from the second review on, only what changed since the review `since` names (contract 4.5). */
  readonly diff: string;
  /** The commits a brief read from a worktree read: the branch's, and where it parted from its default branch (contract 4.5). */
  readonly mark?: Mark;
  /** The earlier review whose commit the diff is read since, when it is not the whole change (contract 4.5). */
  readonly since?: { readonly review: number; readonly head: string };
  /** The branch the diff was read against, when it was read from a worktree: `local` when the repository has no origin/main (contract 2.7). */
  readonly base?: Base;
  /** The change's risk line, read from its whole diff, or the increment's written one for a diff given by hand; absent when neither was read (contract 2.11). */
  readonly risk?: ChangeReading;
  /** How deep the review reads: `light` at low tier, judged from the diff alone, else `full` (contract 2.11). Absent from briefs issued before 2.11. */
  readonly pass?: "light" | "full";
  /** The packages the diff touches (`root` for files outside any package), and `plan` when the increment changes the plan pending its merge (contract 2.10). */
  readonly packages: readonly string[];
  /** Each capability the increment names, with its story, in story then capability order (contract 2.5). Absent from briefs issued before 2.5. */
  readonly capabilities?: readonly { readonly id: string; readonly title: string; readonly story: { readonly id: string; readonly title: string } }[];
  /**
   * Each contract to judge, in its pending text when the increment changes it pending its merge (`pending`, contract 2.4),
   * and the capability it belongs to (contract 2.5; absent from briefs issued before it).
   */
  readonly contracts: readonly { readonly id: string; readonly title: string; readonly description?: string; readonly pending?: true; readonly capability?: string; readonly plugin?: string }[];
  /**
   * The factory plugins whose stories the increment's capabilities belong to, and their change: the factory worktree on the
   * increment's branch and its diff (absent when it is the change's own folder, whose diff is above), or why it was not read,
   * when none of those plugins' contracts may be answered met (contract 2.18). Absent when the increment names no plugin's capability.
   */
  readonly factory?: { readonly plugins: readonly string[]; readonly folder?: string; readonly diff?: string; readonly unread?: string };
  /**
   * Each checkout outside the project named as the change's other half, an increment landing in two repositories as storytree and the
   * factory repo, with its branch's diff against its default branch (contract 2.19). Absent when none was named.
   */
  readonly also?: readonly { readonly folder: string; readonly diff: string }[];
  /** The contracts the increment retires pending its merge, with the reason: not judged (contract 2.4). Absent from briefs issued before 2.4. */
  readonly retired?: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
  /**
   * Each change the increment makes to the plan pending its merge, by the record's live title: the fields it sets, or its retirement
   * with the reason (contract 2.10). Absent when it makes none, and from briefs issued before 2.10.
   */
  readonly plan?: readonly PlanEntry[];
  /**
   * Each library record the increment's claiming sessions wrote or edited since their first claim on it, as their last write left it
   * (contract 2.22). Absent when they wrote none, and from briefs issued before 2.22.
   */
  readonly records?: readonly RecordEntry[];
  /** Each live check not graduated whole; one graduated in part names the parts Architecture checks now enforces, which the reviewer does not judge (contract 5.2). */
  readonly checks: readonly { readonly id: string; readonly title: string; readonly question: string; readonly graduated?: readonly Graduated[] }[];
  /**
   * Each guardrail the change sets off, of a capability the increment names or of its story, named `<record>#<n>`, its place in
   * that record's list: the reviewer runs each and answers it passed or failed with pictures (contract 2.12). Absent when none.
   */
  readonly guardrails?: readonly BriefGuardrail[];
  /**
   * Each test the reviewed diff adds, at its line, and whether a saved red run of the worktree names it failing (contract 2.14).
   * Absent when the diff was given by hand, which has no worktree's red runs to read, and from briefs issued before 2.14.
   */
  readonly reds?: readonly BriefRed[];
  /** Each hit earlier reviews of this change made, with the implementer's answer. */
  readonly earlier: readonly HitRow[];
  /** The earlier hits rejected for a reason no review has accepted yet: the return judges each. */
  readonly judge: readonly number[];
}

/**
 * One test the change adds, as the brief lists it: its file and line, its title, and whether a saved red run names it failing (contract 2.14);
 * with the folder of the outside checkout whose diff adds it, when it is not the change's own (contract 2.20).
 */
export interface BriefRed {
  readonly folder?: string;
  readonly file: string;
  readonly line: number;
  readonly test: string;
  readonly red: boolean;
}

/** One guardrail as the brief lists it: its name, the story or capability that carries it, and the check to run (contract 2.12). */
export interface BriefGuardrail {
  readonly id: string;
  readonly on: { readonly id: string; readonly title: string };
  readonly check: string;
}

/** One pending plan change as the brief lists it. */
export type PlanEntry =
  | { readonly record: string; readonly type: string; readonly title: string; readonly after: Readonly<Record<string, unknown>> }
  | { readonly record: string; readonly type: string; readonly title: string; readonly retire: string };

/** One library record the change wrote, as the brief lists it: made or edited, with its fields as written, or retired with the reason (contract 2.22). */
export type RecordEntry =
  | { readonly record: string; readonly type: string; readonly title: string; readonly action: "created" | "updated"; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly record: string; readonly type: string; readonly title: string; readonly action: "retired"; readonly reason: string };

/** A session that claimed the increment, as the library names its writes, and when it first claimed it (contract 2.22). */
export interface Writer {
  readonly actor: string;
  readonly from: string;
}

/** The branch a change's diff is read against; `local` when it is the repository's own default branch, for want of an origin/main. */
export interface Base {
  readonly ref: string;
  readonly local?: true;
}

/** Where a change stood when a brief read it: the branch's commit, and the commit it parted from its default branch at. */
export interface Mark {
  readonly head: string;
  readonly from: string;
}

/** A change read from its worktree: its whole diff, the branch it was read against and its mark, and how to read what changed since an earlier mark. */
export interface WorktreeChange {
  readonly diff: string;
  readonly base?: Base;
  readonly mark?: Mark;
  /** The worktree's folder, whose package graph the change's risk tier is read against (contract 2.11). */
  readonly root?: string;
  /** The diff from `mark`'s commit to the worktree, or undefined when that commit is not in the branch's history. */
  since(mark: Mark): string | undefined;
  /**
   * Whether `mark`'s commit is not this branch's (contract 4.6): in the default branch's history, short of where this branch parted
   * from it (an earlier, merged pull request's), or not in the repository at all (another repository's).
   */
  foreign(mark: Mark): boolean;
}

/**
 * A factory plugin's change as a brief reads it (contract 2.18): the factory worktree on the increment's branch, its change, and the
 * plugin's plan there; or why it could not be read.
 */
export type PluginRead = { readonly folder: string; readonly change: WorktreeChange; readonly plan?: PluginPlan } | { readonly unread: string };

/** What a brief reads of each factory plugin whose story a capability the increment names belongs to. */
export type PluginReader = (plugin: string) => PluginRead;

/** What the change-reviewer returns for one brief. */
export interface ReviewReturn {
  /** The review it answers: its brief's number, so a return left from an earlier review is never taken for this one (contract 2.9). */
  readonly review: number;
  readonly checks: readonly { readonly check: string; readonly tripped: boolean; readonly hits?: readonly { readonly file: string; readonly line: number; readonly found: string }[] }[];
  /**
   * Each contract: met or not, why not, and whether the change touches it; a touched one answered met names its covering test
   * (`<file> › <title>`), or `at`, the changed line no test covers, which is taken as a hit asking for one (contract 2.13).
   */
  readonly contracts: readonly { readonly contract: string; readonly met: boolean; readonly why?: string; readonly touched?: boolean; readonly test?: string; readonly at?: { readonly file: string; readonly line: number } }[];
  readonly rejections?: readonly { readonly hit: number; readonly accepted: boolean; readonly why?: string }[];
  /** Each guardrail in the brief, run: passed or failed, with why when failed, and the pictures it took (contract 2.12). */
  readonly guardrails?: readonly { readonly guardrail: string; readonly passed: boolean; readonly why?: string; readonly pictures: readonly string[] }[];
}

/** A contract a review found not met, with why. */
export interface Unmet {
  readonly contract: string;
  readonly why: string;
}

/** A guardrail a review found failed, with why (contract 2.12). */
export interface Failed {
  readonly guardrail: string;
  readonly why: string;
}

/** A return taken: the review's name in the ledger, its hits, the contracts it found unmet, and what stands now. */
export interface Taken {
  readonly review: string;
  readonly hits: readonly HitRow[];
  readonly unmet: readonly Unmet[];
  /** The guardrails it found failed (contract 2.12). */
  readonly failed: readonly Failed[];
  readonly standing: readonly HitRow[];
  /** Why Architecture checks' graduated checks did not run on the change, when they did not: none of their findings is recorded. */
  readonly graduatedNotRun?: string;
}

/** The review loop on one Postgres server, in the QA ledger's database. */
export interface Reviews {
  /**
   * Issue the next brief for `change` (an increment of `library`'s project), its diff given, with the branch it was read against
   * when known, or read from its worktree, when from the second review on only what changed since the last review taken is
   * briefed (contract 4.5); refused after the third with a finding standing.
   */
  brief(library: Library, change: string, diff: string | WorktreeChange, base?: Base, plugins?: PluginReader, also?: readonly WorktreeChange[], writers?: readonly Writer[]): Promise<Brief>;
  /**
   * Take the reviewer's return on `change`'s brief awaiting one, or refuse it naming what it gets wrong, writing nothing.
   * What Architecture checks' graduated checks found on the change, when given, is recorded with it as theirs (contract 5.3).
   */
  take(project: string, change: string, review: ReviewReturn, graduated?: GraduatedFindings): Promise<Taken>;
  /** `change`'s standing findings, oldest first: none, with no contract `unmet`, means it is ready for the gate. */
  standing(project: string, change: string): Promise<HitRow[]>;
  /**
   * The contracts the latest review taken on `change` found not met: each stands until a later review finds it met, or until the
   * increment no longer names it, its capability gone from its list or the contract retired pending its merge (contract 4.7).
   */
  unmet(library: Library, change: string): Promise<Unmet[]>;
  /** The guardrails the latest review taken on `change` found failed: each stands until a later review passes it (contract 2.12). */
  failed(project: string, change: string): Promise<Failed[]>;
}

/** Open the review loop on `server`'s connection. */
export async function openReviews(server: Pick<Storytree, "ownDatabase">): Promise<Reviews> {
  return new PgReviews(await ledgerDatabase(server));
}

/** The package a review of an increment's pending plan changes runs in: a hit on one names its record as the file (contract 2.10). */
const PLAN_PACKAGE = "plan";

/** The package a review of the library records an increment's sessions wrote runs in: a hit on one names its record as the file (contract 2.22). */
const LIBRARY_PACKAGE = "library";

/** The package a hit in `brief`'s change is in: `plan` for a record the change edits or retires pending its merge, `library` for one it wrote, else the file's. */
function hitPackage(brief: Brief, file: string): string {
  if ((brief.plan ?? []).some(({ record }) => record === file)) return PLAN_PACKAGE;
  return (brief.records ?? []).some(({ record }) => record === file) ? LIBRARY_PACKAGE : packageOf(file);
}

/** What `claimingWriters` reads of the activity log: its lines of one kind whose fields hold given values. */
export interface ClaimLines {
  lines(project: string, filter: { readonly kinds: readonly ["claimed"]; readonly where: Readonly<Record<string, string>> }): Promise<readonly { readonly session: string; readonly at: string }[]>;
}

/** Each session that claimed `increment` in `project`, as the library names its writes, from when it first claimed it (contract 2.22). */
export async function claimingWriters(log: ClaimLines, project: string, increment: string): Promise<Writer[]> {
  const first = new Map<string, string>();
  for (const { session, at } of await log.lines(project, { kinds: ["claimed"], where: { increment } })) if (!first.has(session) || at < first.get(session)!) first.set(session, at);
  return [...first].map(([session, from]) => ({ actor: `session:${session}`, from }));
}

/**
 * Each record `writers` wrote or edited since their first claim on `change`, by id, as the last of their writes left it: the
 * increment itself, health, and a record the increment changes pending its merge (listed among its plan changes) left out (contract 2.22).
 */
async function writtenRecords(library: Library, change: string, writers: readonly Writer[], pending: readonly PendingChange[]): Promise<RecordEntry[]> {
  const skipped = new Set([change, ...pending.map(({ record }) => record)]);
  const last = new Map<string, HistoryEntry>();
  for (const { actor, from } of writers) {
    for (const entry of await library.history({ actor, from })) {
      if (entry.type === "health" || skipped.has(entry.recordId)) continue;
      const kept = last.get(entry.recordId);
      if (kept === undefined || kept.seq < entry.seq) last.set(entry.recordId, entry);
    }
  }
  return [...last.values()].sort((a, b) => (a.recordId < b.recordId ? -1 : 1)).map((entry): RecordEntry => {
    const fields = entry.record.fields as Record<string, unknown>;
    const head = { record: entry.recordId, type: entry.type, title: typeof fields["title"] === "string" ? fields["title"] : entry.recordId };
    return entry.action === "retired" ? { ...head, action: "retired", reason: entry.reason ?? "no reason given" } : { ...head, action: entry.action, fields };
  });
}

/**
 * The package a repository path belongs to: `packages/<name>/…` and `apps/<name>/…` name theirs, as `plugins/<name>/…` does in
 * a factory checkout (contract 2.16); anything else is `root`.
 */
export function packageOf(file: string): string {
  const match = /^(?:packages|apps|plugins)\/([^/]+)\//.exec(file.replace(/\\/g, "/"));
  return match?.[1] ?? "root";
}

/** The packages a unified diff touches, in name order. */
export function diffPackages(diff: string): string[] {
  const files = [...diff.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((match) => match[1]!);
  return [...new Set(files.map(packageOf))].sort();
}

const STANDING = "(answer IS NULL OR (answer = 'rejected' AND NOT accepted))";

type Pool = Awaited<ReturnType<typeof ledgerDatabase>>;

class PgReviews implements Reviews {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async brief(library: Library, change: string, read: string | WorktreeChange, given?: Base, plugins?: PluginReader, also: readonly WorktreeChange[] = [], writers: readonly Writer[] = []): Promise<Brief> {
    const diff = typeof read === "string" ? read : read.diff;
    const base = typeof read === "string" ? given : read.base;
    const increment = await library.get(change);
    if (increment === null || increment.type !== "increment") throw new Error(`${change} is not an increment in project "${library.name}": a change is reviewed by its increment.`);
    const pendingChanges = (increment.fields as { pending?: PendingChange[] }).pending ?? [];
    // A factory plugin's change is read from the factory's worktree on the increment's branch (contract 2.18).
    const pluginOf = await pluginCapabilities(library, increment.fields);
    const factory = factoryRead([...new Set([...pluginOf.values()].map(({ plugin }) => plugin))].sort(), plugins, typeof read === "string" ? undefined : read.root);
    // The change's other halves, in checkouts outside the project, are judged with it (contract 2.19).
    const halves = also.map((other) => ({ folder: other.root ?? "", diff: other.diff }));
    // The library records the increment's sessions wrote are part of the change (contract 2.22).
    const records = await writtenRecords(library, change, writers, pendingChanges);
    const packages = [...new Set([...diffPackages(diff), ...diffPackages(factory?.diff ?? ""), ...halves.flatMap((half) => diffPackages(half.diff)), ...(pendingChanges.length === 0 ? [] : [PLAN_PACKAGE]), ...(records.length === 0 ? [] : [LIBRARY_PACKAGE])])].sort();
    if (packages.length === 0) throw new Error("The diff touches no file, the increment changes nothing in the plan, and its sessions wrote no library record: commit the change, then review it.");
    const project = library.name;
    const { all, taken } = await this.#taken(project, change, typeof read === "string" ? undefined : read);
    const earlier = await this.#hits(project, change, "TRUE");
    const standing = earlier.filter((hit) => hit.answer === "unanswered" || (hit.answer === "rejected" && !hit.accepted));
    const unmet = await this.unmet(library, change);
    const failed = await this.failed(project, change);
    const count = standing.length + unmet.length + failed.length;
    if (taken >= REVIEW_LIMIT && count > 0) {
      const arc = (increment.fields as { arc: string }).arc;
      throw new Error([
        `${taken} reviews of ${change}${typeof read === "string" ? "" : "'s branch"} have run and ${count} finding${count === 1 ? "" : "s"} still stand${count === 1 ? "s" : ""}, so no further review runs (ADR-1120 D1).`,
        ...standing.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.answer === "rejected" ? `rejected: ${hit.reason}` : "unanswered"}`),
        ...unmet.map(({ contract, why }) => `  contract ${contract} not met: ${why}`),
        ...failed.map(({ guardrail, why }) => `  guardrail ${guardrail} failed: ${why}`),
        `Raise an open question on arc ${arc} holding ${change}, in ADR-0944 D4's order: land what is green, push the rest and name its branch in the residue, raise the question, release the claims.`,
      ].join("\n"));
    }
    const capabilities = new Set((increment.fields as { capabilities?: string[] }).capabilities ?? []);
    const pending = new Map(pendingChanges.map((change) => [change.record, change]));
    const byTitle = (a: { id: string; title: string }, b: { id: string; title: string }): number => a.title.localeCompare(b.title, "en", { numeric: true }) || a.id.localeCompare(b.id);
    const named = await namedContracts(library, increment.fields);
    const title = (record: Awaited<ReturnType<Library["get"]>>): string | undefined => (record?.fields as { title?: string } | undefined)?.title;
    const listed = await Promise.all([...capabilities].map(async (id) => {
      const capability = await library.get(id);
      const storyId = (capability?.fields as { story?: string } | undefined)?.story ?? "";
      const story = storyId === "" ? null : await library.get(storyId);
      return { id, title: title(capability) ?? id, story: { id: storyId, title: title(story) ?? (storyId || "no story") } };
    }));
    listed.sort((a, b) => byTitle(a.story, b.story) || byTitle(a, b));
    // Each story's guardrails once, then each capability's own, as the increment's pending plan changes leave them (contract 2.12).
    const carriers = [...new Map(listed.flatMap(({ id, title, story }) => [[story.id, story.title], [id, title]] as const).filter(([id]) => id !== "")).entries()];
    const guardrails = (await Promise.all(carriers.map(async ([id, carrierTitle]) => {
      const change = pending.get(id);
      const fields = { ...((await library.get(id))?.fields ?? {}), ...(change !== undefined && "after" in change ? change.after : {}) } as { guardrails?: { check: string; trigger: string }[] };
      return (fields.guardrails ?? []).flatMap(({ check, trigger }, index) => (trigger === "change" ? [{ id: `${id}#${index + 1}`, on: { id, title: carrierTitle }, check }] : []));
    }))).flat();
    const order = new Map(listed.map(({ id }, index) => [id, index]));
    const planned = pluginContracts(named, pluginOf, factory?.plans ?? new Map());
    const contracts = [...named
      .filter(({ contract, change }) => !planned.covered.has(contract.fields.capability) && (change === undefined || !("retire" in change)))
      .map(({ contract, change, fields }) => ({
        id: contract.id, title: fields["title"] as string,
        ...(typeof fields["description"] === "string" ? { description: fields["description"] } : {}),
        ...(change === undefined ? {} : { pending: true as const }),
        capability: fields["capability"] as string,
        ...(pluginOf.has(fields["capability"] as string) ? { plugin: pluginOf.get(fields["capability"] as string)!.plugin } : {}),
      })), ...planned.contracts]
      .sort((a, b) => order.get(a.capability)! - order.get(b.capability)! || byTitle(a, b));
    const retired = [...named
      .flatMap(({ contract, change }) => (!planned.covered.has(contract.fields.capability) && change !== undefined && "retire" in change ? [{ id: contract.id, title: contract.fields.title, reason: change.retire }] : [])), ...planned.retired]
      .sort(byTitle);
    const plan = await Promise.all(pendingChanges.map(async (change): Promise<PlanEntry> => {
      const head = { record: change.record, type: change.type, title: title(await library.get(change.record)) ?? change.record };
      return "retire" in change ? { ...head, retire: change.retire } : { ...head, after: change.after };
    }));
    // From the second review on, only what changed since the last review taken, while its commit is in the branch's history and
    // the branch has taken in nothing of its default branch since (contract 4.5).
    const mark = typeof read === "string" ? undefined : read.mark;
    const last = mark === undefined || taken === 0 ? undefined : await this.#lastTaken(project, change);
    const newer = last?.mark === undefined || last.mark.from !== mark!.from ? undefined : (read as WorktreeChange).since(last.mark);
    const since = newer === undefined ? undefined : { review: last!.iteration, head: last!.mark!.head };
    // The tier is read on the whole change, whatever part of it this review reads (contract 2.11).
    const risk = await changeRisk(library, increment, diff, typeof read === "string" ? undefined : read.root);
    // The tests this review's diff adds, so a test checked in an earlier review is not asked for again (contract 2.14).
    const own = typeof read === "string" || read.root === undefined ? undefined : redsOf(newer ?? diff, read.root);
    // An outside checkout's new tests are read against its own saved red runs, its whole diff each review (contract 2.20).
    const outside = outsideCheckouts({ ...(factory === undefined ? {} : { factory: factory.brief }), also: halves }).flatMap(({ folder, diff }) => redsOf(diff, folder).map((red) => ({ folder, ...red })));
    const reds = own === undefined && outside.length === 0 ? undefined : [...(own ?? []), ...outside];
    const brief: Brief = {
      project, change, iteration: all + 1, diff: newer ?? diff, ...(base === undefined ? {} : { base }),
      ...(mark === undefined ? {} : { mark }), ...(since === undefined ? {} : { since }),
      ...(risk === undefined ? {} : { risk }), pass: risk?.tier === "low" ? "light" : "full", packages, capabilities: listed, contracts, retired,
      ...(factory === undefined ? {} : { factory: factory.brief }),
      ...(halves.length === 0 ? {} : { also: halves }),
      ...(plan.length === 0 ? {} : { plan }),
      ...(records.length === 0 ? {} : { records }),
      ...(guardrails.length === 0 ? {} : { guardrails }),
      ...(reds === undefined ? {} : { reds }),
      // A check graduated whole is asked by Architecture checks instead, and one naming its projects only in those (contract 2.17).
      checks: (await liveChecks(library))
        .filter(({ graduated, projects }) => !(graduated ?? []).some(({ whole }) => whole) && (projects === undefined || projects.includes(project))).map(({ id, title, question, graduated }) => ({ id, title, question, ...(graduated === undefined ? {} : { graduated }) })),
      earlier,
      judge: earlier.filter((hit) => hit.answer === "rejected" && !hit.accepted).map((hit) => hit.id),
    };
    await this.#pool.query(
      `INSERT INTO quality_briefs (project, change, iteration, brief) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project, change, iteration) DO UPDATE SET brief = EXCLUDED.brief, at = now()`,
      [project, change, brief.iteration, JSON.stringify(brief)],
    );
    return brief;
  }

  async take(project: string, change: string, review: ReviewReturn, graduated?: GraduatedFindings): Promise<Taken> {
    const { rows } = await this.#pool.query<{ brief: Brief }>(
      "SELECT brief FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NULL ORDER BY iteration DESC LIMIT 1",
      [project, change],
    );
    const brief = rows[0]?.brief;
    if (brief === undefined) throw new Error(`There is no brief for ${change} awaiting a review's return: issue one first.`);
    const problems = refusals(brief, review);
    if (problems.length > 0) throw new Error(`The review's return for ${change} is refused and nothing is recorded:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    const name = `${change}#${brief.iteration}`;
    // A finding whose earlier hit was rejected, and the rejection accepted by an earlier review or by this one, is not taken again (contract 4.8).
    const nowAccepted = new Set((review.rejections ?? []).filter(({ accepted }) => accepted).map(({ hit }) => hit));
    const settled = brief.earlier.filter((hit) => hit.answer === "rejected" && (hit.accepted || nowAccepted.has(hit.id)));
    const fresh = (check: string) => (hit: { file: string; found?: string }) => !settled.some((earlier) => sameFinding(earlier, { check, ...hit }));
    const hits = await inTransaction(this.#pool, async (client) => {
      const written = await writeReview(client, {
        project, review: name, change, packages: brief.packages,
        ran: [
          ...review.checks.map(({ check, hits }) => ({ check, hits: (hits ?? []).map(({ file, line, found }) => ({ package: hitPackage(brief, file), file, line, found })) })),
          ...coverage(brief, review),
          ...redRuns(brief),
          // A graduated check's trip outside the packages the brief's diff touches is not part of the change reviewed.
          ...(graduated?.ran ? graduated.checks : []).map(({ check, hits }) => ({
            check, foundBy: "graduated" as const,
            hits: hits.map(({ file, line, found }) => ({ package: packageOf(file), file, line, found })).filter((hit) => brief.packages.includes(hit.package)),
          })),
        ].map((ran) => ({ ...ran, hits: ran.hits.filter(fresh(ran.check)) })),
      });
      for (const { hit } of (review.rejections ?? []).filter(({ accepted }) => accepted)) {
        await client.query("UPDATE quality_hits SET accepted = true WHERE project = $1 AND id = $2", [project, hit]);
      }
      await client.query("UPDATE quality_briefs SET taken = $4, taken_at = now() WHERE project = $1 AND change = $2 AND iteration = $3", [project, change, brief.iteration, JSON.stringify(review)]);
      return written;
    });
    return {
      review: name,
      hits,
      unmet: unmetIn(review),
      failed: failedIn(review),
      standing: await this.standing(project, change),
      ...(graduated !== undefined && !graduated.ran ? { graduatedNotRun: graduated.reason } : {}),
    };
  }

  standing(project: string, change: string): Promise<HitRow[]> {
    return this.#hits(project, change, STANDING);
  }

  async unmet(library: Library, change: string): Promise<Unmet[]> {
    const { rows } = await this.#pool.query<{ taken: ReviewReturn }>(
      "SELECT taken FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NOT NULL ORDER BY iteration DESC LIMIT 1",
      [library.name, change],
    );
    if (rows[0] === undefined) return [];
    const found = unmetIn(rows[0].taken);
    if (found.length === 0) return [];
    const increment = await library.get(change);
    if (increment === null || increment.type !== "increment") return found;
    const named = new Set((await namedContracts(library, increment.fields)).filter(({ change }) => change === undefined || !("retire" in change)).map(({ contract }) => contract.id));
    // A contract only a factory plugin's plan holds stands while the increment names a capability of that plugin's story (contract 2.18).
    const plugins = new Set([...(await pluginCapabilities(library, increment.fields)).values()].map(({ plugin }) => plugin));
    return found.filter(({ contract }) => named.has(contract) || plugins.has(contract.split(":")[0]!));
  }

  async failed(project: string, change: string): Promise<Failed[]> {
    const { rows } = await this.#pool.query<{ taken: ReviewReturn }>(
      "SELECT taken FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NOT NULL ORDER BY iteration DESC LIMIT 1",
      [project, change],
    );
    return rows[0] === undefined ? [] : failedIn(rows[0].taken);
  }

  /**
   * The reviews of `change` taken, all of them, and those of its branch: read from a worktree, not those whose commit its default
   * branch has taken in or its repository does not hold (contract 4.6).
   */
  async #taken(project: string, change: string, read: WorktreeChange | undefined): Promise<{ all: number; taken: number }> {
    const { rows } = await this.#pool.query<{ mark: Mark | null }>("SELECT brief->'mark' AS mark FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NOT NULL", [project, change]);
    return { all: rows.length, taken: rows.filter(({ mark }) => read === undefined || mark === null || !read.foreign(mark)).length };
  }

  /** The latest brief of `change` whose return was taken. */
  async #lastTaken(project: string, change: string): Promise<Brief | undefined> {
    const { rows } = await this.#pool.query<{ brief: Brief }>(
      "SELECT brief FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NOT NULL ORDER BY iteration DESC LIMIT 1",
      [project, change],
    );
    return rows[0]?.brief;
  }

  async #hits(project: string, change: string, where: string): Promise<HitRow[]> {
    const { rows } = await this.#pool.query<HitRecord>(`SELECT ${HIT_COLUMNS} FROM quality_hits WHERE project = $1 AND change = $2 AND ${where} ORDER BY id`, [project, change]);
    return rows.map(hitRow);
  }
}

/** Every contract of the capabilities an increment names, with its pending change and its fields as that change leaves them. */
async function namedContracts(library: Library, fields: unknown) {
  const { capabilities = [], pending = [] } = fields as { capabilities?: string[]; pending?: PendingChange[] };
  const listed = new Set(capabilities);
  const changes = new Map(pending.map((change) => [change.record, change]));
  return (await library.list("contract"))
    .map((contract) => ({ contract, change: changes.get(contract.id) }))
    .map(({ contract, change }) => ({ contract, change, fields: { ...contract.fields, ...(change !== undefined && "after" in change ? change.after : {}) } as Record<string, unknown> }))
    .filter(({ fields }) => listed.has(fields["capability"] as string));
}

/**
 * A change's risk line (ADR-1144 D1): read from its whole diff against the package graph of the worktree at `root`, or, with
 * no worktree, the one written on the increment; undefined when neither is there to read.
 */
/**
 * The factory plugin each capability the increment names belongs to, by its story's `plugin` (ADR-1187), with the capability's number;
 * a capability of no plugin's story is absent.
 */
async function pluginCapabilities(library: Library, fields: unknown): Promise<Map<string, { plugin: string; number?: string }>> {
  const found = new Map<string, { plugin: string; number?: string }>();
  for (const id of (fields as { capabilities?: string[] }).capabilities ?? []) {
    const capability = (await library.get(id))?.fields as { story?: string; title?: string } | undefined;
    const plugin = capability?.story === undefined ? undefined : ((await library.get(capability.story))?.fields as { plugin?: string } | undefined)?.plugin;
    const number = capabilityNumberOf(capability?.title ?? "");
    if (plugin !== undefined) found.set(id, { plugin, ...(number === undefined ? {} : { number }) });
  }
  return found;
}

/**
 * What a brief reads of the factory plugins `plugins` (contract 2.18): the worktree, its diff unless it is `root`, the change's own folder,
 * and each plugin's plan there; or why it was not read. Undefined with no plugin to read.
 */
function factoryRead(plugins: readonly string[], reader: PluginReader | undefined, root: string | undefined): { brief: NonNullable<Brief["factory"]>; diff?: string; plans: Map<string, PluginPlan> } | undefined {
  if (plugins.length === 0) return undefined;
  const reads = plugins.map((plugin) => [plugin, reader?.(plugin) ?? { unread: "no factory was read for this brief" }] as const);
  const unread = reads.find(([, read]) => "unread" in read);
  if (unread !== undefined) return { brief: { plugins, unread: (unread[1] as { unread: string }).unread }, plans: new Map() };
  const { folder, change } = reads[0]![1] as Extract<PluginRead, { folder: string }>;
  const plans = new Map(reads.flatMap(([plugin, read]) => ("plan" in read && read.plan !== undefined ? [[plugin, read.plan] as const] : [])));
  const own = root !== undefined && sameFolder(root, folder);
  return { brief: { plugins, folder, ...(own ? {} : { diff: change.diff }) }, ...(own ? {} : { diff: change.diff }), plans };
}

function sameFolder(a: string, b: string): boolean {
  try {
    return realpathSync.native(a) === realpathSync.native(b);
  } catch {
    return a === b;
  }
}

/**
 * The contracts of the plugin capabilities whose plugin's plan was read, as the plan numbers them (contract 2.18): one the library holds
 * under the same number keeps its id in the plan's text, one only the plan holds is `<plugin>:<number>`, and one the plan no longer holds
 * is retired; `covered` names those capabilities, whose library contracts are briefed only so.
 */
function pluginContracts(named: Awaited<ReturnType<typeof namedContracts>>, pluginOf: ReadonlyMap<string, { plugin: string; number?: string }>, plans: ReadonlyMap<string, PluginPlan>) {
  const contracts: (Brief["contracts"][number] & { capability: string })[] = [];
  const retired: { id: string; title: string; reason: string }[] = [];
  const covered = new Set<string>();
  for (const [capability, { plugin, number }] of pluginOf) {
    const planned = number === undefined ? undefined : plans.get(plugin)?.capabilities.find(({ title }) => capabilityNumberOf(title) === number);
    if (planned === undefined) continue;
    const held = named.filter(({ contract }) => contract.fields.capability === capability);
    covered.add(capability);
    const byNumber = new Map(held.map((entry) => [contractNumberOf(entry.contract.fields.title), entry]));
    const kept = new Set<string>();
    for (const { title, description } of planned.contracts) {
      const own = contractNumberOf(title);
      const library = own === undefined ? undefined : byNumber.get(own);
      if (library !== undefined) kept.add(library.contract.id);
      contracts.push({ id: library?.contract.id ?? `${plugin}:${own ?? title}`, title, ...(description === undefined ? {} : { description }), capability, plugin });
    }
    for (const { contract } of held) if (!kept.has(contract.id)) retired.push({ id: contract.id, title: contract.fields.title, reason: `${plugin}'s plan on the increment's branch no longer holds it` });
  }
  return { contracts, retired, covered };
}

function capabilityNumberOf(title: string): string | undefined {
  return /^(\d+) · /.exec(title)?.[1];
}

function contractNumberOf(title: string): string | undefined {
  return /^(\d+\.\d+)(?![\d.])/.exec(title)?.[1];
}

async function changeRisk(library: Library, increment: { readonly fields: unknown }, diff: string, root: string | undefined): Promise<ChangeReading | undefined> {
  if (root === undefined) {
    const written = (increment.fields as { risk?: ChangeReading }).risk;
    return written?.tier === undefined ? undefined : written;
  }
  const stories = (await library.list("story")).filter((story) => story.fields.mapped === undefined).map((story) => ({ id: story.id, title: story.fields.title }));
  return readChange(diff, new PackageGraph(readPackages(root)), stories, new Date().toISOString().slice(0, 10));
}

/**
 * The covering-test check as a review ran it (contract 2.13): when the return says the change touches any contract, a hit at the
 * changed line of each touched one answered met with no covering test named, asking for one; else not run.
 */
function coverage(brief: Brief, review: ReviewReturn): { check: string; hits: { package: string; file: string; line: number; found: string }[] }[] {
  const touched = (review.contracts ?? []).filter(({ touched }) => touched === true);
  if (touched.length === 0) return [];
  const titles = new Map(brief.contracts.map(({ id, title }) => [id, title]));
  return [{
    check: COVERING_TEST,
    hits: touched.filter(({ met, test }) => met && !named(test)).map(({ contract, at }) => ({
      package: hitPackage(brief, at!.file), file: at!.file, line: at!.line,
      found: `contract ${contract} (${titles.get(contract) ?? contract}): the change touches it and no test covers the changed behaviour; add one`,
    })),
  }];
}

/**
 * Whether `hit` is the finding `earlier` was (contract 4.8): the same check at the same file, and for a covering-test hit the same
 * contract, for any other the same words; its line may have moved.
 */
function sameFinding(earlier: Pick<HitRow, "check" | "file" | "found">, hit: { check: string; file: string; found?: string }): boolean {
  if (earlier.check !== hit.check || earlier.file !== hit.file) return false;
  const contract = (found: string | undefined) => /^contract (\S+) /.exec(found ?? "")?.[1];
  return hit.check === COVERING_TEST ? contract(earlier.found) === contract(hit.found) : earlier.found === hit.found;
}

/** The checkouts outside the change's own folder a brief read, with their diffs: the factory worktree, then each other half (contracts 2.18, 2.19). */
export function outsideCheckouts(brief: Pick<Brief, "factory" | "also">): { folder: string; diff: string }[] {
  const factory = brief.factory?.folder !== undefined && brief.factory.diff !== undefined ? [{ folder: brief.factory.folder, diff: brief.factory.diff }] : [];
  return [...factory, ...(brief.also ?? []).filter(({ folder }) => folder !== "")];
}

/** The red-run check as a review ran it (contract 2.14): a hit at each test the change adds that no saved red run names; not run when it adds none. */
function redRuns(brief: Brief): { check: string; hits: { package: string; file: string; line: number; found: string }[] }[] {
  if ((brief.reds ?? []).length === 0) return [];
  return [{
    check: RED_RUN,
    hits: brief.reds!.filter(({ red }) => !red).map(({ folder, file, line, test }) => ({
      package: hitPackage(brief, file), file, line,
      found: `new test ${test}${folder === undefined ? "" : ` in the checkout ${folder}`}: no saved red run names it failing; run it red against the code without the change, or say why it could not fail first`,
    })),
  }];
}

/** A test file, by the name node:test and the dev loop give one. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/**
 * A string literal, a comment or a regex literal: the scan of a test file blanks them, so a test written inside a fixture's text is no
 * call, and a quote inside a regex opens no string. A slash opens a regex where an expression starts (after an operator, an opening
 * bracket, a comma or `return`), never after a value, where it divides.
 */
const INERT = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\.|(?!\1)[^\\])*\1|(?<=(?:^|[(,=:[!&|?{};+\-*%~^]|\breturn|\btypeof|\bcase)[ \t]*)\/(?:\\.|\[(?:\\.|[^\]\\\r\n])*\]|[^/\\\r\n[])+\/[a-z]*/gm;
/** Code ending in a test or `it` call about to take its title; `.skip` and `.todo` ones run nothing, so are not read. */
const CALLED = /\b(?:test|it)(?:\.only)?\s*\(\s*$/;

/**
 * Each test `diff` adds, in a test file, at its line, and whether the red runs saved in the worktree at `root` name it failing:
 * by its full name ending in its title, or by its file failing to load. A test is a test or `it` call in the file's code, read from
 * the worktree, whose literal title opens on a line the diff adds; one written inside a string (a fixture's file) is not. A title the
 * diff also removes from the same file is a moved or reworded test, not a new one, and is left out; so is one whose body, everything
 * after its title, is that of a test whose title line the diff removes from any test file, read from that file's old blob: a test
 * moved to another file or renumbered (contract 2.21).
 */
export function redsOf(diff: string, root: string): BriefRed[] {
  const added = new Map<string, Set<number>>();
  const removed = new Set<string>();
  const gone: { blob: string; lines: Set<number> }[] = [];
  let file: string | undefined;
  let old: { blob: string; lines: Set<number> } | undefined;
  let tested = false;
  let line = 0;
  let oldLine = 0;
  for (const text of diff.split("\n")) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(text);
    if (header !== null) {
      file = TEST_FILE.test(header[2]!) ? header[2] : undefined;
      tested = TEST_FILE.test(header[1]!);
      old = undefined;
      continue;
    }
    const index = /^index ([0-9a-f]+)\.\.[0-9a-f]+/.exec(text);
    if (index !== null && tested && !/^0+$/.test(index[1]!)) {
      gone.push(old = { blob: index[1]!, lines: new Set() });
      continue;
    }
    if (file === undefined && old === undefined) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      line = Number(hunk[2]);
      continue;
    }
    if (text.startsWith("+++") || text.startsWith("---")) continue;
    if (text.startsWith("+")) {
      if (file !== undefined) added.set(file, (added.get(file) ?? new Set()).add(line));
      line += 1;
    } else if (text.startsWith("-")) {
      if (file !== undefined) for (const title of titlesIn(text.slice(1))) removed.add(`${file}\0${title.test}`);
      old?.lines.add(oldLine);
      oldLine += 1;
    } else if (text.startsWith(" ")) {
      line += 1;
      oldLine += 1;
    }
  }
  const moved = new Map<string, number>();
  for (const { blob, lines } of gone) {
    let text: string;
    try {
      text = execFileSync("git", ["cat-file", "blob", blob], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      continue; // not in this clone's objects
    }
    for (const { line, body } of titlesIn(text)) if (lines.has(line)) moved.set(body, (moved.get(body) ?? 0) + 1);
  }
  const saved = savedReds(root, new Set(added.keys()));
  return [...added].flatMap(([file, lines]) => {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      return []; // deleted by the change
    }
    return titlesIn(text).filter(({ line, test, body }) => {
      if (!lines.has(line) || removed.has(`${file}\0${test}`)) return false;
      const left = moved.get(body) ?? 0;
      if (left === 0) return true;
      moved.set(body, left - 1);
      return false;
    }).map(({ line, test }) => ({
      file, line, test,
      red: saved.some((row) => row.file === file && (row.test === null || row.test === test || row.test.endsWith(` › ${test}`))),
    }));
  });
}

/**
 * Each test or `it` call in `text`'s code with a literal title, by the line its title opens on, with its body: the text after its
 * title to the call's closing bracket, whitespace collapsed.
 */
function titlesIn(text: string): { line: number; test: string; body: string }[] {
  const strings: { at: number; end: number; value: string; template: boolean }[] = [];
  const code = text.replace(INERT, (token: string, quote: string | undefined, at: number) => {
    if (quote !== undefined) strings.push({ at, end: at + token.length, value: token.slice(1, -1), template: quote === "`" });
    return token.replace(/[^\r\n]/g, " ");
  });
  return strings
    .filter(({ at, value, template }) => CALLED.test(code.slice(Math.max(0, at - 40), at)) && !(template && value.includes("${")))
    .map(({ at, end, value }) => ({ line: text.slice(0, at).split("\n").length, test: value, body: text.slice(end, closeOf(code, end)).replace(/\s+/g, " ").trim() }));
}

/** Where the call whose title ends at `from` in `code` (strings and comments blanked) closes, or the code's end. */
function closeOf(code: string, from: number): number {
  let depth = 1;
  for (let at = from; at < code.length; at += 1) {
    const char = code[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if ((char === ")" || char === "]" || char === "}") && --depth === 0) return at;
  }
  return code.length;
}

/**
 * The red runs `pnpm test` saved for test files among `files` (packages/dev-loop/src/red-runs.mjs): every one the worktree at `root`
 * saved, and each one any worktree of its clone saved, in the clone's shared copy, at a commit `root`'s HEAD carries, so a
 * worktree resuming a pushed branch keeps the reds that branch already showed (contract 2.15).
 */
function savedReds(root: string, files: ReadonlySet<string>): { file: string; test: string | null }[] {
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    } catch {
      return undefined;
    }
  };
  const local = redRows(join(root, ".pgtest", "red-runs.jsonl"), files);
  const common = files.size === 0 ? undefined : git("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common === undefined) return local;
  const carried = new Map<string, boolean>();
  const shared = redRows(join(common, "storytree", "red-runs.jsonl"), files).filter(({ head }) => {
    if (head === "") return false;
    if (!carried.has(head)) carried.set(head, git("merge-base", "--is-ancestor", head, "HEAD") !== undefined);
    return carried.get(head);
  });
  return [...local, ...shared];
}

/** The red runs in the record at `path` for test files among `files`, or none. */
function redRows(path: string, files: ReadonlySet<string>): { head: string; file: string; test: string | null }[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((one) => {
    try {
      const row = JSON.parse(one) as { head?: unknown; file?: unknown; test?: unknown };
      return typeof row.file === "string" && files.has(row.file) && (row.test === null || typeof row.test === "string")
        ? [{ head: typeof row.head === "string" ? row.head : "", file: row.file, test: row.test }]
        : [];
    } catch {
      return []; // a blank line, or one cut short by a run that died mid-write
    }
  });
}

/** Whether a return names a covering test. */
function named(test: string | undefined): boolean {
  return typeof test === "string" && test.trim() !== "";
}

/** The contracts a return found not met, with why. */
function unmetIn(review: ReviewReturn): Unmet[] {
  return (review.contracts ?? []).filter(({ met }) => !met).map(({ contract, why }) => ({ contract, why: why ?? "" }));
}

/** The guardrails a return found failed, with why. */
function failedIn(review: ReviewReturn): Failed[] {
  return (review.guardrails ?? []).filter(({ passed }) => !passed).map(({ guardrail, why }) => ({ guardrail, why: why ?? "" }));
}

/** What a return gets wrong against its brief, each naming the check, contract or hit; none means it is taken. */
function refusals(brief: Brief, review: ReviewReturn): string[] {
  const problems: string[] = [];
  if (review.review !== brief.iteration) {
    problems.push(`${review.review === undefined ? "the return names no review" : `the return is for review ${review.review}`}, and the brief awaiting one is review ${brief.iteration}: write this review's return, with "review": ${brief.iteration}`);
  }
  const answered = (what: string, wanted: readonly (string | number)[], given: readonly (string | number)[]): void => {
    for (const id of wanted) {
      const times = given.filter((one) => one === id).length;
      if (times === 0) problems.push(`${what} ${id} is in the brief and the return does not answer it`);
      if (times > 1) problems.push(`${what} ${id} is answered ${times} times`);
    }
    for (const id of new Set(given)) if (!wanted.includes(id)) problems.push(`${what} ${id} is not in the brief`);
  };
  answered("check", brief.checks.map(({ id }) => id), (review.checks ?? []).map(({ check }) => check));
  answered("contract", brief.contracts.map(({ id }) => id), (review.contracts ?? []).map(({ contract }) => contract));
  answered("rejected hit", brief.judge, (review.rejections ?? []).map(({ hit }) => hit));
  answered("guardrail", (brief.guardrails ?? []).map(({ id }) => id), (review.guardrails ?? []).map(({ guardrail }) => guardrail));
  for (const { guardrail, passed, why, pictures } of review.guardrails ?? []) {
    if (!Array.isArray(pictures) || !pictures.some((picture) => typeof picture === "string" && picture.trim() !== "")) problems.push(`guardrail ${guardrail} names no picture: save at least one of what you saw`);
    if (!passed && (why ?? "").trim() === "") problems.push(`guardrail ${guardrail} failed and the return does not say why`);
  }
  for (const { check, tripped, hits = [] } of review.checks ?? []) {
    if (tripped && hits.length === 0) problems.push(`check ${check} is tripped and names no file and line`);
    if (!tripped && hits.length > 0) problems.push(`check ${check} is not tripped and names hits`);
    for (const { file, line, found } of hits) {
      if (typeof file !== "string" || file.trim() === "") problems.push(`check ${check} has a hit with no file`);
      if (!Number.isInteger(line) || line < 1) problems.push(`check ${check}'s hit in ${file} has line ${line}: a line is a whole number from 1`);
      if (typeof found !== "string" || found.trim() === "") problems.push(`check ${check}'s hit at ${file}:${line} does not say what was found`);
      if (typeof file === "string" && !brief.packages.includes(hitPackage(brief, file))) problems.push(`check ${check}'s hit at ${file}:${line} is in package ${hitPackage(brief, file)}, which the diff does not touch`);
    }
  }
  const pending = new Set(brief.contracts.filter(({ pending }) => pending).map(({ id }) => id));
  // A plugin's contract is never answered met on a review that could not read the plugin's change (contract 2.18).
  const unread = new Map(brief.factory?.unread === undefined ? [] : brief.contracts.flatMap(({ id, plugin }) => (plugin === undefined ? [] : [[id, plugin] as const])));
  for (const { contract, met, why, touched, test, at } of review.contracts ?? []) {
    if (met && unread.has(contract)) problems.push(`contract ${contract} is answered met, and ${unread.get(contract)}'s change was not read: ${brief.factory!.unread}; answer it not met, saying so`);
    if (!met && (why ?? "").trim() === "") problems.push(`contract ${contract} is not met and the return does not say why`);
    // Contract 2.13: "met" alone is no answer for a contract the change touches.
    if (met && typeof touched !== "boolean") problems.push(`contract ${contract} is met and does not say whether the change touches it: give "touched": true or false`);
    if (touched === false && pending.has(contract)) problems.push(`contract ${contract} is reworded by this change, so the change touches it: answer "touched": true`);
    if (touched === true && met && !named(test)) {
      if (at === undefined) problems.push(`contract ${contract} is touched by the change and met, and names no covering test: give "test" (<file> › <title>), or "at" (the changed line's file and line) where no test covers it`);
      else if (typeof at.file !== "string" || at.file.trim() === "" || !Number.isInteger(at.line) || at.line < 1) problems.push(`contract ${contract}'s "at" needs a file and a line, a whole number from 1`);
      else if (!brief.packages.includes(hitPackage(brief, at.file))) problems.push(`contract ${contract}'s changed line ${at.file}:${at.line} is in package ${hitPackage(brief, at.file)}, which the diff does not touch`);
    }
  }
  return problems;
}

/**
 * The diff of the branch checked out in `cwd` against `base` (from where they parted), as `git diff` gives it:
 * by default the branch origin names as its default (a user's project may call it master), else origin/main,
 * else, in a repository with no origin/main, its local default branch.
 */
export function branchDiff(cwd: string, base = branchBase(cwd)?.ref): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // A folder with no default branch, as an imported one may be, is read against its own commit.
  let from = "HEAD";
  try {
    if (base !== undefined) from = git("merge-base", base, "HEAD").trim();
  } catch {
    // No default branch to compare to.
  }
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter((file) => file !== "");
  return [git("diff", from), ...untracked.map((file) => newFileDiff(cwd, file))].join("");
}

/**
 * The change checked out in `cwd`: its whole diff against its default branch (`branchDiff`), that branch, and its mark, from
 * which a later brief reads only what changed since (contract 4.5): the diff from the marked commit to the worktree, its
 * uncommitted and untracked work included, or undefined once that commit has left the branch's history.
 */
export function worktreeChange(cwd: string): WorktreeChange {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const base = branchBase(cwd);
  let mark: Mark | undefined;
  try {
    const head = git("rev-parse", "HEAD").trim();
    let from = head;
    try {
      if (base !== undefined) from = git("merge-base", base.ref, "HEAD").trim();
    } catch {
      // No default branch to compare to: the branch is marked against its own commit.
    }
    mark = { head, from };
  } catch {
    // A folder with no commit has no mark, so every brief reads it whole.
  }
  return {
    diff: branchDiff(cwd, base?.ref),
    ...(base === undefined ? {} : { base }),
    ...(mark === undefined ? {} : { mark }),
    root: cwd,
    since(earlier) {
      try {
        git("merge-base", "--is-ancestor", earlier.head, "HEAD");
      } catch {
        return undefined;
      }
      const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter((file) => file !== "");
      return [git("diff", earlier.head), ...untracked.map((file) => newFileDiff(cwd, file))].join("");
    },
    foreign(earlier) {
      if (mark === undefined || earlier.head === mark.from) return false;
      try {
        git("cat-file", "-e", `${earlier.head}^{commit}`);
      } catch {
        return true;
      }
      try {
        git("merge-base", "--is-ancestor", earlier.head, mark.from);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The folder to read an increment's change from (contract 2.8): `cwd` when it is on `branch`, the branch the increment was claimed
 * on, or on another branch whose name carries the same increment (a second pull request's), else the worktree of `cwd`'s repository
 * checked out on that branch, so a brief run from another checkout never reviews that checkout's work instead; `cwd` too when its
 * branch names `increment`, as a generic claimed branch renamed to name it does. Refused, naming the branch, when no worktree is on
 * it; with no branch known, `cwd`.
 */
export function changeFolder(cwd: string, branch: string | undefined, increment?: string): string {
  if (branch === undefined) return cwd;
  const git = (...args: string[]): string => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      return "";
    }
  };
  const current = git("symbolic-ref", "--quiet", "--short", "HEAD").trim();
  if (current === branch) return cwd;
  const named = incrementOfBranch(branch) ?? increment?.replace(/^increment_/, "").toLowerCase();
  if (named !== undefined && incrementOfBranch(current) === named) return cwd;
  for (const entry of git("worktree", "list", "--porcelain").split(/\n\n+/)) {
    const lines = entry.split("\n");
    const folder = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (folder !== undefined && lines.includes(`branch refs/heads/${branch}`)) return folder;
  }
  throw new Error(`The increment's change is on branch ${branch}, and no worktree of ${cwd}'s repository is on it: run the brief from the increment's worktree, or give its diff.`);
}

/**
 * How a brief reads the factory plugins of `increment`'s capabilities from the factory repo at `factory` (contract 2.18): from the
 * worktree of that repo on a branch whose name carries the increment's id, `factory` itself when it is on one, its change and each
 * plugin's plan file there; with none, or no repository at `factory`, why not.
 */
export function factoryPlugins(factory: string, increment: string): PluginReader {
  const id = increment.replace(/^increment_/, "");
  let found: { folder: string; change?: WorktreeChange } | { unread: string } | undefined;
  const folder = (): typeof found => {
    const git = (...args: string[]): string | undefined => {
      try {
        return execFileSync("git", args, { cwd: factory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      } catch {
        return undefined;
      }
    };
    const list = git("worktree", "list", "--porcelain");
    if (list === undefined) return { unread: `the factory folder ${factory} is no git repository` };
    const current = git("symbolic-ref", "--quiet", "--short", "HEAD")?.trim();
    if (current !== undefined && incrementOfBranch(current) === id) return { folder: factory };
    for (const entry of list.split(/\n\n+/)) {
      const lines = entry.split("\n");
      const at = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
      if (at !== undefined && branch !== undefined && incrementOfBranch(branch) === id) return { folder: at };
    }
    return { unread: `no worktree of the factory repo at ${factory} is on a branch carrying ${increment}'s id` };
  };
  return (plugin) => {
    found ??= folder();
    if ("unread" in found!) return found;
    const read = found!;
    read.change ??= worktreeChange(read.folder);
    let plan: PluginPlan | undefined;
    try {
      plan = pluginPlan(read.folder, plugin);
    } catch {
      // A plugin whose plan cannot be read keeps the library's contracts.
    }
    return { folder: read.folder, change: read.change, ...(plan === undefined ? {} : { plan }) };
  };
}

/** The increment a branch's name carries (claude/increment-<id>-<suffix>), as the gate's capability-list check reads it. */
function incrementOfBranch(branch: string): string | undefined {
  const named = /(?:^|[/_-])increment[-_]([0-9a-f]{12})(?![0-9a-f])/i.exec(branch);
  return named === null ? undefined : named[1]!.toLowerCase();
}

/** A file Git does not track yet, as a diff that adds it. */
function newFileDiff(cwd: string, file: string): string {
  try {
    return execFileSync("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch (error) {
    // `git diff --no-index` exits 1 when the two differ, which a new file always does.
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status === 1 && typeof stdout === "string") return stdout;
    throw error;
  }
}

/**
 * The branch the checkout in `cwd` is reviewed against: the one origin names as its default, as the checkout last heard,
 * else origin/main; with neither, its local default branch: init.defaultBranch, else main, else master (contract 2.7).
 * Undefined when it has none of these.
 */
export function branchBase(cwd: string): Base | undefined {
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const exists = (ref: string) => git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`) !== undefined;
  const named = git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  if (named !== undefined && exists(named)) return { ref: named };
  if (exists("refs/remotes/origin/main")) return { ref: "origin/main" };
  const local = [git("config", "--get", "init.defaultBranch"), "main", "master"].find((branch) => branch !== undefined && exists(`refs/heads/${branch}`));
  return local === undefined ? undefined : { ref: local, local: true };
}

/** One contract of the brief as a line, with its description beneath, at `indent`. */
function contractLine(contract: Brief["contracts"][number], indent: string): string {
  return `${indent}${contract.id}  ${contract.title}${contract.pending ? "  (as this change rewords it, pending its merge)" : ""}${contract.plugin !== undefined && contract.id.startsWith(`${contract.plugin}:`) ? `  (only in ${contract.plugin}'s plan)` : ""}${contract.description === undefined ? "" : `\n${indent}  ${contract.description}`}`;
}

/** The brief as the plain text the change-reviewer reads. */
export function briefText(brief: Brief): string {
  // A contract the change rewords or retires is listed once, above, so its plan change is not listed again (contract 2.4).
  const listed = new Set([...brief.contracts.filter(({ pending }) => pending).map(({ id }) => id), ...(brief.retired ?? []).map(({ id }) => id)]);
  const plan = (brief.plan ?? []).filter(({ record }) => !listed.has(record));
  return [
    `Review ${brief.iteration} of change ${brief.change} (project ${brief.project}); packages it touches: ${brief.packages.join(", ")}.`,
    `Your return names this review, "review": ${brief.iteration}, or it is refused as another review's.`,
    brief.pass === "light"
      ? `Light pass: this change reads ${riskLineText(brief.risk!)}, so judge every check and contract from the diff below alone, without reading around a hunk, opening other files or running anything${(brief.guardrails ?? []).length === 0 ? "" : " but the guardrails below"}.`
      : brief.risk === undefined
        ? "Full review: no risk line was read for this change. Read the lines around a hunk in the files the diff touches wherever the hunk alone is not enough."
        : `Full review: this change reads ${riskLineText(brief.risk)}. Read the lines around a hunk in the files the diff touches wherever the hunk alone is not enough.`,
    "",
    `Checks (${brief.checks.length}): for each, say whether the change trips it, and where (file, line, what you found).`,
    ...brief.checks.map((check) => [
      `  ${check.id}  ${check.title}\n    ${check.question}`,
      ...(check.graduated ?? []).map((part) => `    Not yours to judge: Architecture checks' ${part.enforcedBy} checks ${part.part}.`),
    ].join("\n")),
    "",
    `Contracts (${brief.contracts.length}): for each, say whether the change does what it says, and why not, and whether the change touches it ("touched"): it adds or rewords the contract, or changes code under it. For each one it touches, find the contract's existing tests (its number in its story's package's test titles) and name, as "test", the one that covers the changed behaviour (<file> › <title>); where none does, give "at", the changed line's file and line, and it is taken as a hit asking for one. "Met" alone is no answer for a touched contract.`,
    ...(brief.capabilities === undefined
      ? brief.contracts.map((contract) => contractLine(contract, "  "))
      : brief.capabilities.map((capability) => {
        const under = brief.contracts.filter((contract) => contract.capability === capability.id);
        return [
          `  ${capability.story.title} › ${capability.title}  (${capability.id})`,
          ...(under.length === 0 ? ["    no contracts"] : under.map((contract) => contractLine(contract, "    "))),
        ].join("\n");
      })),
    ...((brief.retired ?? []).length === 0 ? [] : [
      `Retired contracts (${brief.retired!.length}): not yours to judge, and not answered in the return.`,
      ...brief.retired!.map((contract) => `  ${contract.id}  ${contract.title}\n    retired by this change, pending its merge: ${contract.reason}`),
    ]),
    ...(plan.length === 0 ? [] : [
      "",
      `Pending plan changes (${plan.length}): what this change does to the plan on its merge, besides the contracts above it rewords or retires; judge them with the checks and contracts above; a hit on one names its record as the file, at line 1.`,
      ...plan.map((entry) => `  ${entry.record}  ${entry.type}  ${entry.title}\n    ${"retire" in entry ? `retired: ${entry.retire}` : `becomes: ${JSON.stringify(entry.after)}`}`),
    ]),
    ...((brief.records ?? []).length === 0 ? [] : [
      "",
      `Library records (${brief.records!.length}): what the sessions that claimed this change wrote or edited in the library since claiming it, as their last write left each; judge them with the checks and contracts above like the diff; a hit on one names its record as the file, at line 1.`,
      ...brief.records!.map((entry) => `  ${entry.record}  ${entry.type}  ${entry.title}  ${entry.action}\n    ${entry.action === "retired" ? `retired: ${entry.reason}` : JSON.stringify(entry.fields)}`),
    ]),
    ...((brief.guardrails ?? []).length === 0 ? [] : [
      "",
      `Guardrails (${brief.guardrails!.length}): this change sets each off. Start the real app, or the built website, from seeded fixtures at the state nearest the change, click through only that part against the contracts above and the on-screen done-criteria, and save pictures of what you saw; answer each passed or failed, with its pictures, and why when failed.`,
      ...brief.guardrails!.map((guardrail) => `  ${guardrail.id}  ${guardrail.on.title}\n    ${guardrail.check}`),
    ]),
    ...((brief.reds ?? []).length === 0 ? [] : [
      "",
      `New tests (${brief.reds!.length}): each test the diff adds, an outside checkout's under its folder, and whether a red run \`pnpm test\` saved in its worktree names it failing. One with no saved red run is taken as a hit at its line when your return is taken: you need not raise it.`,
      ...brief.reds!.map(({ folder, file, line, test, red }) => `  ${folder === undefined ? "" : `${folder}: `}${file}:${line}  ${test}  ${red ? "red run saved" : "no saved red run"}`),
    ]),
    ...(brief.earlier.length === 0 ? [] : [
      "",
      `Earlier hits (${brief.earlier.length}), with the implementer's answer:`,
      ...brief.earlier.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.found ?? ""}\n    ${hit.answer === "rejected" ? `rejected: ${hit.reason}${hit.accepted ? " (accepted)" : ""}` : hit.answer}`),
      `Judge each of these rejections, accepting its reason or not: ${brief.judge.length === 0 ? "none" : brief.judge.map((id) => `hit ${id}`).join(", ")}.`,
    ]),
    ...(brief.factory === undefined ? [] : [
      "",
      brief.factory.unread !== undefined
        ? `Factory plugins (${brief.factory.plugins.join(", ")}): ${brief.factory.plugins.map((plugin) => `${plugin}'s change was not read`).join("; ")}: ${brief.factory.unread}. Answer each of their contracts not met, saying so: a return answering one met is refused.`
        : `Factory plugins (${brief.factory.plugins.join(", ")}): their contracts above are as their plan files on the increment's branch number them; one marked as the plan's only is new in it. Their change is ${brief.factory.diff === undefined ? `the diff below, read from ${brief.factory.folder}` : `the factory worktree ${brief.factory.folder}'s diff against its default branch, judged with the checks and contracts like the diff below:`}`,
      ...(brief.factory.diff === undefined ? [] : [brief.factory.diff]),
    ]),
    ...(brief.also ?? []).flatMap((half) => [
      "",
      `The change's other half, the checkout ${half.folder}: its branch's diff against its default branch, judged with the checks and contracts like the diff below:`,
      half.diff,
    ]),
    "",
    brief.since !== undefined
      ? `${brief.diff === "" ? "Nothing changed" : "The diff of what changed"} since review ${brief.since.review} (commit ${brief.since.head.slice(0, 12)}), which read the whole change: judge the checks and contracts on what changed, the whole change being in its worktree, and raise no finding the earlier hits already hold.`
      : diffPackages(brief.diff).length === 0 ? `The diff touches no file: the change under review is ${[...((brief.plan ?? []).length === 0 ? [] : ["its pending plan changes"]), ...((brief.records ?? []).length === 0 ? [] : ["the library records above"])].join(" and ") || "its pending plan changes"}.` : brief.base?.local ? `The diff against ${brief.base.ref}, this repository's own default branch: it has no origin/main.` : `The diff against ${brief.base?.ref ?? "origin/main"}:`,
    brief.diff,
  ].join("\n");
}

/** A taken return as plain text: the review's hits with their ids, contracts unmet, and whether the change is ready for the gate. */
export function takenText(taken: Taken): string {
  return [
    `Recorded review ${taken.review}: ${taken.hits.length === 0 ? "no hits" : `${taken.hits.length} hit${taken.hits.length === 1 ? "" : "s"}`}.`,
    ...taken.hits.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.found ?? ""}`),
    ...(taken.graduatedNotRun === undefined ? [] : [`  Architecture checks' graduated checks did not run, so nothing of theirs is recorded: ${taken.graduatedNotRun}`]),
    standingText(taken.standing, taken.unmet, taken.failed),
  ].join("\n");
}

/** The standing findings, unmet contracts and failed guardrails as plain text, or that the change is ready for the gate. */
export function standingText(standing: readonly HitRow[], unmet: readonly Unmet[] = [], failed: readonly Failed[] = []): string {
  const count = standing.length + unmet.length + failed.length;
  if (count === 0) return "No finding stands: the change is ready for the gate.";
  return [
    `${count} finding${count === 1 ? "" : "s"} stand${count === 1 ? "s" : ""}; answer each hit, fixed or rejected with a reason, fix each contract not met or put it to the owner, fix each guardrail failed, then review again:`,
    ...standing.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.answer === "rejected" ? `rejected, not accepted: ${hit.reason}` : "unanswered"}`),
    ...unmet.map(({ contract, why }) => `  contract ${contract} not met: ${why}`),
    ...failed.map(({ guardrail, why }) => `  guardrail ${guardrail} failed: ${why}`),
  ].join("\n");
}
