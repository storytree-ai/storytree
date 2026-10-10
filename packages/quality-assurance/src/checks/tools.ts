/**
 * Capability 1 · Quality control checks, capability 2 · Change review, capability 3 · QA ledger and capability 4 · Review loop
 * bound, and capability 5 · Graduation: the checks and ledger readings, the change-reviewer's loop and a check's graduation as tools on the MCP server's one server, through
 * its extension point (its ToolExtension, ADR-0643 D6, ADR-0969 D1). The extension's shape is restated rather
 * than imported, as the librarian's is: no story may depend on the MCP server, which depends on this
 * package to serve the tool, and checks the two still fit where it registers qualityTools.
 */
import type { Library, Storytree } from "@storytree/library";
import { z } from "zod";

import { graduate, graduatedFindings } from "../graduation/graduation.js";
import { ledgerText, openLedger } from "../ledger/ledger.js";
import { branchDiff, briefText, openReviews, standingText, takenText, type ReviewReturn } from "../review/review.js";
import { checks, checksText } from "./checks.js";

/** What a tool has to work with for one call, as far as the checks and ledger readings need it. */
interface ToolCall {
  readonly library: Library;
  /** The connection the library was opened on, which hands out the ledger's own database. */
  readonly storytree: Storytree;
  readonly project: string;
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
}

/** Registers one tool: its name, what it is for, its arguments, and what it does with them. */
type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

/** Quality assurance's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
  readonly instructions?: string;
}

/** What the change-reviewer returns, as a tool's argument; the loop itself refuses a return that does not answer its brief. */
const reviewReturn = z.object({
  checks: z.array(z.object({ check: z.string(), tripped: z.boolean(), hits: z.array(z.object({ file: z.string(), line: z.number(), found: z.string() })).optional() })).describe("Every check in the brief: tripped or not, and where tripped each file, line and what was found"),
  contracts: z.array(z.object({ contract: z.string(), met: z.boolean(), why: z.string().optional() })).describe("Every contract in the brief: met or not, and why not"),
  rejections: z.array(z.object({ hit: z.number(), accepted: z.boolean(), why: z.string().optional() })).optional().describe("Each rejection the brief asks to judge: whether its reason is accepted"),
});

/** The tools this story serves on the MCP server: the checks reading (contract 1.2), the ledger's (3.4), the review loop (2.3, 4.4) and graduation (5.1, 5.3). */
export function qualityTools(): ToolExtension {
  return {
    registerTools(define) {
      define("quality_checks", "Read every live quality control check: the yes-or-no question a reviewer answers about a finished change, and the principle or guardrail notes it enforces.", z.object({}), async (_args, { library }) => {
        const reading = await checks(library);
        return { text: checksText(reading), data: { checks: reading } };
      });
      define("quality_ledger", "Read the QA ledger's counts for this project: for each quality control check and each package, how many reviews ran it and how many hits it made, by the implementer's answer (fixed, rejected, unanswered).", z.object({}), async (_args, { storytree, project }) => {
        const reading = await (await openLedger(storytree)).reading(project);
        return { text: ledgerText(reading), data: { ledger: reading } };
      });
      define("quality_brief", "Issue the next review's brief for an increment's change: its diff against origin/main, the contracts of the capabilities it names and every live check. Give the diff, or the worktree whose branch is the change.", z.object({
        increment: z.string().min(1).describe("The increment whose change is reviewed"),
        diff: z.string().optional().describe("The change's diff against origin/main, as git diff gives it"),
        worktree: z.string().optional().describe("The worktree whose branch is the change, to read the diff from"),
      }), async ({ increment, diff, worktree }, { library, storytree }) => {
        if (diff === undefined && worktree === undefined) throw new Error("Give the change's diff, or the worktree whose branch is the change: this server's folder is not the branch.");
        const brief = await (await openReviews(storytree)).brief(library, increment, diff ?? branchDiff(worktree!));
        return { text: briefText(brief), data: { brief } };
      });
      define("quality_take", "Take the change-reviewer's return on an increment's brief into the QA ledger, or refuse it naming what it leaves out, recording nothing. Give the worktree whose branch is the change, and what Guardrails' graduated checks find there is recorded with it.", z.object({
        increment: z.string().min(1).describe("The increment whose change was reviewed"),
        return: reviewReturn,
        worktree: z.string().optional().describe("The worktree whose branch is the change, for Guardrails' graduated checks to run on"),
      }), async ({ increment, return: review, worktree }, { library, storytree, project }) => {
        const graduated = worktree === undefined
          ? { ran: false as const, reason: "no worktree was given, and this server's folder is not the branch." }
          : await graduatedFindings(library, worktree);
        const taken = await (await openReviews(storytree)).take(project, increment, review as ReviewReturn, graduated);
        return { text: takenText(taken), data: { taken } };
      });
      define("quality_answer", "The implementer's answer to a review's hit: fixed, or rejected with a reason.", z.object({
        hit: z.number().int().describe("The hit, by its number"),
        answer: z.enum(["fixed", "rejected"]),
        reason: z.string().optional().describe("Why the hit is rejected; needed for a rejection"),
      }), async ({ hit, answer, reason }, { storytree, project }) => {
        if (answer === "rejected" && reason === undefined) throw new Error("A rejected hit needs its reason.");
        await (await openLedger(storytree)).answer(project, hit, answer === "fixed" ? { answer } : { answer, reason: reason! });
        return { text: `Answered hit ${hit}: ${answer}.`, data: { hit, answer } };
      });
      define("quality_standing", "The findings that still stand on an increment's change, or that it is ready for the gate.", z.object({
        increment: z.string().min(1).describe("The increment whose change is reviewed"),
      }), async ({ increment }, { storytree, project }) => {
        const standing = await (await openReviews(storytree)).standing(project, increment);
        return { text: standingText(standing), data: { standing } };
      });
      // "graduate" is the librarian's tool, so this one names what graduates.
      define("graduate_check", "Record that a part of a quality control check, or with whole all of it, is now enforced by a deterministic check in Guardrails; the reviewer judges only the rest, and a check graduated whole leaves the review brief.", z.object({
        check: z.string().min(1).describe("The check that graduates"),
        part: z.string().min(1).describe("The part of the check Guardrails now enforces"),
        enforced_by: z.string().min(1).describe("The Guardrails graduated check that enforces it"),
        whole: z.boolean().optional().describe("True when the part is all of the check, so it leaves the review brief"),
      }), async ({ check, part, enforced_by, whole }, { library }) => {
        await graduate(library, check, { part, enforcedBy: enforced_by, ...(whole ? { whole: true as const } : {}) });
        const reading = (await checks(library)).filter(({ id }) => id === check);
        return { text: `Graduated ${whole ? "all" : "part"} of ${check}.\n${checksText(reading)}`, data: { check: reading[0] } };
      });
    },
  };
}
