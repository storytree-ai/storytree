// Capability 5 · Claims
import type { Library, WriteOptions } from "@storytree/library";
import { VerbRefusal, writtenLibrary, type Consumer } from "@storytree/library/verbs";
import { locateStorytree, type LocateOptions } from "@storytree/project-and-caller";
import { lineOf, type Caller } from "@storytree/project-and-caller/caller";
import { z } from "zod";

import { runGit } from "./activity/git.js";
import type { ActivityLog } from "./activity/index.js";
import { claim, claimAll, closeRefusal, increments, land, release, type Claim, type ClaimAnswer, type ClaimContext } from "./claims/claims.js";
import { currentBranch, type MergeWatch } from "./claims/merges.js";
import { presentQuestion, stopPresenting } from "./claims/presenting.js";
import { staleClaims } from "./claims/stale-claims.js";
import { attachWorkspace, makeWorkspace, type WorkspaceRefusal } from "./claims/workspace.js";
import { setupText } from "./claims/worktree-setup.js";
import { readContext } from "./context/context.js";
import { guidanceSentence } from "./context/guidance.js";
import { clearOwned, readClosing, renderClosing } from "./processes/closing/index.js";
import { appDatabaseWork, listRuns, renderInventory } from "./processes/listing/index.js";
import { stopOwned } from "./processes/stopping/index.js";

export { claimClearingOwnerWait } from "./claims/claims.js";

export interface ToolCall {
  readonly library: Library;
  readonly log: ActivityLog;
  readonly project: string;
  readonly caller: Caller;
  readonly folder: string;
  readonly quietMs: number;
  readonly writer: WriteOptions;
}

interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>, options?: { readonly consumers?: readonly Consumer[]; readonly writes?: true }) => void;

interface RunOwner {
  readonly session: string;
  readonly harness?: string;
  readonly agent?: "orchestrator" | "unknown" | { readonly subagent: string; readonly type?: string | undefined; readonly task?: string | undefined };
  readonly parentSession?: string;
}

interface OwnerCall {
  readonly owner: RunOwner | undefined;
  readonly locate: LocateOptions;
}

type DefineForOwner = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: OwnerCall) => Promise<ToolAnswer>, options?: { readonly anyCaller?: boolean }) => void;

export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
  readonly registerOwnerTools?: (define: DefineForOwner) => void;
}

export interface Landing {
  unplaced(capability: string, call: ToolCall): Promise<readonly string[]>;
  untested(capability: string, call: ToolCall): Promise<{ readonly titles: readonly string[]; readonly seen: boolean; readonly unreadable?: { readonly languages: readonly string[]; readonly reads: readonly string[] } }>;
  next(capability: string, call: ToolCall): Promise<readonly string[]>;
}

export interface ToolHost {
  readonly home?: string;
  readonly ledger?: string;
  readonly merges?: MergeWatch;
  readonly landing?: Landing;
}

export const sessionToolParts = [(host: ToolHost): ToolExtension => sessionTools(host)];

const capabilityId = z.string().min(1).describe("The id of the capability, as the plan shows it");
const part = {
  capability: capabilityId.optional(),
  increment: z.string().min(1).optional().describe("The id of the increment, as the plan shows it: claiming one starts it"),
};
const ONE_PART = "Name a capability or an increment to claim, exactly one.";
const inProject = z.string().min(1).optional().describe("The project whose claims this reads and ends, when not this folder's: its factory or a project that factory builds");

async function projectCall(call: ToolCall, project: string | undefined): Promise<ToolCall | ToolAnswer> {
  if (project === undefined) return call;
  try {
    const reached = await writtenLibrary(call.library, { project });
    return { ...call, library: reached, project: reached.name };
  } catch (error) {
    if (error instanceof VerbRefusal) return { text: error.message, refused: true };
    throw error;
  }
}
const ONE_CLAIM = "Name a capability, several capabilities or an increment to claim, exactly one of them.";
const AGENT = { consumers: ["agent"] } as const;

const listed = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const NO_OWNER = "This needs a resolved session identity and calling agent; use list_all_runs (or storytree processes --all) for read-only attribution.";

export function sessionTools(host: ToolHost = {}): ToolExtension {
  return {
    registerTools(define) {
      registerClaimTools(define, host.merges ?? {});
      registerLandingTools(define, host.landing);
      registerContextTool(define, host.home);
    },
    registerOwnerTools(define) {
      registerRunsTools(define, host.ledger);
    },
  };
}

function registerClaimTools(define: Define, merges: MergeWatch): void {
  define(
    "claim",
    "Pass exactly one target per call: capability, capabilities or increment. To claim an increment and a capability, call claim twice, once for each target. Claim a capability before you build it, or the increment you drive, with a one-line reason: your edits then count toward it, and claiming an increment starts it. Once you hold your increment, claim every capability you already know you need in one call, as capabilities: all are claimed or none is (ADR-1079 D2). If another live session holds it you are told who, and if it waits on other work you are told what; either way, pick other work.",
    z.object({
      ...part,
      capabilities: z.array(capabilityId).min(1).optional().describe("Several capabilities' ids, claimed in ascending id order, all or nothing: at the first refusal none is held"),
      reason: z.string().min(1).describe("What you are about to do, of any length: until you name your session, its row in the sessions list reads this, cut at a word to 40 characters"),
    }),
    async ({ capability, capabilities, increment, reason }, call) => {
      const id = capability ?? increment;
      if ([capability, capabilities, increment].filter((given) => given !== undefined).length !== 1) return { text: ONE_CLAIM, refused: true, data: { held: false } };
      if (capabilities !== undefined) {
        const all = await claimAll(claimContext(call), capabilities, reason);
        if (!all.ok) return { text: `${await refusalText(call.library, all.id, all.refusal)} You hold none of the ${capabilities.length} you asked for.`, refused: true, data: { held: false } };
        const names = await Promise.all(all.claims.map(({ claim: { capability: held, increment: on } }) => titleOf(call.library, (held ?? on)!)));
        return { text: `You hold ${names.join(", ")} now. Write each contract's failing test and report it red, make it pass and report it green, then land it.`, data: { held: true } };
      }
      if (id === undefined) return { text: ONE_CLAIM, refused: true, data: { held: false } };
      const answer = await claim(claimContext(call), id, reason);
      if (!answer.ok) return { text: await refusalText(call.library, id, answer), refused: true, data: { held: false } };
      const name = await titleOf(call.library, id);
      const taken = answer.takenOverFrom === undefined ? "" : ` You took it over from ${holderOf(answer.takenOverFrom)}, who had gone quiet.`;
      const next =
        increment === undefined
          ? "Write each contract's failing test and report it red, make it pass and report it green, then land it."
          : `It is active now. When it is done, close it with its outcome and ${landsByPullRequest(call.folder) ? "its pull request" : "a note naming the local commit it landed in"}.`;
      return { text: `You hold ${name} now.${taken} ${next}`, data: { held: true } };
    },
    AGENT,
  );

  define(
    "make_workspace",
    "Make a claimed Claude Code workspace, or prepare a Codex app workspace: check the work is free and fetch main. For Codex, pass the returned ref and name to the app's create_worktree, then call attach_workspace with its returned folder. Refused if held, waiting or already yours; pick other work. Refused too if an open pull request was already made for the work, naming it: carry that one on, or close it, or pass despite_open_pulls to build beside it. Refused too if a local branch made for the work has commits main does not, naming it and its worktree: carry it on, or delete it, or pass despite_local_branches to build beside it.",
    z.object({
      ...part,
      reason: z.string().min(1).describe("What you are about to do, of any length: until you name your session, its row in the sessions list reads this, cut at a word to 40 characters"),
      despite_open_pulls: z.boolean().optional().describe("Make it even though open pull requests were already made for this work; only once you have read them and know why"),
      despite_local_branches: z.boolean().optional().describe("Make it even though local branches made for this work have commits main does not; only once you have read them and know why"),
    }),
    async ({ capability, increment, reason, despite_open_pulls, despite_local_branches }, call) => {
      const id = capability ?? increment;
      if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true, data: { made: false } };
      const made = await makeWorkspace(claimContext(call), id, reason, {}, { despiteOpenPulls: despite_open_pulls === true, despiteLocalBranches: despite_local_branches === true });
      if (!made.ok) return { text: await workspaceRefusalText(call.library, id, made), refused: true, data: { made: false } };
      if (made.status === "prepared") {
        const { ref, name, base, status } = made;
        return {
          text: `Work is available; nothing is claimed yet. Call the Codex app's create_worktree with ${JSON.stringify({ ref, name })} (the exact commit from freshly fetched ${base}), then call attach_workspace for ${id} with its returned folder, this ref and name, and your reason. Use the returned directory explicitly: the app does not change your cwd or permissions. If it returns a worktree with a registration error, attach that directory; do not create another as a retry. If create_worktree is unavailable (a headless lane), make it yourself: git worktree add --detach <folder> ${ref}, then attach that folder the same way.`,
          data: { made: false, status, ref, name, base },
        };
      }
      if (made.existing) {
        return {
          text: `You hold ${await titleOf(call.library, id)} in the workspace you are in, ${made.folder}, on branch ${made.branch}: no worktree was made.`,
          data: { made: false, status: made.status, folder: made.folder, branch: made.branch, base: made.base },
        };
      }
      return {
        text: `Made a workspace at ${made.folder}, on branch ${made.branch} from ${made.base} as just fetched, and you hold ${await titleOf(call.library, id)} there. Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it${made.setup === undefined ? ", and set it up as this project does at session start (install its packages)." : `.\n${setupText(made.setup)}`}`,
        data: { made: true, status: made.status, folder: made.folder, branch: made.branch, base: made.base, ...(made.setup === undefined ? {} : { setup: made.setup }) },
      };
    },
    AGENT,
  );

  define(
    "attach_workspace",
    "Attach an app-made worktree and claim the work there. Codex: after make_workspace and the app's create_worktree, pass the returned folder, ref and name; it verifies the exact prepared commit and names a detached branch codex/<name>. Claude Code: attach the linked worktree this session is already in (folder defaults to the session's), claimed on the branch it is on; no ref or name. A refusal keeps the folder; do not recreate it.",
    z.object({
      ...part,
      reason: z.string().min(1),
      folder: z.string().min(1).optional().describe("Codex: the directory returned by the app's create_worktree. Claude Code: the linked worktree this session is in; defaults to the session's folder"),
      ref: z.string().min(1).optional().describe("Codex only: the exact commit returned by make_workspace and passed to create_worktree"),
      name: z.string().min(1).optional().describe("Codex only: the work-derived name returned by make_workspace"),
    }),
    async ({ capability, increment, reason, folder, ref, name }, call) => {
      const id = capability ?? increment;
      if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true, data: { attached: false } };
      const attached = await attachWorkspace(claimContext(call), id, reason, { folder: folder ?? call.folder, ...(ref === undefined ? {} : { ref }), ...(name === undefined ? {} : { name }) });
      if (!attached.ok) return { text: `${await workspaceRefusalText(call.library, id, attached)} The worktree is kept.`, refused: true, data: { attached: false } };
      return {
        text: `Attached ${attached.folder}, on branch ${attached.branch} at ${attached.base}; you hold ${await titleOf(call.library, id)} there. Use that directory explicitly for your commands${attached.setup === undefined ? " and set it up as this project does at session start (install its packages)." : `.\n${setupText(attached.setup)}`}`,
        data: { attached: true, folder: attached.folder, branch: attached.branch, base: attached.base, ...(attached.setup === undefined ? {} : { setup: attached.setup }) },
      };
    },
    AGENT,
  );

  define("release", "Release a capability or an increment you hold, without landing or closing it, so another session can take it.", z.object({ ...part, project: inProject }), async ({ capability, increment, project }, given) => {
    const id = capability ?? increment;
    if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true };
    const call = await projectCall(given, project);
    if (!("caller" in call)) return call;
    const answer = await release(claimContext(call), id);
    if (answer.ok) return { text: `You released ${await titleOf(call.library, id)}${answer.returned ? ": nobody holds it, so it is a proposal again" : ""}.` };
    return {
      text: answer.holder === undefined ? `You don't hold ${id}, and nobody else does.` : `You don't hold ${id}: ${holderOf(answer.holder)} does.`,
      refused: true,
    };
  }, AGENT);

  define(
    "stale_claims",
    "For the session manager: the claimed increments whose holder is quiet, with no command running and no open pull request, oldest first, each with its route (ADR-0953 D4). Release a gone or ended holder's with `storytree workspace release <increment> --holder <session> --reason …`; ask a quiet holder first. Reading it ends nothing.",
    z.object({ project: inProject }),
    async ({ project }, given) => {
      const call = await projectCall(given, project);
      if (!("caller" in call)) return call;
      const { claims, pullsUnread } = await staleClaims({ log: call.log, project: call.project, folder: call.folder, library: call.library }, {
        quietMs: call.quietMs,
        ...(merges.allOpenPulls === undefined ? {} : { allOpenPulls: merges.allOpenPulls }),
      });
      const unread = pullsUnread ? ["GitHub could not be asked which pull requests are open: check each branch before releasing."] : [];
      if (claims.length === 0) return { text: ["No claimed increment is stale.", ...unread].join("\n"), data: { claims, ...(pullsUnread ? { pullsUnread } : {}) } };
      const rows = await Promise.all(claims.map(async (stale) =>
        `- ${await titleOf(call.library, stale.increment)}: ${stale.label} session ${stale.holder} (${stale.reason}), last seen ${stale.lastSeenAt}${stale.branch === undefined ? "" : `, on ${stale.branch}`}. ${
          stale.route === "release" ? `${stale.closed ? "Closed: its increment is closed" : stale.ended ? "Ended: its process stopped and it stayed quiet since" : "Gone"}: release it for its holder (--holder ${stale.holder}).` : "Quiet: ask its holder, and release it only once it stays quiet."}`));
      return { text: [`${claims.length} claimed increment${claims.length === 1 ? " is" : "s are"} stale:`, ...rows, ...unread].join("\n"), data: { claims, ...(pullsUnread ? { pullsUnread } : {}) } };
    },
  );
}

function registerContextTool(define: Define, home: string | undefined): void {
  define(
    "read_context",
    "How many tokens your own context window holds right now, read from your session's transcript, and whether that is under, at or past your context guidance. Guidance is not an enforced limit.",
    z.object({}),
    async (_args, { log, project, caller }) => {
      const reading = await readContext(log, project, caller.session, home === undefined ? {} : { home });
      const text = "absent" in reading ? `No context reading for this session: ${reading.absent}.` : `Your context holds ${reading.tokens.toLocaleString("en-US")} tokens. ${guidanceSentence(reading.guidance)}`;
      return { text, data: { ...reading } };
    },
  );
}

function registerRunsTools(define: DefineForOwner, home: string | undefined): void {
  const ledger = home === undefined ? {} : { home };
  const resolved = (owner: RunOwner | undefined): RunOwner => {
    if (!owner || owner.agent === "unknown") throw new Error(NO_OWNER);
    return owner;
  };
  const shared = (locate: LocateOptions) => [appDatabaseWork(locateStorytree(locate).running)];
  for (const [name, scope] of [["list_own_runs", "self"], ["list_all_runs", "all"]] as const) {
    define(name, scope === "self" ? "List this caller’s recorded work, offline." : "List all recorded sessions on this computer, offline; grants no additional stop authority.",
      z.object({}).strict(), async (_args, { owner, locate }) => {
        const inventory = await listRuns({ ...ledger, scope, shared: shared(locate), ...(scope === "self" ? { owner: resolved(owner) } : {}),
          stopAction: run => ({ tool: "stop_own_run", arguments: { runs: [run] } }),
        });
        return { text: renderInventory(inventory), data: { inventory } };
      }, { anyCaller: scope === "all" });
  }
  define("stop_own_run", "Stop named registered run UUIDs within this caller’s ownership; report every outcome and retain records.",
    z.object({ runs: z.array(z.string()).min(1) }).strict(), async ({ runs }, { owner }) => {
      const stopped = await stopOwned({ ...ledger, owner: resolved(owner), targets: runs });
      return { text: JSON.stringify(stopped, null, 2), data: { result: stopped }, refused: !stopped.ok };
    });
  define("clear_own_runs", "Remove only the caller’s confirmed-gone run records, without signals; report removed, retained, failed and gaps separately, then read all remaining work.",
    z.object({}).strict(), async (_args, { owner, locate }) => {
      const caller = resolved(owner);
      const clear = await clearOwned({ ...ledger, owner: caller });
      const closing = await readClosing({ ...ledger, owner: caller, knownGaps: clear.gaps, shared: shared(locate) });
      return { text: `${JSON.stringify(clear, null, 2)}\n${renderClosing(closing)}`, data: { clear, closing },
        refused: clear.failed.length > 0 || clear.gaps.length > 0 };
    });
}

export const recordingGuidance: readonly string[] = [
  [
  "Record your work on the plan: `report` each contract's test red once it fails, green once it passes.",
  "- When its contracts pass, `land` the capability, ending your claim; it is held while a source file of the story's package is reached by no numbered test, and names each planned contract no numbered test proves (write its test, or retire it). Stopping before then, `release` it.",
  "- `mark_built` a capability once you consider it built; its card shows the health storytree verified.",
  "- Between increments, `read_context` gives your context's size: judge whether to take on more.",
  "- When the increment is done, `close_increment` with its outcome (landed, failed, withdrawn) and pull request, or a note naming the local commit.",
  "- When your session's work is done, `close_out`: say whether it is safe to close (pull requests merged or commits made, tree clean, nothing of yours running) and why. The sessions list checks a yes.",
  ].join("\n"),
];

export type ContractResult = "red" | "green";

export async function reportContract(
  library: Library,
  { contract, result, note }: { readonly contract: string; readonly result: ContractResult; readonly note?: string },
  caller: { readonly writer: WriteOptions; readonly session: string; readonly harness?: string },
): Promise<{ text: string; data: { reported: "failing" | "passing" } }> {
  await library.reportHealth(contract, result === "red" ? "failing" : "passing", {
    ...caller.writer,
    by: `${caller.harness ?? "agent"} ${caller.session}`,
    ...(note === undefined ? {} : { note }),
  });
  const { title, description } = ((await library.get(contract))?.fields ?? {}) as { title?: string; description?: string };
  const named = title === undefined ? contract : `"${title}" (${contract})`;
  const { verified } = await library.health(contract);
  const seen = verified.at === undefined || verified.state === "not-checked" ? "storytree's own run has not verified it yet" : `storytree's own run last verified it ${verified.state} at ${verified.at}`;
  const ask = description === undefined || description.trim() === "" ? ` ${named} has no description: say in one line what wrong fix its test catches, and save it as its description with edit_plan, or \`storytree library edit ${contract} --description …\`.` : "";
  return result === "red"
    ? { text: `Reported ${named} red: your report, and ${seen}. Run \`storytree health local\` in your shell so the plan shows a verified red, then make it pass and report it green.${ask}`, data: { reported: "failing" } }
    : { text: `Reported ${named} green: your report, a claim until storytree's own run confirms it (${seen}). Run \`storytree health local\` in your shell.${ask}`, data: { reported: "passing" } };
}

function registerLandingTools(define: Define, landing: Landing | undefined): void {
  define(
    "report",
    "Report a contract's test red (written, and failing) or green (passing). Storytree keeps what you report apart from what it verifies itself.",
    z.object({
      contract: z.string().min(1).describe("The id of the contract, as the plan shows it"),
      result: z.enum(["red", "green"]).describe("red: the test is written and fails; green: it passes"),
      note: z.string().min(1).optional().describe("Anything worth saying with it"),
    }),
    async ({ contract, result, note }, call) => reportContract(call.library, { contract, result, ...(note === undefined ? {} : { note }) }, { writer: call.writer, session: call.caller.session, ...(call.caller.harness === undefined ? {} : { harness: call.caller.harness }) }),

    { writes: true },
  );

  define(
    "land",
    "Report a capability landed: its work is finished. Your claim on it ends.",
    z.object({ capability: capabilityId }),
    async ({ capability }, call) => {
      const unplaced = (await landing?.unplaced(capability, call)) ?? [];
      if (unplaced.length > 0) {
        return {
          text: [`${await titleOf(call.library, capability)} is not landed: its story's package has ${unplaced.length === 1 ? "a source file" : `${unplaced.length} source files`} no numbered test reaches (ADR-0911 D4). Place each, then land again; your claim stays.`, ...unplaced.map((problem) => `- ${problem}`)].join("\n"),
          refused: true,
          data: { landed: false, unplaced },
        };
      }
      const { titles, seen, unreadable } = (await landing?.untested(capability, call).catch(() => undefined)) ?? { titles: [], seen: true };
      const untested = seen ? titles : [];
      const unchecked = seen ? [] : titles;
      const answer = await land(claimContext(call), capability);
      if (answer.ok) {
        const next = (await landing?.next(capability, call)) ?? [];
        const gaps = untested.length === 0 ? [] : [
          `No numbered test in its story's package proves ${untested.length === 1 ? "this planned contract" : `these ${untested.length} planned contracts`}: write each one's test ("N.M · …"), or retire the contract if it is no longer wanted.`,
          ...untested.map((title) => `- ${title}`),
        ];
        const unseen = unchecked.length === 0 ? [] : unreadable !== undefined ? [
          `storytree cannot read this project's code: it is in ${listed(unreadable.languages)}, and the map reads ${listed(unreadable.reads)}, so ${unchecked.length === 1 ? "this planned contract was" : `these ${unchecked.length} planned contracts were`} not checked against its tests.`,
          ...unchecked.map((title) => `- ${title}`),
        ] : [
          `This checkout cannot see the tests of its story: it holds no package of that story's (no code here yet, or a story imported from a folder of its own), so ${unchecked.length === 1 ? "this planned contract was" : `these ${unchecked.length} planned contracts were`} not checked against them.`,
          ...unchecked.map((title) => `- ${title}`),
        ];
        const proposed = (await capabilityNode(call.library, capability))?.proposed === true;
        const unbuilt = proposed ? [`Its card still reads proposed ("not built yet"): once you consider it built, call mark_built with capability ${capability}.`] : [];
        return {
          text: [`Landed ${await titleOf(call.library, capability)}. Your claim on it has ended.`, ...gaps, ...unseen, ...unbuilt, ...next.map((line) => `Next: ${line}`)].join("\n"),
          data: { landed: true, ...(proposed ? { proposed } : {}), ...(untested.length === 0 ? {} : { untested }), ...(unchecked.length === 0 ? {} : { unchecked }), ...(unchecked.length === 0 || unreadable === undefined ? {} : { unreadable: unreadable.languages }), ...(next.length === 0 ? {} : { next }) },
        };
      }
      return answer.refused === "held"
        ? { text: `${await titleOf(call.library, capability)} is held by ${holderOf(answer.holder)}; only its holder lands it.`, refused: true }
        : { text: `There is no capability ${capability} in this project's plan.`, refused: true };
    },
  );

  define(
    "present_question",
    "Mark an open question as being put to the owner by this session, before you ask him, so no other session asks him the same at once; another live session's mark refuses it, naming that session: skip it then. done: true when you move on without his answer. Settling it clears the mark.",
    z.object({ question: z.string().min(1).describe("The id of the question, as the plan shows it"), done: z.boolean().optional().describe("true to stop putting it to the owner") }),
    async ({ question, done }, call) => {
      const caller = claimContext(call);
      if (done === true) {
        const stopped = await stopPresenting(caller, question);
        return { text: stopped ? `${question} is no longer being put to the owner by this session.` : `This session was not putting ${question} to the owner.`, data: { id: question, presenting: false } };
      }
      const answer = await presentQuestion(caller, question);
      if (answer.ok) return { text: `${question} is being put to the owner by this session. Settling it with his answer clears that.`, data: { id: question, presenting: true, since: answer.since } };
      switch (answer.refused) {
        case "presenting":
          return { text: `${question} is being put to the owner by ${answer.presenter.label} session ${answer.presenter.session} since ${answer.presenter.since}: skip it, and do not ask him again.`, refused: true };
        case "settled":
          return { text: `${question} is settled: its answer stands.`, refused: true };
        case "unknown-question":
          return { text: `There is no question ${question} in this project.`, refused: true };
      }
    },
  );
}

export function claimContext({ log, library, project, caller, folder, quietMs, writer }: ToolCall): ClaimContext & { readonly folder: string } {
  const branch = currentBranch(folder);
  return { log, library, project, ...lineOf(caller), folder, quietMs, writer, ...(branch === undefined ? {} : { branch }) };
}

function landsByPullRequest(folder: string): boolean {
  try {
    return /github\.com[:/]/.test(runGit(["remote", "get-url", "origin"], { cwd: folder }));
  } catch {
    return false;
  }
}

export async function refusalText(library: Library, id: string, answer: Exclude<ClaimAnswer, { ok: true }>): Promise<string> {
  switch (answer.refused) {
    case "held":
      return `${await titleOf(library, id)} is held by ${holderOf(answer.holder, answer.heldFor)}. Pick other work: nobody queues${
        id.startsWith("capability_") ? `. To have your increment wait for it, wait on its claim (set_wait with on: ${id}), which clears the moment its holder releases it (ADR-1228)`
          : answer.heldFor.length === 0 ? "" : `; this is free once ${answer.heldFor[0]} closes`}.`;
    case "closed":
      return `${await titleOf(library, id)} is closed: there is nothing left to claim. Pick other work.`;
    case "waiting": {
      const waits = answer.waits.map((wait) =>
        wait.onOwner === true ? `${wait.increment} is waiting on the owner: it is held on their open question ${wait.on}`
          : wait.waitsFor !== undefined ? `${wait.increment} waits for ${wait.on}: ${wait.reason}${wait.checkBack === undefined ? "" : ` (check back ${wait.checkBack})`}`
          : `${wait.increment} waits on ${wait.on} (${wait.reason})${wait.forGood ? ", which will never release" : ""}`,
      );
      return `${await titleOf(library, id)} is waiting work: ${waits.join("; ")}. Pick other work until it releases.`;
    }
    case "unknown-capability":
      return `There is no capability or increment ${id} in this project's plan; plan it first, or find its id with show_plan.`;
  }
}

export async function closeRefusalText(context: ClaimContext, increment: string): Promise<string | undefined> {
  const refused = await closeRefusal(context, increment);
  if (refused === undefined) return undefined;
  return `${await titleOf(context.library, increment)} is held by ${holderOf(refused.holder, refused.heldFor)}, and only its holder closes it. Release what you still hold and end: its holder, the watcher or the owner closes it.`;
}

async function workspaceRefusalText(library: Library, id: string, answer: WorkspaceRefusal): Promise<string> {
  if (answer.refused === "yours") return `You already hold ${await titleOf(library, id)}${answer.claim.branch === undefined ? "" : `, on branch ${answer.claim.branch}`}: work there, or release it first.`;
  if (answer.refused === "no-workspace") return `Workspace setup refused: ${answer.why}.`;
  if ("listed" in answer) return `On ${await titleOf(library, id)}'s capabilities list, ${await refusalText(library, answer.listed, answer)}`;
  return refusalText(library, id, answer);
}

export function holderOf(claim: Claim, heldFor: readonly string[] = []): string {
  return `${claim.label} session ${claim.session}${heldFor.length === 0 ? "" : ` for ${heldFor.join(", ")}`} (${claim.reason})${claim.binds === undefined ? "" : `; binds: ${claim.binds}`}`;
}

async function capabilityNode(library: Library, id: string): Promise<{ readonly title: string; readonly proposed: boolean } | undefined> {
  for (const story of (await library.projectTree()).stories) {
    const found = story.capabilities.find((node) => node.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export async function titleOf(library: Library, id: string): Promise<string> {
  const found = await capabilityNode(library, id);
  if (found !== undefined) return `"${found.title}" (${id})`;
  const increment = (await increments(library)).find((one) => one.id === id);
  return increment === undefined ? id : `"${increment.fields.title}" (${id})`;
}
