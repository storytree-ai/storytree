// Capability 8 · Storytree's own test and gate entries.
import { FUNCTIONS, some } from "./assertions.mjs";
import { children, methodOf, repoFile, unchained } from "./nodes.mjs";

const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;

const calledName = (call) => {
  const callee = unchained(call.callee);
  if (callee?.type === "Identifier") return callee.name;
  return callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
};

const nameOf = (fn) => fn.type === "FunctionDeclaration" ? fn.id?.name
  : fn.parent?.type === "VariableDeclarator" && fn.parent.id.type === "Identifier" ? fn.parent.id.name : undefined;

const isKey = (node) => (node.parent?.type === "MemberExpression" && !node.parent.computed && node.parent.property === node) ||
  (node.parent?.type === "Property" && !node.parent.computed && node.parent.key === node);

const uses = (node, name) => {
  const found = (inner) => inner.type === "Identifier" && inner.name === name && !isKey(inner);
  return found(node) || some(node, true, found);
};

function walk(node, visit) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function callsByName(node, name) {
  let found = false;
  walk(node, (inner) => { found ||= inner.type === "CallExpression" && unchained(inner.callee)?.type === "Identifier" && unchained(inner.callee).name === name; });
  return found;
}

function errorCalls(body, name, report) {
  if (name === undefined) return;
  const names = new Set([name]);
  const declared = [];
  walk(body, (inner) => {
    if (inner.type === "VariableDeclarator" && inner.id.type === "Identifier" && inner.init && ["const", "let"].includes(inner.parent?.kind)) declared.push(inner);
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const { id, init } of declared) if (!names.has(id.name) && [...names].some((each) => uses(init, each))) {
      names.add(id.name);
      grew = true;
    }
  }
  walk(body, (inner) => {
    if (inner.type === "CallExpression" && methodOf(inner) === "error" && inner.arguments.some((argument) => [...names].some((each) => uses(argument, each)))) report(inner);
  });
}

const handlerName = (handler) => FUNCTIONS.has(handler?.type) && handler.params[0]?.type === "Identifier" ? handler.params[0].name : undefined;

function catches(node, report, helpers) {
  if (node.type === "CatchClause" && node.param?.type === "Identifier") errorCalls(node.body, node.param.name, report);
  if (node.type !== "CallExpression") return;
  const handler = methodOf(node) === "catch" ? node.arguments[0] : methodOf(node) === "then" ? node.arguments[1] : undefined;
  const handlers = handler?.type === "Identifier" ? helpers.get(handler.name) ?? [] : [handler];
  for (const fn of handlers) if (handlerName(fn) !== undefined) errorCalls(fn.body, handlerName(fn), report);
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      everyTick: "logs a caught failure on every tick of a polling loop (a setInterval callback, a re-arming setTimeout or a function either calls), " +
        "so a library outage floods the log with the same error and its stack (escape_221a8ba4aaf6): say the failure through outageSaidOnce " +
        "(@storytree/library/connection-error), which says an outage once until the library answers again and any other failure in full",
    },
  },
  create(context) {
    const file = repoFile(context);
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    const helpers = new Map();
    const timers = [];
    const named = (fn) => {
      const name = nameOf(fn);
      if (name !== undefined) helpers.set(name, [...helpers.get(name) ?? [], fn]);
    };
    return {
      FunctionDeclaration: named,
      FunctionExpression: named,
      ArrowFunctionExpression: named,
      CallExpression(node) {
        const name = calledName(node);
        if (name === "setInterval" || name === "setTimeout") timers.push({ node, name, ancestors: context.sourceCode.getAncestors(node) });
      },
      "Program:exit"() {
        const roots = [];
        for (const { node, name, ancestors } of timers) {
          const first = node.arguments[0];
          const callback = first?.type === "Identifier" ? helpers.get(first.name) ?? [] : FUNCTIONS.has(first?.type) ? [first] : [];
          if (name === "setInterval") roots.push(...callback);
          else if (callback.some((fn) => ancestors.some((outer) => FUNCTIONS.has(outer.type) && nameOf(outer) !== undefined && callsByName(fn, nameOf(outer))))) roots.push(...callback);
        }
        const reached = new Set();
        const reach = (fn) => {
          if (reached.has(fn)) return;
          reached.add(fn);
          walk(fn, (inner) => {
            if (inner.type === "CallExpression" && unchained(inner.callee)?.type === "Identifier") for (const helper of helpers.get(unchained(inner.callee).name) ?? []) reach(helper);
          });
        };
        for (const root of roots) reach(root);
        const reported = new Set();
        const report = (call) => {
          if (reported.has(call)) return;
          reported.add(call);
          context.report({ node: call, messageId: "everyTick" });
        };
        for (const fn of reached) walk(fn, (inner) => catches(inner, report, helpers));
      },
    };
  },
};
