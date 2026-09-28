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
import { CHECK_FILE, FIX_SENTENCES, HOOK_TESTS, openStorytree, runSetupCheck, verifyHooks, type SetupOptions } from "../setup/index.js";
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
      const data: Record<string, unknown> = { storytree: report.storytree.state, hooks: report.hooks ?? null, project: report.project, lines: report.lines };
      const unverified = { verified: false, missing: [...HOOK_TESTS], fixes: [] };
      const said = report.lines
        .filter((line) => line.check !== "project" && !(line.check === "gh" && line.state === "ok"))
        .map((line) => [line.message, line.fix].filter(Boolean).join(" "));
      if (report.storytree.state === "not running") {
        return result({ text: [...said, "Until storytree is running, carry on without it."].join(" "), data: { ...data, ...unverified } });
      }
      if (report.project.status === "ask") {
        said.push(
          `This folder isn't a storytree project yet. Ask the user whether to set storytree up here, as project ${quoted(report.project.suggestion)} or a name they choose (lower-case letters, digits and hyphens). Only if they say yes, call set_up_project with that name; without a yes, set nothing up and carry on.`,
        );
        return result({ text: said.join(" "), data: { ...data, ...unverified } });
      }
      said.push(`This folder is storytree project ${quoted(report.project.name)}.`);
      try {
        const { log } = await connections.reach(report.storytree.library, report.project.name);
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
        await setUpProject({
          folder, project: name, storytree: await connections.server(running.library),
          ...(setup.storytreeHome === undefined ? {} : { storytreeHome: setup.storytreeHome }),
        });
        const { log } = await connections.reach(running.library, name);
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
