/**
 * The setup check's two tools (capability 8): `check_setup`, which checks and fixes the setup on
 * the spot and says what the agent must do (ask the user, or fire a hook), and `set_up_project`,
 * which the agent calls only once the user has said yes. Unlike the other tools they work in a
 * folder that is not a project yet, and open storytree when it is closed.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findProject, setUpProject } from "../routing/index.js";
import { CHECK_FILE, FIX_SENTENCES, HOOK_TESTS, openStorytree, runSetupCheck, verifyHooks, type CommandInstall, type GhState, type SetupOptions } from "../setup/index.js";
import { isUnreachable, NOT_RUNNING_ANSWER, refusalOf, result } from "./answers.js";
import type { Connections } from "./connections.js";
import { lineOf, metaOf, seenCaller, type Caller } from "./server.js";
import { quoted } from "./text.js";

export interface SetupToolContext {
  readonly server: McpServer;
  readonly folder: string;
  readonly setup: Omit<SetupOptions, "folder">;
  readonly connections: Connections;
  readonly callerOf: (context: ServerContext) => Caller;
}

const HARNESS_NAMES = { "claude-code": "Claude Code", codex: "Codex" } as const;

/** What the check says about `gh` (ADR-0643 D3): nothing while it is signed in. */
const GH_SENTENCES: Readonly<Record<GhState, string[]>> = {
  "signed in": [],
  "signed out": ["GitHub's gh command is not signed in, so a claim will not end when its pull request merges: tell the user to run `gh auth login`."],
  missing: ["GitHub's gh command is not installed, so a claim will not end when its pull request merges: tell the user to install it from https://cli.github.com and run `gh auth login`."],
};

/** What the check says about the `storytree` command (ADR-0643 D1, 8): nothing once it is in place. */
function commandSentences(command: CommandInstall | undefined): string[] {
  switch (command) {
    case "installed":
      return ["storytree put its storytree command on the user's path."];
    case "another storytree kept":
      return ["There is already a storytree command of the user's own on their path, so storytree did not put its own there."];
    case "no folder of the user's on the path":
      return ["storytree found no folder of the user's own on their PATH to put its storytree command in (such as ~/.local/bin): the user can add one, and the next session puts it there."];
    default:
      return [];
  }
}

export function registerSetupTools({ server, folder, setup, connections, callerOf }: SetupToolContext): void {
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
      const data: Record<string, unknown> = { storytree: report.storytree.state, hooks: report.hooks ?? null, project: report.project };
      const unverified = { verified: false, missing: [...HOOK_TESTS], fixes: [] };
      if (report.storytree.state === "not running") {
        return result({ text: `${report.storytree.message}. Until it is running, carry on without it.`, data: { ...data, ...unverified } });
      }
      const said = [report.storytree.state === "opened" ? "storytree was closed, so it has been opened." : "storytree is running."];
      if (report.hooks === undefined) said.push("This tool server cannot register storytree's hooks: it was not started from an installed storytree.");
      else {
        const registered = (Object.keys(HARNESS_NAMES) as (keyof typeof HARNESS_NAMES)[]).filter((harness) => report.hooks?.[harness] === "registered");
        if (registered.length > 0) said.push(`storytree's hooks were registered for ${registered.map((harness) => HARNESS_NAMES[harness]).join(" and ")}.`);
        if (report.hooks.statusLine === "installed") said.push("storytree's status line was installed in Claude Code: it shows from the next session.");
        if (report.hooks.statusLine === "the user's own kept") said.push("The user has a Claude Code status line of their own, so storytree's was not installed: storytree never replaces it.");
      }
      said.push(...commandSentences(report.command), ...GH_SENTENCES[report.gh]);
      if (report.project.status === "ask") {
        said.push(
          `This folder isn't a storytree project yet. Ask the user whether to set storytree up here, as project ${quoted(report.project.suggestion)} or a name they choose (lower-case letters, digits and hyphens). Only if they say yes, call set_up_project with that name; without a yes, set nothing up and carry on.`,
        );
        return result({ text: said.join(" "), data: { ...data, ...unverified } });
      }
      said.push(`This folder is storytree project ${quoted(report.project.name)}.`);
      try {
        const { log } = await connections.reach(report.storytree.url, report.project.name);
        // The session as the hook before this call named it: after Claude Code's /clear, the new one.
        const caller = seenCaller((await log.since(report.project.name, 0)).lines, heard, metaOf(context));
        await log.append(report.project.name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "check_setup" });
        const { lines } = await log.since(report.project.name, 0);
        const verification = verifyHooks(lines, caller.session, caller.harness);
        if (verification.verified) {
          const checkFile = path.join(folder, CHECK_FILE);
          if (existsSync(checkFile)) rmSync(checkFile, { force: true });
          said.push("The connection is verified: storytree has received this session's start, a storytree tool call, a file edit and a command from its hooks.");
        } else {
          said.push(`Not verified yet: storytree has not received this session's ${verification.missing.join(", ")} from its hooks.`);
          said.push(...verification.fixes.map((fix) => FIX_SENTENCES[fix]), "Then call check_setup again.");
        }
        return result({ text: said.join(" "), data: { ...data, ...verification } });
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
        "Set this folder up as a storytree project, under the name the user chose. Call it only after the user has said yes: storytree never sets a folder up by itself.",
      inputSchema: z.object({ name: z.string().describe("The project's name: lower-case letters, digits and single hyphens") }),
    },
    (async ({ name }: { name: string }, context: ServerContext): Promise<CallToolResult> => {
      const caller = callerOf(context);
      const existing = findProject(folder);
      if (existing.project !== undefined) return result({ text: `This folder is already storytree project ${quoted(existing.project)}.`, data: { project: existing.project } });
      const running = await openStorytree({
        ...(setup.storytreeHome === undefined ? {} : { home: setup.storytreeHome }),
        ...(setup.openWaitMs === undefined ? {} : { waitMs: setup.openWaitMs }),
      });
      if (running.state === "not running") return result({ text: NOT_RUNNING_ANSWER });
      try {
        await setUpProject({ folder, project: name, storytree: await connections.server(running.url) });
        const { log } = await connections.reach(running.url, name);
        await log.append(name, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: "set_up_project" });
        return result({ text: `This folder is now storytree project ${quoted(name)}. Call check_setup to finish the setup.`, data: { project: name } });
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
