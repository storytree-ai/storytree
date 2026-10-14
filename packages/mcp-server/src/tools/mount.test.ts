/**
 * Capability 6 · Agent tools (the MCP server). A verb mounted as a tool answers with the steps it offers next,
 * named as tools, in its text and its data (ADR-0786 D2, question_c7a7d394adf9). The verb is a fixture: no
 * library or log is reached, since the mount only words the verb's answer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { z } from "zod";

import type { Verb } from "@storytree/project-and-caller/verbs";

import { mountTools } from "./mount.js";
import type { Answer, Call, Define } from "./server.js";

test("6.54 a mounted verb's next steps are named as tools, below its sentence and in its data; a step with no tool is named as its command; an answer with none adds nothing", async () => {
  const offers: Verb = {
    command: { family: "thing", name: "show", summary: "show a thing" },
    tool: { name: "show_thing", description: "Show a thing." },
    inputs: { id: { kind: "text", describe: "the thing" }, bare: { kind: "switch", describe: "no next steps" } },
    async act({ id, bare }) {
      return bare
        ? { text: `Thing ${id}.` }
        : { text: `Thing ${id}.`, data: { id }, next: [{ tool: "open", command: "library read <id>", why: "read it whole" }, { command: "session list --all", why: "the hidden sessions too" }] };
    },
  };
  const served = new Map<string, (args: Record<string, unknown>, call: Call) => Promise<Answer>>();
  const define = ((name, _description, _input, act) => served.set(name, act as never)) as Define;
  mountTools(define, [offers]);
  const call = { caller: { session: "s1" }, folder: process.cwd() } as unknown as Call;

  const answer = await served.get("show_thing")!({ id: "t1" }, call);
  assert.equal(answer.text, "Thing t1.\n\nnext:\n  - open                           (read it whole)\n  - storytree session list --all   (the hidden sessions too)");
  assert.deepEqual(answer.data, { id: "t1", next: [{ step: "open", why: "read it whole" }, { step: "storytree session list --all", why: "the hidden sessions too" }] });

  const bare = await served.get("show_thing")!({ id: "t1", bare: true }, call);
  assert.equal(bare.text, "Thing t1.");
  assert.equal(bare.data, undefined);
});

test("6.76 a mounted verb's optional text input may be left out of its tool call, and the verb reads it as nothing; a required one may not", async () => {
  const prunes: Verb = {
    command: { family: "tree", name: "prune", summary: "prune a tree" },
    tool: { name: "prune_tree", description: "Prune a tree." },
    inputs: { id: { kind: "text", describe: "the tree" }, to: { kind: "text", optional: true, describe: "the height to prune it to" } },
    async act({ id, to }) {
      return { text: `Pruned ${id} to ${to ?? "nothing named"}.` };
    },
  };
  const served = new Map<string, { input: z.ZodObject; act: (args: Record<string, unknown>, call: Call) => Promise<Answer> }>();
  const define = ((name, _description, input, act) => served.set(name, { input, act: act as never })) as Define;
  mountTools(define, [prunes]);
  const call = { caller: { session: "s1" }, folder: process.cwd() } as unknown as Call;
  const tool = served.get("prune_tree")!;

  const left = tool.input.safeParse({ id: "t1" });
  assert.equal(left.success, true);
  assert.equal((await tool.act(left.data!, call)).text, "Pruned t1 to nothing named.");
  assert.equal((await tool.act(tool.input.parse({ id: "t1", to: "2m" }), call)).text, "Pruned t1 to 2m.");
  assert.equal(tool.input.safeParse({ to: "2m" }).success, false);
});
