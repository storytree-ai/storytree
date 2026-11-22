// Capability 12 · Setup tools
import { rmSync } from "node:fs";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { habitsCard } from "../instructions/habits.js";
import { hookFailures, type HookFailure } from "@storytree/session-management";
import { findProject, storytreeHome } from "@storytree/project-and-caller";
import { missingProjectReading } from "@storytree/project-and-caller/routing";
import { MAPPED_CODE_GUIDANCE } from "@storytree/map";
import { folderLanguages } from "@storytree/map/folder-languages";
import { unreadableOf, unreadableSentence } from "@storytree/map/languages";
import { COMMIT_STORYTREE, IDENTITY_FIX, makeRepository, notAProjectYet, setUpProject, smallFixesArc, smallFixesSentence, starterPackStatus, starterRolesIn, suggestProjectName, unimportedPackages, unimportedSentence, type RepositoryMade, type StarterPackStatus } from "@storytree/app-setup/project";
import { checkFile, checkFilesWritten, codexHooksState, factoryWay, FIX_SENTENCES, fixSentence, HOOK_TESTS, openStorytree, runSetupCheck, verifyHooks, type FactoryWay, type Fix, type SetupOptions } from "@storytree/app-setup/setup";
import { isUnreachable, NOT_RUNNING_ANSWER, refusalOf, result } from "./answers.js";
import type { Connections } from "./connections.js";
import { callLines, labelOf } from "@storytree/session-management";
import { HARNESS_IDS, lineOf, seenCaller, SESSION_ENV, tierOf, type Caller } from "@storytree/project-and-caller/caller";
import { metaOf, type JourneyMilestones } from "./server.js";
import { quoted } from "./text.js";

export type SetupToolOptions = Omit<SetupOptions, "folder"> & { readonly factory?: string };

export interface SetupToolContext {
  readonly server: McpServer;
  readonly folder: string;
  readonly setup: SetupToolOptions;
  readonly connections: Connections;
  readonly callerOf: (context: ServerContext) => Caller;
  readonly journey?: JourneyMilestones;
  readonly card?: string;
  readonly served: () => readonly string[];
}

export function registerSetupTools({ server, folder, setup, connections, callerOf, journey, card = habitsCard(), served }: SetupToolContext): void {
  const withCard = (text: string, beside?: string): string => cardAfter(text, card, beside);
  server.registerTool(
    "check_setup",
    {
      description:
        "Check storytree's setup for this session, and fix what can be fixed on the spot: call it at the start of every session, and do what it says. It opens storytree if it is closed, registers storytree's hooks, says whether this folder is a storytree project, and verifies that this session's hooks reach storytree.",
      inputSchema: z.object({}),
    },
    (async (_args: unknown, context: ServerContext): Promise<CallToolResult> => {
      const heard = callerOf(context);
      const connected = tierOf(heard.harness) === "connected";
      const asking = heard.harness === "claude-code" ? "claude" : heard.harness === "codex" ? "codex" : undefined;
      const calling = HARNESS_IDS.find((harness) => harness === heard.harness);
      const report = await runSetupCheck({ ...setup, folder, ...(connected ? { connected: labelOf(heard.harness) } : {}), ...(asking === undefined ? {} : { asking }), ...(calling === undefined ? {} : { calling }) });
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
        const name = await connections.server(report.storytree.library).then((storytree) => suggestProjectName(folder, storytree)).catch(() => undefined);
        said.push(notAProjectYet(folder, name));
        return result({ text: said.join(" "), data: { ...data, ...unverified } });
      }
      if (report.project.status === "missing") {
        said.push(missingProjectReading(report.project.name), `Tell the user, and call set_up_project only after the user says yes: it sets this folder up here as a new project, replacing its marker, under ${quoted(report.project.name)} or a name they choose. If ${quoted(report.project.name)} is in another library they can reach, this computer's library setting can point there instead, and the folder joins it.`);
        return result({ text: said.join(" "), data: { ...data, ...unverified } });
      }
      said.push(`This folder is storytree project ${quoted(report.project.name)}.`);
      try {
        const found = findProject(folder);
        const identity = found.project === undefined ? undefined : found.identity;
        const { library, log, storytree } = await connections.reach(report.storytree.library, report.project.name, identity, { folder: found.project === undefined ? folder : found.folder, home: setup.storytreeHome ?? storytreeHome() });
        const way = await factoryWay(library, storytree);
        const starterRoles = await starterRolesIn(library);
        if (way !== undefined) said.push(factoryWaySentence(way));
        else if (starterRoles.length > 0) said.push(rolesSentence(starterRoles));
        const fromFactory = { sessionRole: way?.sessionRole?.title ?? null, agents: way?.agents ?? [] };
        const starterPack = await starterPackStatus(library, storytree);
        if (starterPack.offered && served().includes("take_starter_pack")) said.push(newerPackSentence(starterPack));
        const declared = await unimportedPackages(folder, library);
        const unimported = declared.map((one) => one.title);
        if (declared.length > 0) said.push(`${unimportedSentence(declared)} Call import_project with this project's folder before you plan stories: each package it declares becomes an imported story, and plan_story refuses until it is imported.`);
        const smallFixes = (await smallFixesArc(library))?.id;
        if (smallFixes !== undefined) said.push(smallFixesSentence(smallFixes));
        const beside = (await library.list("story")).some((story) => story.fields.mapped !== undefined) ? MAPPED_CODE_GUIDANCE : undefined;
        const caller = seenCaller(await callLines(log, report.project.name, metaOf(context), { harness: heard.harness, tool: "check_setup" }), heard, metaOf(context));
        await log.append(report.project.name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "check_setup" });
        if (connected) {
          said.push(connectedSentence(caller));
          return result({ text: withCard(said.join(" "), beside), data: { ...data, starterRoles, ...fromFactory, starterPack, unimported, smallFixesArc: smallFixes ?? null, verified: false, passed: true, missing: [], fixes: [], session: caller.session } });
        }
        const [fired, edits] = await Promise.all([
          log.lines(report.project.name, { sessions: [caller.session], where: { source: "hook" }, latestBy: ["kind"], omit: ["command", "files", "transcript"] }),
          log.lines(report.project.name, { sessions: [caller.session], kinds: ["file-edited"], where: { source: "hook" }, omit: ["transcript"] }),
        ]);
        const verification = verifyHooks(fired, caller.session, caller.harness, { ...report.machine, ...(report.codexHooks === undefined ? {} : { codexHooks: report.codexHooks }) });
        for (const file of checkFilesWritten(edits, caller.session)) {
          try {
            rmSync(file, { force: true });
          } catch {
          }
        }
        if (verification.verified) {
          try { journey?.hooksVerified?.(); } catch {}
          said.push("The connection is verified: storytree has received this session's start, a storytree tool call, a file edit and a command from its hooks.");
        } else {
          said.push(`Not verified yet: storytree has not received this session's ${verification.missing.join(", ")} from its hooks.`);
          said.push(...verification.fixes.map((fix) => fixSentence(fix, caller.session)), "Then call check_setup again.");
        }
        const failures = hookFailures(setup.storytreeHome ?? storytreeHome(), caller.session);
        if (failures.length > 0) said.push(failuresSentence(failures));
        return result({ text: withCard(said.join(" "), beside), data: { ...data, starterRoles, ...fromFactory, starterPack, unimported, smallFixesArc: smallFixes ?? null, ...verification, ...(verification.fixes.includes("edit-check-file") ? { checkFile: checkFile(caller.session) } : {}), passed: verification.verified, hookFailures: failures } });
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
      const already = { text: `This folder is already storytree project ${quoted(existing.project ?? "")}.`, data: { project: existing.project } };
      const settled = existing.project !== undefined && !(join === true && existing.project === name);
      const running = await openStorytree({
        ...(setup.storytreeHome === undefined ? {} : { home: setup.storytreeHome }),
        ...(setup.openWaitMs === undefined ? {} : { waitMs: setup.openWaitMs }),
      });
      if (running.state === "not running") return result(settled ? already : { text: NOT_RUNNING_ANSWER });
      try {
        if (settled && (await (await connections.server(running.library)).listProjects()).includes(existing.project!)) return result(already);
        const { replaced, smallFixesArc: smallFixes } = await setUpProject({
          folder, project: name, storytree: await connections.server(running.library), join: join === true,
          ...(setup.storytreeHome === undefined ? {} : { storytreeHome: setup.storytreeHome }),
          ...(setup.factory === undefined ? {} : { factory: setup.factory }),
        });
        if (join !== true) {
          try { journey?.projectCreated?.(); } catch {}
        }
        const repository = join === true ? undefined : makeRepository(folder);
        const { library, log } = await connections.reach(running.library, name, undefined, { folder, home: setup.storytreeHome ?? storytreeHome() });
        await log.append(name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "set_up_project" });
        const starterRoles = await starterRolesIn(library);
        const fixes: Fix[] = [caller.harness === "codex" && codexHooksState(setup) === "waiting" ? "codex-approval" : "new-session"];
        const said = [`This folder is now storytree project ${quoted(name)}, and its setup is finished: carry on with the user's request, with no second check_setup in this session.`];
        if (replaced !== undefined) said.push(`Its marker, which named project ${quoted(replaced)} this computer's library does not have, was replaced.`);
        if (join !== true) said.push(LIBRARY_KEPT);
        if (repository !== undefined && repository.state !== "already") said.push(repositorySentence(repository));
        if (repository?.state !== "made" && repository?.state !== "no identity") said.push(COMMIT_STORYTREE);
        if (starterRoles.length > 0) said.push(rolesSentence(starterRoles));
        if (smallFixes !== undefined) said.push(smallFixesSentence(smallFixes));
        const unreadable = unreadableOf(await folderLanguages(folder).catch(() => undefined));
        if (unreadable !== undefined) said.push(unreadableSentence(unreadable));
        said.push(fixes[0] === "codex-approval" ? FIX_SENTENCES["codex-approval"] : SET_UP_THIS_SESSION);
        return result({ text: withCard(said.join(" ")), data: { project: name, starterRoles, fixes, smallFixesArc: smallFixes ?? null, ...(repository === undefined ? {} : { repository }), ...(unreadable === undefined ? {} : { unreadable }), ...(replaced === undefined ? {} : { replaced }) } });
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

function newerPackSentence({ seeded, current, factory }: StarterPackStatus): string {
  const seededLibrary = factory === undefined ? "Its library was" : `The factory ${quoted(factory)}, which this project reads its system from, was`;
  return `${seededLibrary} seeded by storytree's starter pack v${seeded}, and this storytree carries v${current}. Offer the user the newer pack: it adds what the library lacks and replaces only records they have not edited, leaving their edits as they are. Call take_starter_pack only if they say yes.`;
}

function cardAfter(text: string, card: string, beside?: string): string {
  return [text, `How to work with storytree in this project, whole (your harness may have shown you only the start of it):`, card, ...(beside === undefined ? [] : [beside]), ASKED_WHAT_IT_KEEPS].join("\n\n");
}

const ASKED_WHAT_IT_KEEPS =
  "When the user asks how storytree works or what it keeps, explain their library (their plan, notes, friction and session transcripts, kept for them and not sent to storytree) and point them at the README's sections \"What your library keeps\" and \"Your friction stays yours\".";

function connectedSentence(caller: Caller): string {
  return `The setup check passes: this session is connected through ${labelOf(caller.harness)}, an MCP client storytree has no hooks for. ` +
    "Planning, claims, the library, questions and reviews all work through these tools and the storytree command; " +
    "storytree does not see this session's file edits or commands, cannot refuse an edit to a capability another session holds, has no context reading for it, and ships no transcript of it. " +
    `This session's id is ${caller.session}: run storytree commands in its shell with ${SESSION_ENV}=${caller.session} set, so they act as this session.`;
}

function repositorySentence(made: Exclude<RepositoryMade, { state: "already" }>): string {
  const remote = "It needs no remote: a review reads a change against the local main branch and land needs none, and verified health, which a remote's CI would give, comes from a local run of this project's own tests instead: `storytree health local` in this folder runs its test command (pytest -rA for a Python project) and credits each numbered test to its contract, so the map shows its verified health. Work locally: review each change on git diff, land it as a local commit, run `storytree health local`, and close the increment with a note giving the commit's sha.";
  if (made.state === "made") return `The folder was in no git repository, so storytree made it a git repository, with a first commit holding its .storytree folder. ${remote}`;
  if (made.state === "no identity") return `The folder was in no git repository, so storytree made it one with its .storytree folder staged, but git has no identity to make its first commit with (user.name and user.email), so its work cannot be reviewed or landed yet: ${IDENTITY_FIX}. ${remote}`;
  return `The folder is in no git repository, and storytree could not make one (${made.reason}), so its work cannot be reviewed or landed yet: tell the user, and once git can commit here, make it one (git init, then commit the .storytree folder). ${remote}`;
}

const LIBRARY_KEPT =
  "Tell the user once, plainly, that storytree has set up a library for this project, which captures a lot: its plan, the decisions and notes you write, the friction you record, and every session's transcript (obvious secrets scrubbed, best-effort; raw records kept 180 days), on their computer or the library their settings name, and that none of it is sent to storytree.";

const SET_UP_THIS_SESSION =
  "A session's start reaches storytree only when the session starts in a storytree project, so storytree verifies the hooks in the next session here, and nothing is left unfinished in this one. Once its work is done, tell the user that a new session here checks them.";

function rolesSentence(starterRoles: readonly string[]): string {
  const named = starterRoles.length < 3 ? starterRoles.join(" and ") : `${starterRoles.slice(0, -1).join(", ")} and ${starterRoles.at(-1)}`;
  return `Its library holds the ${named} roles, which say how to work in this project: find each with search_notes and read it before you start, and work as it says when you take it up.`;
}

function factoryWaySentence({ factory, sessionRole, agents }: FactoryWay): string {
  const named = agents.length < 3 ? agents.join(" and ") : `${agents.slice(0, -1).join(", ")} and ${agents.at(-1)}`;
  const agentsSaid = agents.length === 0 ? "" : ` Its agents are the ${named} roles: when you hand work to one, brief a fresh-context subagent (or a new session of your harness here) to work as that role, which it opens with search_notes.`;
  if (sessionRole === undefined) return `This project is built with the factory ${quoted(factory)}, and works its way.${agentsSaid}`;
  return `This project is built with the factory ${quoted(factory)}, and works its way: the factory's session role below is your instructions, and where it differs from the card that follows, it wins.${agentsSaid}\n\n${sessionRole.text}\n\n`;
}

function failuresSentence(failures: readonly HookFailure[]): string {
  const latest = failures.at(-1)!;
  const count = failures.length === 1 ? "1 hook failure" : `${failures.length} hook failures`;
  return `This machine traced ${count} for this session; the latest, at ${latest.at}, ${latest.event ?? "a hook"}${latest.toolUseId === undefined ? "" : ` (${latest.toolUseId})`} failed ${{ reach: "to reach storytree", write: "to write its lines", observe: "to observe shell writes", hook: "to run" }[latest.stage]}: ${latest.error.class}: ${latest.error.message}.`;
}
