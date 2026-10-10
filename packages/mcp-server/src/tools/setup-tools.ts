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
import { findProject, storytreeHome } from "@storytree/session-management";
import { notAProjectYet, setUpProject, starterRolesIn, suggestProjectName } from "@storytree/app-setup/project";
import { checkFilesWritten, codexHooksState, FIX_SENTENCES, HOOK_TESTS, openStorytree, runSetupCheck, verifyHooks, type Fix, type SetupOptions } from "@storytree/app-setup/setup";
import { isUnreachable, NOT_RUNNING_ANSWER, refusalOf, result } from "./answers.js";
import type { Connections } from "./connections.js";
import { callLines, lineOf, seenCaller, type Caller } from "@storytree/session-management";
import { metaOf, type JourneyMilestones } from "./server.js";
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
      const report = await runSetupCheck({ ...setup, folder });
      // A note (an optional tool missing) reaches the agent neither in the text nor in the data, so it is
      // never taken as work to do; storytree doctor and the app's diagnostics still show it.
      const told = report.lines.filter((line) => line.state !== "note" && !(line.check === "gh" && line.state === "ok"));
      const data: Record<string, unknown> = { storytree: report.storytree.state, hooks: report.hooks ?? null, project: report.project, lines: told };
      const unverified = { verified: false, missing: [...HOOK_TESTS], fixes: [] };
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
        // The session as the hook before this call named it: after Claude Code's /clear, the new one.
        const caller = seenCaller(await callLines(log, report.project.name, metaOf(context)), heard, metaOf(context));
        await log.append(report.project.name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "check_setup" });
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
        return result({ text: withCard(said.join(" ")), data: { ...data, starterRoles, ...verification, hookFailures: failures } });
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
        const { library, log } = await connections.reach(running.library, name, undefined, { folder, home: setup.storytreeHome ?? storytreeHome() });
        await log.append(name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "set_up_project" });
        // The setup finishes here, with no second check_setup in this session (8.22): that check could verify none
        // of this session's hooks, which started before its folder was a project, and Codex's approval review
        // judges each call to it afresh, refusing one now and then.
        const starterRoles = await starterRolesIn(library);
        const fixes: Fix[] = [caller.harness === "codex" && codexHooksState(setup) === "waiting" ? "codex-approval" : "new-session"];
        const said = [`This folder is now storytree project ${quoted(name)}, and its setup is finished: carry on with the user's request, with no second check_setup in this session.`];
        if (starterRoles.length > 0) said.push(rolesSentence(starterRoles));
        said.push(fixes[0] === "codex-approval" ? FIX_SENTENCES["codex-approval"] : SET_UP_THIS_SESSION);
        return result({ text: withCard(said.join(" ")), data: { project: name, starterRoles, fixes } });
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
 * An answer in a project, followed by the whole habits card (7.7). Claude Code keeps only the first 2,048
 * characters of a server's instructions and Codex shows none, while every agent is told to call check_setup
 * first: its answer is where the whole card reaches them.
 */
function withCard(text: string): string {
  return `${text}\n\nHow to work with storytree in this project, whole (your harness may have shown you only the start of it):\n\n${habitsCard()}`;
}

/** What a session that set its project up is told of its hooks, which only a session started in the project can show. */
const SET_UP_THIS_SESSION =
  "A session's start reaches storytree only when the session starts in a storytree project, so storytree verifies the hooks in the next session here, and nothing is left unfinished in this one. Once its work is done, tell the user that a new session here checks them.";

/** The starter roles the project's library holds (1.14, 8.19), named for the agent to open. */
function rolesSentence(starterRoles: readonly string[]): string {
  return `Its library holds the ${starterRoles.join(" and ")} roles, which say how to work in this project: find each with search_notes and read it before you start, and work as it says.`;
}

/** What the check says of the hook failures this machine traced for the session: how many, and the latest. */
function failuresSentence(failures: readonly HookFailure[]): string {
  const latest = failures.at(-1)!;
  const count = failures.length === 1 ? "1 hook failure" : `${failures.length} hook failures`;
  return `This machine traced ${count} for this session; the latest, at ${latest.at}, ${latest.event ?? "a hook"}${latest.toolUseId === undefined ? "" : ` (${latest.toolUseId})`} failed ${{ reach: "to reach storytree", write: "to write its lines", observe: "to observe shell writes", hook: "to run" }[latest.stage]}: ${latest.error.class}: ${latest.error.message}.`;
}
