// Capability 8 · Storytree's own test and gate entries.
import { FUNCTIONS, TEST_FILE } from "./assertions.mjs";
import { children, repoFile } from "./nodes.mjs";

function walk(node, visit, intoFunctions = true) {
  visit(node);
  for (const child of children(node)) if (intoFunctions || !FUNCTIONS.has(child.type)) walk(child, visit, intoFunctions);
}

function bindsPlatform(pattern) {
  switch (pattern?.type) {
    case "Identifier": return pattern.name === "platform";
    case "AssignmentPattern": return bindsPlatform(pattern.left);
    case "ObjectPattern": return pattern.properties.some((property) => bindsPlatform(property.type === "RestElement" ? property.argument : property.value));
    case "ArrayPattern": return pattern.elements.some(bindsPlatform);
    case "RestElement": return bindsPlatform(pattern.argument);
    case "TSParameterProperty": return bindsPlatform(pattern.parameter);
    default: return false;
  }
}

function givenPlatform(fn) {
  if (fn.params.some(bindsPlatform)) return true;
  let found = false;
  walk(fn.body, (node) => { found ||= node.type === "VariableDeclarator" && bindsPlatform(node.id); }, false);
  return found;
}

const isRead = (node) => node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" &&
  node.object.name === "process" && node.property.name === "platform";

function isDefault(read) {
  for (let node = read, up = read.parent; up && !FUNCTIONS.has(node.type); node = up, up = up.parent) {
    if (up.type === "AssignmentPattern" && up.right === node && bindsPlatform(up.left)) return true;
    if (up.type === "VariableDeclarator" && up.init === node && bindsPlatform(up.id)) return true;
  }
  return false;
}

const nameOf = (fn) => fn.type === "FunctionDeclaration" ? fn.id?.name
  : fn.parent?.type === "VariableDeclarator" && fn.parent.id.type === "Identifier" ? fn.parent.id.name : undefined;

function enclosing(node) {
  const out = [];
  for (let up = node.parent; up; up = up.parent) if (FUNCTIONS.has(up.type)) out.push(up);
  return out;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      hostPlatform: "reads process.platform inside {{given}}, or a helper it calls, though {{given}} was given a platform to act for, " +
        "so the code branches on the host's platform where it should branch on the given one (escape_23c591a68875): " +
        "pass the given platform down instead",
    },
  },
  create(context) {
    if (TEST_FILE.test(repoFile(context))) return {};
    return {
      "Program:exit"(program) {
        const functions = [];
        const reads = [];
        walk(program, (node) => {
          if (FUNCTIONS.has(node.type)) functions.push(node);
          if (isRead(node) && !isDefault(node)) reads.push(node);
        });
        const topLevel = new Map();
        for (const fn of functions) if (nameOf(fn) !== undefined && enclosing(fn).length === 0) topLevel.set(nameOf(fn), fn);
        const reported = new Set();
        const report = (read, given) => {
          if (reported.has(read)) return;
          reported.add(read);
          context.report({ node: read, messageId: "hostPlatform", data: { given: nameOf(given) ?? "a function" } });
        };
        for (const read of reads) {
          const given = enclosing(read).find(givenPlatform);
          if (given) report(read, given);
        }
        for (const given of functions.filter(givenPlatform)) {
          walk(given.body, (node) => {
            if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
            const helper = topLevel.get(node.callee.name);
            if (helper === undefined || helper === given || givenPlatform(helper)) return;
            for (const read of reads) if (enclosing(read).includes(helper)) report(read, given);
          });
        }
      },
    };
  },
};
