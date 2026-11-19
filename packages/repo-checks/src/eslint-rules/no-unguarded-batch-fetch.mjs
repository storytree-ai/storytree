// Capability 8 · Storytree's own test and gate entries.
import { FUNCTIONS } from "./assertions.mjs";
import { methodOf, unchained } from "./nodes.mjs";

const FETCHED = /\/jobs\/[^/]+\/logs(?![\w-])|\/artifacts(?![\w-])/;
const SKIP_KEYS = new Set(["parent", "loc", "range", "start", "end", "tokens", "comments", "leadingComments", "trailingComments"]);

function children(node, visit) {
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) if (typeof child?.type === "string") visit(child);
  }
}

function awaits(node, guarded, found) {
  if (FUNCTIONS.has(node.type)) return;
  if (node.type === "AwaitExpression") found(node, guarded);
  if (node.type === "TryStatement" && node.handler) {
    awaits(node.block, true, found);
    awaits(node.handler, guarded, found);
    if (node.finalizer) awaits(node.finalizer, guarded, found);
    return;
  }
  children(node, (child) => awaits(child, guarded, found));
}

function names(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked).join("*");
  return undefined;
}

function fetches(node) {
  if (FUNCTIONS.has(node.type)) return false;
  if (FETCHED.test(names(node) ?? "")) return true;
  let found = false;
  children(node, (child) => { found ||= fetches(child); });
  return found;
}

function unguardedIn(body, helpers, seen) {
  let found = false;
  awaits(body, false, (node, guarded) => { found ||= !guarded && unguarded(node.argument, helpers, seen); });
  return found;
}

function unguarded(expression, helpers, seen) {
  const call = unchained(expression);
  if (call?.type !== "CallExpression" || methodOf(call) === "catch") return false;
  if (call.arguments.some(fetches)) return true;
  const helper = call.callee.type === "Identifier" ? helpers.get(call.callee.name) : undefined;
  if (helper === undefined || seen.has(helper)) return false;
  return unguardedIn(helper.body, helpers, new Set([...seen, helper]));
}

function helpersOf(program) {
  const helpers = new Map();
  for (const top of program.body) {
    const statement = top.type === "ExportNamedDeclaration" || top.type === "ExportDefaultDeclaration" ? top.declaration : top;
    if (statement?.type === "FunctionDeclaration" && statement.id) helpers.set(statement.id.name, statement);
    if (statement?.type === "VariableDeclaration") {
      for (const { id, init } of statement.declarations) if (id.type === "Identifier" && FUNCTIONS.has(init?.type)) helpers.set(id.name, init);
    }
  }
  return helpers;
}

function batchCallback(call) {
  const callee = unchained(call.callee);
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier" || callee.object.name !== "Promise" || methodOf(call) !== "all") return undefined;
  const mapped = unchained(call.arguments[0]);
  if (mapped?.type !== "CallExpression" || methodOf(mapped) !== "map") return undefined;
  const callback = mapped.arguments[0];
  return FUNCTIONS.has(callback?.type) && callback.async ? callback : undefined;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unguarded: "awaits a job-log or artifacts fetch inside Promise.all(list.map(async ...)) that nothing catches, so one item GitHub no longer has (HTTP 404 or 410) rejects the whole batch (escape_9d756d18be61); catch the not-found read around the await or with .catch, and rethrow anything else",
    },
  },
  create(context) {
    let helpers;
    return {
      Program(program) {
        helpers = helpersOf(program);
      },
      CallExpression(node) {
        const callback = batchCallback(node);
        if (callback === undefined) return;
        awaits(callback.body, false, (inner, guarded) => {
          if (!guarded && unguarded(inner.argument, helpers, new Set())) context.report({ node: inner, messageId: "unguarded" });
        });
      },
    };
  },
};
