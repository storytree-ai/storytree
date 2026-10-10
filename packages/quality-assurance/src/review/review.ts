/**
 * Capability 2 · Change review and capability 4 · Review loop bound (ADR-0956 D1, D7). What the
 * change-reviewer reads, the brief, and what it returns, taken into the QA ledger; and the loop of reviews of
 * one change, bounded at ten.
 *
 * - A change is one increment's branch, named by the increment. Each review of it is one iteration: a brief
 *   issued, then the reviewer's return taken. A brief not yet taken is replaced by the next one issued.
 * - The brief holds the branch's diff against origin/main, every contract of the capabilities the increment
 *   names, and every live check; never the increment's body or the implementer's reasoning (contract 2.1).
 *   From the second review on it also holds each earlier hit with the implementer's answer, and the
 *   rejections the reviewer must judge (4.2).
 * - A return is taken whole or not at all: it answers every check and contract in its brief, and judges every
 *   rejection, and nothing else (2.2, 4.2).
 * - A finding stands while it is unanswered, or rejected for a reason no later review accepted (4.1). With
 *   one standing after the tenth review, the eleventh brief is refused, naming the arc for the session's
 *   question (4.3); the refusal itself writes nothing.
 * - Capability 5 · Graduation (ADR-0956 D5): a check graduated whole leaves the brief, and one graduated in part stays in the brief with the part Guardrails
 *   now enforces named (5.2), and what Guardrails' graduated checks find on the change is taken with the return,
 *   recorded as theirs under the check each graduated from (5.3).
 */
import { execFileSync } from "node:child_process";

import type { Library, Storytree } from "@storytree/library";

import { checks as liveChecks, type Graduated } from "../checks/checks.js";
import type { GraduatedFindings } from "../graduation/graduation.js";
import { HIT_COLUMNS, hitRow, inTransaction, ledgerDatabase, writeReview, type HitRecord, type HitRow } from "../ledger/ledger.js";

/** The reviews of one change that may run while a finding still stands (ADR-0956 D7). */
export const REVIEW_LIMIT = 10;

/** One review's brief: everything the change-reviewer reads. */
export interface Brief {
  readonly project: string;
  /** The change: the increment whose branch it is. */
  readonly change: string;
  readonly iteration: number;
  /** The branch's diff against origin/main. */
  readonly diff: string;
  /** The packages the diff touches (`root` for files outside any package). */
  readonly packages: readonly string[];
  readonly contracts: readonly { readonly id: string; readonly title: string; readonly description?: string }[];
  /** Each live check not graduated whole; one graduated in part names the parts Guardrails now enforces, which the reviewer does not judge (contract 5.2). */
  readonly checks: readonly { readonly id: string; readonly title: string; readonly question: string; readonly graduated?: readonly Graduated[] }[];
  /** Each hit earlier reviews of this change made, with the implementer's answer. */
  readonly earlier: readonly HitRow[];
  /** The earlier hits rejected for a reason no review has accepted yet: the return judges each. */
  readonly judge: readonly number[];
}

/** What the change-reviewer returns for one brief. */
export interface ReviewReturn {
  readonly checks: readonly { readonly check: string; readonly tripped: boolean; readonly hits?: readonly { readonly file: string; readonly line: number; readonly found: string }[] }[];
  readonly contracts: readonly { readonly contract: string; readonly met: boolean; readonly why?: string }[];
  readonly rejections?: readonly { readonly hit: number; readonly accepted: boolean; readonly why?: string }[];
}

/** A return taken: the review's name in the ledger, its hits, the contracts it found unmet, and what stands now. */
export interface Taken {
  readonly review: string;
  readonly hits: readonly HitRow[];
  readonly unmet: readonly { readonly contract: string; readonly why: string }[];
  readonly standing: readonly HitRow[];
  /** Why Guardrails' graduated checks did not run on the change, when they did not: none of their findings is recorded. */
  readonly graduatedNotRun?: string;
}

/** The review loop on one Postgres server, in the QA ledger's database. */
export interface Reviews {
  /** Issue the next brief for `change` (an increment of `library`'s project), its diff given; refused after the tenth with a finding standing. */
  brief(library: Library, change: string, diff: string): Promise<Brief>;
  /**
   * Take the reviewer's return on `change`'s brief awaiting one, or refuse it naming what it gets wrong, writing nothing.
   * What Guardrails' graduated checks found on the change, when given, is recorded with it as theirs (contract 5.3).
   */
  take(project: string, change: string, review: ReviewReturn, graduated?: GraduatedFindings): Promise<Taken>;
  /** `change`'s standing findings, oldest first: none means it is ready for the gate. */
  standing(project: string, change: string): Promise<HitRow[]>;
}

/** Open the review loop on `server`'s connection. */
export async function openReviews(server: Storytree): Promise<Reviews> {
  return new PgReviews(await ledgerDatabase(server));
}

/** The package a repository path belongs to: `packages/<name>/…` and `apps/<name>/…` name theirs, anything else is `root`. */
export function packageOf(file: string): string {
  const match = /^(?:packages|apps)\/([^/]+)\//.exec(file.replace(/\\/g, "/"));
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

  async brief(library: Library, change: string, diff: string): Promise<Brief> {
    const increment = await library.get(change);
    if (increment === null || increment.type !== "increment") throw new Error(`${change} is not an increment in project "${library.name}": a change is reviewed by its increment.`);
    const packages = diffPackages(diff);
    if (packages.length === 0) throw new Error("The diff touches no file: commit the change, then review it.");
    const project = library.name;
    const taken = await this.#taken(project, change);
    const earlier = await this.#hits(project, change, "TRUE");
    const standing = earlier.filter((hit) => hit.answer === "unanswered" || (hit.answer === "rejected" && !hit.accepted));
    if (taken >= REVIEW_LIMIT && standing.length > 0) {
      const arc = (increment.fields as { arc: string }).arc;
      throw new Error([
        `${taken} reviews of ${change} have run and ${standing.length} finding${standing.length === 1 ? "" : "s"} still stand${standing.length === 1 ? "s" : ""}, so no further review runs (ADR-0956 D7).`,
        ...standing.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.answer === "rejected" ? `rejected: ${hit.reason}` : "unanswered"}`),
        `Raise an open question on arc ${arc} holding ${change}, in ADR-0944 D4's order: land what is green, push the rest and name its branch in the residue, raise the question, release the claims.`,
      ].join("\n"));
    }
    const capabilities = new Set((increment.fields as { capabilities?: string[] }).capabilities ?? []);
    const contracts = (await library.list("contract"))
      .filter((contract) => capabilities.has(contract.fields.capability))
      .map((contract) => ({ id: contract.id, title: contract.fields.title, ...(contract.fields.description === undefined ? {} : { description: contract.fields.description }) }))
      .sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }) || a.id.localeCompare(b.id));
    const brief: Brief = {
      project, change, iteration: taken + 1, diff, packages, contracts,
      checks: (await liveChecks(library)).filter(({ graduated }) => !(graduated ?? []).some(({ whole }) => whole)).map(({ id, title, question, graduated }) => ({ id, title, question, ...(graduated === undefined ? {} : { graduated }) })),
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
    const hits = await inTransaction(this.#pool, async (client) => {
      const written = await writeReview(client, {
        project, review: name, change, packages: brief.packages,
        ran: [
          ...review.checks.map(({ check, hits }) => ({ check, hits: (hits ?? []).map(({ file, line, found }) => ({ package: packageOf(file), file, line, found })) })),
          // A graduated check's trip outside the packages the brief's diff touches is not part of the change reviewed.
          ...(graduated?.ran ? graduated.checks : []).map(({ check, hits }) => ({
            check, foundBy: "graduated" as const,
            hits: hits.map(({ file, line, found }) => ({ package: packageOf(file), file, line, found })).filter((hit) => brief.packages.includes(hit.package)),
          })),
        ],
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
      unmet: review.contracts.filter(({ met }) => !met).map(({ contract, why }) => ({ contract, why: why ?? "" })),
      standing: await this.standing(project, change),
      ...(graduated !== undefined && !graduated.ran ? { graduatedNotRun: graduated.reason } : {}),
    };
  }

  standing(project: string, change: string): Promise<HitRow[]> {
    return this.#hits(project, change, STANDING);
  }

  async #taken(project: string, change: string): Promise<number> {
    const { rows } = await this.#pool.query<{ taken: number }>("SELECT count(*)::int AS taken FROM quality_briefs WHERE project = $1 AND change = $2 AND taken_at IS NOT NULL", [project, change]);
    return rows[0]!.taken;
  }

  async #hits(project: string, change: string, where: string): Promise<HitRow[]> {
    const { rows } = await this.#pool.query<HitRecord>(`SELECT ${HIT_COLUMNS} FROM quality_hits WHERE project = $1 AND change = $2 AND ${where} ORDER BY id`, [project, change]);
    return rows.map(hitRow);
  }
}

/** What a return gets wrong against its brief, each naming the check, contract or hit; none means it is taken. */
function refusals(brief: Brief, review: ReviewReturn): string[] {
  const problems: string[] = [];
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
  for (const { check, tripped, hits = [] } of review.checks ?? []) {
    if (tripped && hits.length === 0) problems.push(`check ${check} is tripped and names no file and line`);
    if (!tripped && hits.length > 0) problems.push(`check ${check} is not tripped and names hits`);
    for (const { file, line, found } of hits) {
      if (typeof file !== "string" || file.trim() === "") problems.push(`check ${check} has a hit with no file`);
      if (!Number.isInteger(line) || line < 1) problems.push(`check ${check}'s hit in ${file} has line ${line}: a line is a whole number from 1`);
      if (typeof found !== "string" || found.trim() === "") problems.push(`check ${check}'s hit at ${file}:${line} does not say what was found`);
      if (typeof file === "string" && !brief.packages.includes(packageOf(file))) problems.push(`check ${check}'s hit at ${file}:${line} is in package ${packageOf(file)}, which the diff does not touch`);
    }
  }
  for (const { contract, met, why } of review.contracts ?? []) {
    if (!met && (why ?? "").trim() === "") problems.push(`contract ${contract} is not met and the return does not say why`);
  }
  return problems;
}

/** The diff of the branch checked out in `cwd` against `base` (from where they parted), as `git diff` gives it. */
export function branchDiff(cwd: string, base = "origin/main"): string {
  return execFileSync("git", ["diff", `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** The brief as the plain text the change-reviewer reads. */
export function briefText(brief: Brief): string {
  return [
    `Review ${brief.iteration} of change ${brief.change} (project ${brief.project}); packages it touches: ${brief.packages.join(", ")}.`,
    "",
    `Checks (${brief.checks.length}): for each, say whether the change trips it, and where (file, line, what you found).`,
    ...brief.checks.map((check) => [
      `  ${check.id}  ${check.title}\n    ${check.question}`,
      ...(check.graduated ?? []).map((part) => `    Not yours to judge: Guardrails' ${part.enforcedBy} checks ${part.part}.`),
    ].join("\n")),
    "",
    `Contracts (${brief.contracts.length}): for each, say whether the change does what it says, and why not.`,
    ...brief.contracts.map((contract) => `  ${contract.id}  ${contract.title}${contract.description === undefined ? "" : `\n    ${contract.description}`}`),
    ...(brief.earlier.length === 0 ? [] : [
      "",
      `Earlier hits (${brief.earlier.length}), with the implementer's answer:`,
      ...brief.earlier.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.found ?? ""}\n    ${hit.answer === "rejected" ? `rejected: ${hit.reason}${hit.accepted ? " (accepted)" : ""}` : hit.answer}`),
      `Judge each of these rejections, accepting its reason or not: ${brief.judge.length === 0 ? "none" : brief.judge.map((id) => `hit ${id}`).join(", ")}.`,
    ]),
    "",
    "The diff against origin/main:",
    brief.diff,
  ].join("\n");
}

/** A taken return as plain text: the review's hits with their ids, contracts unmet, and whether the change is ready for the gate. */
export function takenText(taken: Taken): string {
  return [
    `Recorded review ${taken.review}: ${taken.hits.length === 0 ? "no hits" : `${taken.hits.length} hit${taken.hits.length === 1 ? "" : "s"}`}.`,
    ...taken.hits.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.found ?? ""}`),
    ...(taken.graduatedNotRun === undefined ? [] : [`  Guardrails' graduated checks did not run, so nothing of theirs is recorded: ${taken.graduatedNotRun}`]),
    ...taken.unmet.map(({ contract, why }) => `  contract ${contract} not met: ${why}`),
    standingText(taken.standing),
  ].join("\n");
}

/** The standing findings as plain text, or that the change is ready for the gate. */
export function standingText(standing: readonly HitRow[]): string {
  if (standing.length === 0) return "No finding stands: the change is ready for the gate.";
  return [
    `${standing.length} finding${standing.length === 1 ? "" : "s"} stand${standing.length === 1 ? "s" : ""}; answer each, fixed or rejected with a reason, then review again:`,
    ...standing.map((hit) => `  hit ${hit.id}  ${hit.check}  ${hit.file}:${hit.line}  ${hit.answer === "rejected" ? `rejected, not accepted: ${hit.reason}` : "unanswered"}`),
  ].join("\n");
}
