/**
 * Capability 6 · Agent tools (the MCP server). The setup check's two tools (capability 8): `check_setup`, which checks and fixes the setup on
 * the spot and says what the agent must do (fire a hook), and `set_up_project`, which the agent
 * calls only when the user asks for storytree in this folder (ADR-0752 D2). Unlike the other tools they work in a
 * folder that is not a project yet, and open storytree when it is closed.
 */
import { rmSync } from "node:fs";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { habitsCard } from "../instructions/habits.js";
import { hookFailures, type HookFailure } from "@storytree/session-management";
import { MARKER_FILE } from "@storytree/project-and-caller";
import { findProject, storytreeHome } from "@storytree/project-and-caller";
import { IDENTITY_FIX, makeRepository, moveOntoFactory, notAProjectYet, setUpProject, starterPackStatus, starterRolesIn, suggestProjectName, takeStarterPack, type RepositoryMade, type StarterPackStatus } from "@storytree/app-setup/project";
import { checkFilesWritten, codexHooksState, FIX_SENTENCES, HOOK_TESTS, openStorytree, runSetupCheck, verifyHooks, type Fix, type SetupOptions } from "@storytree/app-setup/setup";
import { isUnreachable, NOT_RUNNING_ANSWER, refusalOf, result } from "./answers.js";
import type { Connections } from "./connections.js";
import { callLines, labelOf } from "@storytree/session-management";
import { lineOf, seenCaller, SESSION_ENV, tierOf, type Caller } from "@storytree/project-and-caller/caller";
import { metaOf, type Define, type JourneyMilestones } from "./server.js";
import { quoted } from "./text.js";

export interface SetupToolContext {
  readonly server: McpServer;
  readonly folder: string;
  readonly setup: Omit<SetupOptions, "folder">;
  readonly connections: Connections;
  readonly callerOf: (context: ServerContext) => Caller;
  readonly journey?: JourneyMilestones;
}

export function registerSetupTools({ server, folder, setup, connections, callerOf, journey }: SetupToolContext): void {
  server.registerTool(
    "check_setup",
    {
      description:
        "Check storytree's setup for this session, and fix what can be fixed on the spot: call it at the start of every session, and do what it says. It opens storytree if it is closed, registers storytree's hooks, says whether this folder is a storytree project, and verifies that this session's hooks reach storytree.",
      inputSchema: z.object({}),
    },
    (async (_args: unknown, context: ServerContext): Promise<CallToolResult> => {
      const heard = callerOf(context);
      // An MCP client storytree has no hooks for is connected: nothing of its hooks is asked for (6.64).
      const connected = tierOf(heard.harness) === "connected";
      const report = await runSetupCheck({ ...setup, folder, ...(connected ? { connected: labelOf(heard.harness) } : {}) });
      // A note (an optional tool missing) reaches the agent neither in the text nor in the data, so it is
      // never taken as work to do; storytree doctor and the app's diagnostics still show it.
      const told = report.lines.filter((line) => line.state !== "note" && !(line.check === "gh" && line.state === "ok"));
      const data: Record<string, unknown> = { storytree: report.storytree.state, hooks: report.hooks ?? null, project: report.project, lines: told, tier: connected ? "connected" : "watched" };
      const unverified = { verified: false, passed: false, missing: [...HOOK_TESTS], fixes: [] };
      const said = told
        .filter((line) => line.check !== "project")
        .map((line) => [line.message, line.fix].filter(Boolean).join(" "));
      if (report.storytree.state === "not running") {
        return result({ text: [...said, "Until storytree is running, carry on without it."].join(" "), data: { ...data, ...unverified } });
      }
      if (report.project.status === "ask") {
        // A name no project has yet (ADR-0757 D3); the folder's own when storytree cannot say.
        const name = await connections.server(report.storytree.library).then((storytree) => suggestProjectName(folder, storytree)).catch(() => undefined);
        said.push(notAProjectYet(folder, name));
        return result({ text: said.join(" "), data: { ...data, ...unverified } });
      }
      said.push(`This folder is storytree project ${quoted(report.project.name)}.`);
      try {
        const found = findProject(folder);
        const identity = found.project === undefined ? undefined : found.identity;
        const { library, log } = await connections.reach(report.storytree.library, report.project.name, identity, { folder: found.project === undefined ? folder : found.folder, home: setup.storytreeHome ?? storytreeHome() });
        // Seeded roles are read only when the agent is pointed at them (1.14, 8.19).
        const starterRoles = await starterRolesIn(library);
        if (starterRoles.length > 0) said.push(rolesSentence(starterRoles));
        // A library an earlier pack seeded is offered the newer one, for the user to take (8.26).
        const starterPack = await starterPackStatus(library);
        if (starterPack.offered) said.push(newerPackSentence(starterPack));
        // The session as the hook before this call named it: after Claude Code's /clear, the new one.
        const caller = seenCaller(await callLines(log, report.project.name, metaOf(context), { harness: heard.harness, tool: "check_setup" }), heard, metaOf(context));
        await log.append(report.project.name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "check_setup" });
        if (connected) {
          said.push(connectedSentence(caller));
          return result({ text: withCard(said.join(" ")), data: { ...data, starterRoles, starterPack, verified: false, passed: true, missing: [], fixes: [], session: caller.session } });
        }
        // This session's hook lines alone: the latest of each kind, and its edits for the check file (contract 2.7).
        const [fired, edits] = await Promise.all([
          log.lines(report.project.name, { sessions: [caller.session], where: { source: "hook" }, latestBy: ["kind"], omit: ["command", "files", "transcript"] }),
          log.lines(report.project.name, { sessions: [caller.session], kinds: ["file-edited"], where: { source: "hook" }, omit: ["transcript"] }),
        ]);
        const verification = verifyHooks(fired, caller.session, caller.harness, { ...report.machine, ...(report.codexHooks === undefined ? {} : { codexHooks: report.codexHooks }) });
        // The check file's work is done once its edit has arrived (8.20): it goes from where the agent wrote it.
        for (const file of checkFilesWritten(edits, caller.session)) {
          try {
            rmSync(file, { force: true });
          } catch {
            // Left for the agent: a file that cannot go never fails the check.
          }
        }
        if (verification.verified) {
          try { journey?.hooksVerified?.(); } catch { /* Observation cannot change a setup answer. */ }
          said.push("The connection is verified: storytree has received this session's start, a storytree tool call, a file edit and a command from its hooks.");
        } else {
          said.push(`Not verified yet: storytree has not received this session's ${verification.missing.join(", ")} from its hooks.`);
          said.push(...verification.fixes.map((fix) => FIX_SENTENCES[fix]), "Then call check_setup again.");
        }
        // What this machine's hooks traced of their failures for this session (contract 3.23), so a gap in its lines can be read.
        const failures = hookFailures(setup.storytreeHome ?? storytreeHome(), caller.session);
        if (failures.length > 0) said.push(failuresSentence(failures));
        return result({ text: withCard(said.join(" ")), data: { ...data, starterRoles, starterPack, ...verification, passed: verification.verified, hookFailures: failures } });
      } catch (error) {
        if (isUnreachable(error)) {
          await connections.close();
          return result({ text: NOT_RUNNING_ANSWER, data: { ...data, ...unverified } });
        }
        return result({ text: refusalOf(error), refused: true });
      }
    }) as never,
  );

  server.registerTool(
    "set_up_project",
    {
      description:
        "Set this folder up as a storytree project, under the name the user chose. Call it only when the user has asked for storytree in this folder: storytree never sets a folder up by itself.",
      inputSchema: z.object({
        name: z.string().describe("The project's name: lower-case letters, digits and single hyphens"),
        join: z.boolean().optional().describe("True only when the user asked to add this machine's checkout of their existing project `name` (a project already set up on another machine)"),
      }),
    },
    (async ({ name, join }: { name: string; join?: boolean }, context: ServerContext): Promise<CallToolResult> => {
      const caller = callerOf(context);
      const existing = findProject(folder);
      // Joining on purpose from the folder its marker names approves a trunk not approved yet (ADR-0942 D1).
      if (existing.project !== undefined && !(join === true && existing.project === name)) return result({ text: `This folder is already storytree project ${quoted(existing.project)}.`, data: { project: existing.project } });
      const running = await openStorytree({
        ...(setup.storytreeHome === undefined ? {} : { home: setup.storytreeHome }),
        ...(setup.openWaitMs === undefined ? {} : { waitMs: setup.openWaitMs }),
      });
      if (running.state === "not running") return result({ text: NOT_RUNNING_ANSWER });
      try {
        await setUpProject({
          folder, project: name, storytree: await connections.server(running.library), join: join === true,
          ...(setup.storytreeHome === undefined ? {} : { storytreeHome: setup.storytreeHome }),
        });
        if (join !== true) {
          try { journey?.projectCreated?.(); } catch { /* Observation cannot change a setup answer. */ }
        }
        // Review, landing and verified health read a repository (6.70); a joined checkout is the user's own clone.
        const repository = join === true ? undefined : makeRepository(folder);
        const { library, log } = await connections.reach(running.library, name, undefined, { folder, home: setup.storytreeHome ?? storytreeHome() });
        await log.append(name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "set_up_project" });
        // The setup finishes here, with no second check_setup in this session (8.22): that check could verify none
        // of this session's hooks, which started before its folder was a project, and Codex's approval review
        // judges each call to it afresh, refusing one now and then.
        const starterRoles = await starterRolesIn(library);
        const fixes: Fix[] = [caller.harness === "codex" && codexHooksState(setup) === "waiting" ? "codex-approval" : "new-session"];
        const said = [`This folder is now storytree project ${quoted(name)}, and its setup is finished: carry on with the user's request, with no second check_setup in this session.`];
        if (repository !== undefined && repository.state !== "already") said.push(repositorySentence(repository));
        if (starterRoles.length > 0) said.push(rolesSentence(starterRoles));
        said.push(fixes[0] === "codex-approval" ? FIX_SENTENCES["codex-approval"] : SET_UP_THIS_SESSION);
        return result({ text: withCard(said.join(" ")), data: { project: name, starterRoles, fixes, ...(repository === undefined ? {} : { repository }) } });
      } catch (error) {
        if (isUnreachable(error)) {
          await connections.close();
          return result({ text: NOT_RUNNING_ANSWER });
        }
        return result({ text: refusalOf(error), refused: true });
      }
    }) as never,
  );
}

/**
 * `take_starter_pack`, which the agent calls on the user's yes to check_setup's offer of a newer starter pack (8.26):
 * the pack is taken into the project's library without overwriting what its user edited (6.9). And `move_onto_factory`,
 * which the agent calls on the user's yes, moving a project made before factories onto theirs, its edits kept (6.12).
 */
export function registerStarterPackTool(define: Define): void {
  define(
    "take_starter_pack",
    "Take the newer starter pack into this project's library: call it only when check_setup offered it and the user said yes. It adds the records the library lacks and replaces only the ones the user has not edited; each edited one is left as it is and named, with the newer text beside it.",
    z.object({}),
    async (_args, { library }) => {
      const took = await takeStarterPack(library);
      const said = [`Took the starter pack: added ${took.added.length} and replaced ${took.replaced.length} of its records.`];
      if (took.kept.length > 0) {
        said.push(`Left as the user edited ${took.kept.length === 1 ? "it" : "them"}: ${took.kept.map(({ kind, title }) => `the ${kind} ${quoted(title)}`).join(", ")}. Show the user the newer text beside each (in this answer's data) and change one only if they ask.`);
      }
      return { text: said.join(" "), data: { ...took } };
    },
  );
  define(
    "move_onto_factory",
    "Move this project onto the user's factory, the project holding the system their projects build with (ADR-1040): call it only when the user said yes. Each copy of a role, note or check this project never edited, and the factory also holds, is dropped so the factory's shows through; every one the user edited or added stays this project's own. Moving again changes nothing.",
    z.object({}),
    async (_args, { storytree, project }) => {
      const moved = await moveOntoFactory({ storytree, project });
      const said = [`This project now builds with the factory "${moved.factory}": dropped ${moved.dropped.length} unedited ${moved.dropped.length === 1 ? "copy" : "copies"} of its system.`];
      if (moved.kept.length > 0) said.push(`Kept as this project's own: ${moved.kept.map(({ kind, title, why }) => `the ${kind} ${quoted(title)}${why === "own" ? "" : ` (${why})`}`).join(", ")}.`);
      return { text: said.join(" "), data: { ...moved } };
    },
  );
}

/** What the check says of a newer pack than the one that seeded the library (8.26). */
function newerPackSentence({ seeded, current }: StarterPackStatus): string {
  return `Its library was seeded by storytree's starter pack v${seeded}, and this storytree carries v${current}. Offer the user the newer pack: it adds what the library lacks and replaces only records they have not edited, leaving their edits as they are. Call take_starter_pack only if they say yes.`;
}

/**
 * An answer in a project, followed by the whole habits card (7.7). Claude Code keeps only the first 2,048
 * characters of a server's instructions and Codex shows none, while every agent is told to call check_setup
 * first: its answer is where the whole card reaches them.
 */
function withCard(text: string): string {
  return `${text}\n\nHow to work with storytree in this project, whole (your harness may have shown you only the start of it):\n\n${habitsCard()}`;
}

/**
 * What a connected session is told (6.64): the check passes, and what storytree does not do for it, since it
 * has no hooks there; and how its shell's commands act as the same session (6.65).
 */
function connectedSentence(caller: Caller): string {
  return `The setup check passes: this session is connected through ${labelOf(caller.harness)}, an MCP client storytree has no hooks for. ` +
    "Planning, claims, the library, questions and reviews all work through these tools and the storytree command; " +
    "storytree does not see this session's file edits or commands, cannot refuse an edit to a capability another session holds, has no context reading for it, and ships no transcript of it. " +
    `This session's id is ${caller.session}: run storytree commands in its shell with ${SESSION_ENV}=${caller.session} set, so they act as this session.`;
}

/**
 * What set_up_project says of the repository it made, or could not make, in a folder in none (6.70): review and
 * landing also need an origin remote, which publishes the user's code, so it is proposed, never made.
 */
function repositorySentence(made: Exclude<RepositoryMade, { state: "already" }>): string {
  const remote = "Review and landing also need an origin remote: propose a GitHub repository to the user (gh repo create, then git push), and make one only if they say yes.";
  if (made.state === "made") return `The folder was in no git repository, so storytree made it a git repository, with a first commit holding ${MARKER_FILE}. ${remote}`;
  if (made.state === "no identity") return `The folder was in no git repository, so storytree made it one with ${MARKER_FILE} staged, but git has no identity to make its first commit with (user.name and user.email), so its work cannot be reviewed or landed yet: ${IDENTITY_FIX}. ${remote}`;
  return `The folder is in no git repository, and storytree could not make one (${made.reason}), so its work cannot be reviewed or landed yet: tell the user, and once git can commit here, make it one (git init, then commit ${MARKER_FILE}). ${remote}`;
}

/** What a session that set its project up is told of its hooks, which only a session started in the project can show. */
const SET_UP_THIS_SESSION =
  "A session's start reaches storytree only when the session starts in a storytree project, so storytree verifies the hooks in the next session here, and nothing is left unfinished in this one. Once its work is done, tell the user that a new session here checks them.";

/** The starter roles the project's library holds (1.14, 8.19), named for the agent to open. */
function rolesSentence(starterRoles: readonly string[]): string {
  const named = starterRoles.length < 3 ? starterRoles.join(" and ") : `${starterRoles.slice(0, -1).join(", ")} and ${starterRoles.at(-1)}`;
  return `Its library holds the ${named} roles, which say how to work in this project: find each with search_notes and read it before you start, and work as it says when you take it up.`;
}

/** What the check says of the hook failures this machine traced for the session: how many, and the latest. */
function failuresSentence(failures: readonly HookFailure[]): string {
  const latest = failures.at(-1)!;
  const count = failures.length === 1 ? "1 hook failure" : `${failures.length} hook failures`;
  return `This machine traced ${count} for this session; the latest, at ${latest.at}, ${latest.event ?? "a hook"}${latest.toolUseId === undefined ? "" : ` (${latest.toolUseId})`} failed ${{ reach: "to reach storytree", write: "to write its lines", observe: "to observe shell writes", hook: "to run" }[latest.stage]}: ${latest.error.class}: ${latest.error.message}.`;
}
