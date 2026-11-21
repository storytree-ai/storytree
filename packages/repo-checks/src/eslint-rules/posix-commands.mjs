// Capability 8 · Storytree's own test and gate entries.
import { children, literal, repoFile, unchained } from "./nodes.mjs";

const COMMANDS = new Set(["ps", "lsof", "pgrep", "pkill"]);
const SHELL_CALLS = new Set(["exec", "execSync"]);
const PLATFORM = /platform|win32|windows/i;
const BLOCKS = new Set(["Program", "BlockStatement", "StaticBlock"]);
const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;

const head = (node) => literal(node) ?? (node?.type === "TemplateLiteral" ? node.quasis[0].value.cooked : undefined);

const SHELLS = new Set(["sh", "bash", "/bin/sh", "/bin/bash"]);
const SEGMENT = /\|\||&&|[|;]/;

const firstOfSegments = (text) => text.split(SEGMENT).map((segment) => segment.trim().split(/\s/)[0]).find((word) => COMMANDS.has(word));

function scriptOf(call) {
  const args = call.arguments[1];
  if (args?.type !== "ArrayExpression") return undefined;
  const at = args.elements.findIndex((element) => literal(element) === "-c");
  return at < 0 ? undefined : head(args.elements[at + 1]);
}

function commandOf(call) {
  const text = head(call.arguments[0]);
  if (text === undefined) return undefined;
  if (COMMANDS.has(text)) return text;
  if (SHELLS.has(text)) {
    const script = scriptOf(call);
    return script === undefined ? undefined : firstOfSegments(script);
  }
  const callee = unchained(call.callee);
  const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
  return SHELL_CALLS.has(name) ? firstOfSegments(text) : undefined;
}

const not = (value) => value === undefined ? undefined : !value;

function onWindows(test) {
  if (test.type === "Identifier") return /win32|windows/i.test(test.name) ? true : undefined;
  if (test.type === "UnaryExpression" && test.operator === "!") return not(onWindows(test.argument));
  if (test.type === "LogicalExpression") {
    const [left, right] = [onWindows(test.left), onWindows(test.right)];
    if (test.operator === "&&") return left === false || right === false ? false : left && right ? true : undefined;
    if (test.operator === "||") return left === true || right === true ? true : left === false && right === false ? false : undefined;
    return undefined;
  }
  if (test.type === "BinaryExpression" && (test.operator === "===" || test.operator === "!==")) {
    const [side, value] = literal(test.right) !== undefined ? [test.left, literal(test.right)] : [test.right, literal(test.left)];
    if (value === undefined || !readsPlatform(side)) return undefined;
    return test.operator === "!==" ? value !== "win32" : value === "win32";
  }
  return undefined;
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
        if (statement.type === "IfStatement" && readsPlatform(statement.test) && onWindows(statement.test) !== false) return true;
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
    const file = repoFile(context);
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    return {
      CallExpression(node) {
        const command = commandOf(node);
        if (command !== undefined && !branched(node, context.sourceCode.getAncestors(node))) context.report({ node, messageId: "unbranched", data: { command } });
      },
    };
  },
};
