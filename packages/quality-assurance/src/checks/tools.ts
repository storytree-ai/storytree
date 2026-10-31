/**
 * Capability 1 · Quality control checks, capability 2 · Change review, capability 3 · QA ledger and capability 4 · Review loop
 * bound, capability 5 · Graduation and capability 7 · Mutation report: the checks and ledger readings, the change-reviewer's loop and a check's graduation as tools on the MCP server's one server, through
 * its extension point (its ToolExtension, ADR-0643 D6, ADR-0969 D1). The extension's shape is restated rather
 * than imported, as the librarian's is: no story may depend on the MCP server, which depends on this
 * package to serve the tool, and checks the two still fit where it mounts its tool parts (its test 6.75).
 */
import type { Library, Storytree } from "@storytree/library";
import { z } from "zod";

import { graduate, graduatedFindings } from "../graduation/graduation.js";
import { ledgerText, openLedger } from "../ledger/ledger.js";
import { briefWithReport, takenWithSurvivors } from "../mutation/mutation.js";
import { claimingWriters, openReviews, standingText, takenText, worktreeChange, type ReviewReturn } from "../review/review.js";
import { checks, checksText } from "./checks.js";

/** What a tool has to work with for one call, as far as the checks and ledger readings need it. */
interface ToolCall {
  readonly library: Library;
  /** The connection the library was opened on, which hands out the ledger's own database. */
  readonly storytree: Storytree;
  readonly project: string;
  /** The activity log the server writes, from which a brief reads who claimed the increment (contract 2.22). */
  readonly log?: unknown;
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
}

/** Registers one tool: its name, what it is for, its arguments, what it does with them, and who calls it (ADR-1045 D1). */
type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>, options?: { readonly consumers?: readonly ("agent" | "user")[] }) => void;

/** The checks, the ledger and the review loop are an agent session's: a reviewer's and its implementer's (ADR-1045 D1). */
const AGENT = { consumers: ["agent"] } as const;

/** Quality assurance's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
  readonly instructions?: string;
}

/** Quality assurance's tool part, named in its manifest (ADR-1021): served for every project's library (ADR-0996). */
export const qualityToolParts = [(): ToolExtension => qualityTools()];

/** What the change-reviewer returns, as a tool's argument; the loop itself refuses a return that does not answer its brief. */
const reviewReturn = z.object({
  review: z.number().int().optional().describe("The review it answers, as its brief numbers it: a return naming none, or another, is refused"),
  checks: z.array(z.object({ check: z.string(), tripped: z.boolean(), hits: z.array(z.object({ file: z.string(), line: z.number(), found: z.string() })).optional() })).describe("Every check in the brief: tripped or not, and where tripped each file, line and what was found"),
  contracts: z.array(z.object({
    contract: z.string(), met: z.boolean(), why: z.string().optional(),
    touched: z.boolean().optional().describe("Whether the change touches the contract: adds or rewords it, or changes code under it; required when met"),
    test: z.string().optional().describe("For a touched contract met: the test covering the changed behaviour, as <file> › <title>"),
    at: z.object({ file: z.string(), line: z.number() }).optional().describe("For a touched contract met that no test covers: the changed line, taken as a hit asking for a test"),
  })).describe("Every contract in the brief: met or not, why not, and, when met, whether the change touches it and the test that covers it"),
  rejections: z.array(z.object({ hit: z.number(), accepted: z.boolean(), why: z.string().optional() })).optional().describe("Each rejection the brief asks to judge: whether its reason is accepted"),
});

/** The tools this story serves on the MCP server: the checks reading (contract 1.2), the ledger's (3.4), the review loop (2.3, 4.4) and graduation (5.1, 5.3). */
export function qualityTools(): ToolExtension {
  return {
    registerTools(define) {
      define("quality_checks", "Read every live quality control check: the yes-or-no question a reviewer answers about a finished change, and the principle or guardrail notes it enforces.", z.object({}), async (_args, { library }) => {
        const reading = await checks(library);
        return { text: checksText(reading), data: { checks: reading } };
      }, AGENT);
      define("quality_ledger", "Read the QA ledger's counts for this project: for each quality control check and each package, how many reviews ran it and how many hits it made, by the implementer's answer (fixed, rejected, unanswered).", z.object({}), async (_args, { storytree, project }) => {
        const reading = await (await openLedger(storytree)).reading(project);
        return { text: ledgerText(reading), data: { ledger: reading } };
      }, AGENT);
      define("quality_brief", "Issue the next review's brief for an increment's change: its diff against the default branch origin names (origin/main when it names none, and the local default branch in a repository with no origin/main), the contracts of the capabilities it names and every live check. Give the diff, or the worktree whose branch is the change.", z.object({
        increment: z.string().min(1).describe("The increment whose change is reviewed"),
        diff: z.string().optional().describe("The change's diff against its default branch, as git diff gives it"),
        worktree: z.string().optional().describe("The worktree whose branch is the change, to read the diff from"),
        also: z.array(z.string().min(1)).optional().describe("Each checkout outside the project whose branch is the change's other half, as an increment landing in storytree and the factory repo has: its diff is listed beside the change's"),
      }), async ({ increment, diff, worktree, also }, { library, storytree, project, log }) => {
        if (diff === undefined && worktree === undefined) throw new Error("Give the change's diff, or the worktree whose branch is the change: this server's folder is not the branch.");
        // The library records the increment's claiming sessions wrote are part of the change (contract 2.22).
        const writers = log === undefined ? [] : await claimingWriters(log as Parameters<typeof claimingWriters>[0], project, increment);
        const brief = await (await openReviews(storytree)).brief(library, increment, diff ?? worktreeChange(worktree!), undefined, undefined, (also ?? []).map((folder) => worktreeChange(folder)), writers);
        const { text, mutation } = await briefWithReport(storytree, brief, diff === undefined ? worktree : undefined);
        return { text, data: { brief, ...(mutation === undefined ? {} : { mutation }) } };
      }, AGENT);
      define("quality_take", "Take the change-reviewer's return on an increment's brief into the QA ledger, or refuse it naming what it leaves out, recording nothing. Give the worktree whose branch is the change, and what Architecture checks' graduated checks find there is recorded with it.", z.object({
        increment: z.string().min(1).describe("The increment whose change was reviewed"),
        return: reviewReturn,
        worktree: z.string().optional().describe("The worktree whose branch is the change, for Architecture checks' graduated checks to run on"),
        also: z.array(z.string().min(1)).optional().describe("Each checkout the brief read the change's other half from, for the graduated checks to run on too"),
      }), async ({ increment, return: review, worktree, also }, { library, storytree, project }) => {
        const graduated = worktree === undefined
          ? { ran: false as const, reason: "no worktree was given, and this server's folder is not the branch." }
          : await graduatedFindings(library, worktree, also ?? []);
        const reviews = await openReviews(storytree);
        const taken = await takenWithSurvivors(storytree, reviews, project, increment, await reviews.take(project, increment, review as ReviewReturn, graduated));
        return { text: takenText(taken), data: { taken } };
      }, AGENT);
      define("quality_answer", "The implementer's answer to a review's hit: fixed, or rejected with a reason.", z.object({
        hit: z.number().int().describe("The hit, by its number"),
        answer: z.enum(["fixed", "rejected"]),
        reason: z.string().optional().describe("Why the hit is rejected; needed for a rejection"),
      }), async ({ hit, answer, reason }, { storytree, project }) => {
        if (answer === "rejected" && reason === undefined) throw new Error("A rejected hit needs its reason.");
        await (await openLedger(storytree)).answer(project, hit, answer === "fixed" ? { answer } : { answer, reason: reason! });
        return { text: `Answered hit ${hit}: ${answer}.`, data: { hit, answer } };
      }, AGENT);
      define("quality_standing", "The findings that still stand on an increment's change, or that it is ready for the gate.", z.object({
        increment: z.string().min(1).describe("The increment whose change is reviewed"),
      }), async ({ increment }, { library, storytree, project }) => {
        const reviews = await openReviews(storytree);
        const standing = await reviews.standing(project, increment);
        const unmet = await reviews.unmet(library, increment);
        const failed = await reviews.failed(project, increment);
        return { text: standingText(standing, unmet, failed), data: { standing, unmet, failed } };
      }, AGENT);
      // "graduate" is the librarian's tool, so this one names what graduates.
      define("graduate_check", "Record that a part of a quality control check, or with whole all of it, is now enforced by a deterministic check in Architecture checks; the reviewer judges only the rest, and a check graduated whole leaves the review brief.", z.object({
        check: z.string().min(1).describe("The check that graduates"),
        part: z.string().min(1).describe("The part of the check Architecture checks now enforces"),
        enforced_by: z.string().min(1).describe("The graduated check in Architecture checks that enforces it"),
        whole: z.boolean().optional().describe("True when the part is all of the check, so it leaves the review brief"),
      }), async ({ check, part, enforced_by, whole }, { library }) => {
        await graduate(library, check, { part, enforcedBy: enforced_by, ...(whole ? { whole: true as const } : {}) });
        const reading = (await checks(library)).filter(({ id }) => id === check);
        return { text: `Graduated ${whole ? "all" : "part"} of ${check}.\n${checksText(reading)}`, data: { check: reading[0] } };
      }, AGENT);
    },
  };
}

/** Its section of the habits card (ADR-1021, the guidance kind): red, then green, then reviewed and landed. */
export const qualityGuidance: readonly string[] = [
  [
  "Red, then green, then landed. Stop for the user's approval of the plan, the failing tests and the diff, unless their instructions file hands you these gates.",
  "- Plan: in the user's folder, never a worktree, show the increment's contracts and wait; then git switch -c <increment> before red.",
  "- In someone else's repository (an origin not the user's): follow its layout, naming and test style (no contract numbers in test names); plan only the change asked for (one story, its capabilities, a few contracts, what you left out), no `import_project`; never `wire_pipeline`, add CI or config, create a remote or push; put .storytree/ in .git/info/exclude.",
  "- Red (in Claude Code, spawn the storytree-red agent if present): only tests, for the increment's contracts. Run them; each must fail for the missing behaviour, not an import error. `report` each red. Show the run's summary and a table per test: test, contract, why needed, quoted failure line, would it fail without the behaviour (drop it if not). STOP until the user approves, drops or rewrites tests.",
  "- Green (the storytree-green agent if present): hash the approved test files (git hash-object), write the least code that passes them, never editing one (stop and say why if one looks wrong); run the whole suite, `report` green, show the hashes unchanged and git diff --stat.",
  "- Before landing, have a fresh-context subagent, told only the increment and folder, review it: `quality_brief` gives the review the diff, contracts and checks (`quality_checks` lists them); `quality_take` records it. Answer each hit with `quality_answer`, fixed or rejected with a reason, and review again while `quality_standing` lists one. `quality_ledger` counts hits by check; `graduate_check` records a check's part now enforced deterministically.",
  "- Show the user the diff and STOP until they approve. Then commit on the branch and merge it to main locally; or, if the user asked for a pull request or the remote is theirs, push the branch, open one and stop, never merging it.",
  "- When its contracts pass, `land` the capability, ending your claim; it is held while a source file of the story's package is reached by no numbered test, and names each planned contract no numbered test proves (write its test, or retire it). Stopping before then, `release` it.",
  "- `mark_built` a capability once you consider it built; its card then shows the health storytree verified, never your report.",
  "- Between increments, `read_context` gives your context's size: judge whether to take on more.",
  "- When the increment is done, `close_increment` with its outcome (landed, failed, withdrawn) and pull request, or a note naming the local commit. Record unparked work that landed with `park_increment` and its outcome.",
  "- When your session's work is done, `close_out`: say whether it is safe to close (pull requests merged or commits made, tree clean, nothing of yours running) and why. The sessions list checks a yes and keeps what it cannot bear out listed for the owner.",
  ].join("\n"),
];
