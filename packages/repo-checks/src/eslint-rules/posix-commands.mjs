// Capability 8 · Storytree's own test and gate entries.
import path from "node:path";

import { literal, unchained } from "./nodes.mjs";

const COMMANDS = new Set(["ps", "lsof", "pgrep", "pkill"]);
const SHELL_CALLS = new Set(["exec", "execSync"]);
const PLATFORM = /platform|win32|windows/i;
const BLOCKS = new Set(["Program", "BlockStatement", "StaticBlock"]);
const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;

const head = (node) => literal(node) ?? (node?.type === "TemplateLiteral" ? node.quasis[0].value.cooked : undefined);

function commandOf(call) {
  const text = head(call.arguments[0]);
  if (text === undefined) return undefined;
  if (COMMANDS.has(text)) return text;
  const callee = unchained(call.callee);
  const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
  if (!SHELL_CALLS.has(name)) return undefined;
  const first = text.trimStart().split(/\s/)[0];
  return COMMANDS.has(first) ? first : undefined;
}

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === "object" && typeof child.type === "string") out.push(child);
    }
  }
  return out;
}

function readsPlatform(test) {
  if (test.type === "Identifier") return PLATFORM.test(test.name);
  if (test.type === "Literal") return typeof test.value === "string" && PLATFORM.test(test.value);
  if (test.type === "MemberExpression" && !test.computed && PLATFORM.test(test.property.name)) return true;
  return children(test).some(readsPlatform);
}

function branched(node, ancestors) {
  let inner = node;
  for (let at = ancestors.length - 1; at >= 0; at--) {
    const outer = ancestors[at];
    if ((outer.type === "IfStatement" || outer.type === "ConditionalExpression") && inner !== outer.test && readsPlatform(outer.test)) return true;
    if (outer.type === "LogicalExpression" && readsPlatform(inner === outer.left ? outer.right : outer.left)) return true;
    const body = BLOCKS.has(outer.type) ? outer.body : outer.type === "SwitchCase" ? outer.consequent : undefined;
    if (body !== undefined) {
      for (const statement of body) {
        if (statement === inner) break;
        if (statement.type === "IfStatement" && readsPlatform(statement.test)) return true;
      }
    }
    inner = outer;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unbranched: 'runs "{{command}}" with no process.platform branch around it, so it throws on Windows (escape_3d876fe9f3df): ' +
        "branch on process.platform to its Windows equivalent, or, where only a POSIX machine runs it (the Mint box, a caller that branches already), " +
        "put // eslint-disable-next-line storytree/posix-commands -- <why> on the line before it",
    },
  },
  create(context) {
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    return {
      CallExpression(node) {
        const command = commandOf(node);
        if (command !== undefined && !branched(node, context.sourceCode.getAncestors(node))) context.report({ node, messageId: "unbranched", data: { command } });
      },
    };
  },
};
