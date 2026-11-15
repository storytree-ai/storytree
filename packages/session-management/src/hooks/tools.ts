/**
 * Capability 3 · Hooks: the tool server's way to take a hook event (ADR-1056 D2), so a harness can deliver one with
 * no process started for it. It is a harness's tool, not the model's: the server registers it apart from the agent's
 * tools, records no call of it, and leaves it off the habits card. The extension's shape is restated rather than
 * imported, as quality assurance's is: no story may depend on the MCP server, which mounts this part from the
 * manifest (ADR-1021) and checks the two still fit (its test 6.75).
 */
import { z } from "zod";

import { route } from "@storytree/project-and-caller";

import { recordHookEvent, type ReachLog } from "./hooks.js";

/** What a harness's tool has for one call: the server's connections to storytree, and where it looks for storytree. */
interface HarnessCall {
  readonly reach: ReachLog;
  readonly locate: Parameters<typeof recordHookEvent>[3];
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
}

/** Registers one harness's tool: its name, what it is for, its arguments and what it does with them. */
type DefineForHarness = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: HarnessCall) => Promise<ToolAnswer>) => void;

/** Session management's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerHarnessTools?: (define: DefineForHarness) => void;
}

/** Session management's tool part, named in its manifest (ADR-1021): served in every folder, as the hooks are. */
export const hookToolParts = [(): ToolExtension => hookTools()];

/** The tools a harness hands a hook event to (contract 6.79), beats on (3.44) and takes a lane's messages from (3.60). */
export function hookTools(): ToolExtension {
  return {
    registerHarnessTools(define) {
      define("hook_event", "For harnesses, not the model: never call this yourself. A harness hands storytree one hook event here, its hook input as the command hook reads it, and storytree records it once, whichever way it came.", z.object({
        harness: z.string().min(1).describe("The harness the event is from, as its command hook names it: claude-code, codex, cursor, pi, antigravity or its own name"),
        input: z.record(z.string(), z.unknown()).describe("The hook's input, as the harness gives its command hook"),
      }), async ({ harness, input }, { reach, locate }) => {
        const { recorded, waiting } = await recordHookEvent(harness, input, reach, locate);
        // Codex reads a tool handler's text as a command hook's output, which may add it for the agent: it says nothing, as the command hook does.
        return { text: "", data: { recorded, waiting } };
      });
      define("heartbeat", "For harnesses, not the model: never call this yourself. A harness's own timer says here that its session is alive, or with ended that it ended, so storytree reads a session whose beats stopped as gone within about a minute.", z.object({
        session: z.string().min(1).describe("The harness's id for the session"),
        cwd: z.string().min(1).describe("The session's folder, which names its project"),
        ended: z.boolean().optional().describe("The session ended: its last word"),
        lane: z.boolean().optional().describe("The session is a pool lane's engine, which messages may be sent to"),
      }), async ({ session, cwd, ended, lane }, { reach, locate }) => {
        const where = route(cwd, locate);
        if (where.status !== "routed") return { text: "", data: { recorded: false } };
        try {
          await (await reach(where)).beats.beat(where.project, session, { ended: ended === true, lane: lane === true });
          return { text: "", data: { recorded: true } };
        } catch {
          // A missed beat waits for nothing: the next one, a few seconds on, says the same.
          return { text: "", data: { recorded: false } };
        }
      });
      define("lane_messages", "For harnesses, not the model: never call this yourself. A pool lane's mod takes the messages sent it while it runs: after a tool call (at: tool) the steers, and at its turn's end (at: stop) the follow-ups too, each once, answered as the one text to hand its model, or none.", z.object({
        session: z.string().min(1).describe("The harness's id for the lane's session"),
        cwd: z.string().min(1).describe("The session's folder, which names its project"),
        at: z.enum(["tool", "stop"]).describe("Where the lane is: at a tool call's end, or at its turn's end"),
        before: z.number().optional().describe("When the harness stops waiting for the answer, in ms since the epoch: nothing is taken that cannot be answered by then"),
      }), async ({ session, cwd, at, before }, { reach, locate }) => {
        const where = route(cwd, locate);
        if (where.status !== "routed") return { text: "" };
        try {
          const taken = await (await reach(where)).messages.take(where.project, session, at, before);
          const { deliveryText } = await import("../sessions/message-lane.js");
          return { text: deliveryText(taken) };
        } catch {
          // Nothing taken stays waiting for the lane's next tool call or turn's end.
          return { text: "" };
        }
      });
    },
  };
}
