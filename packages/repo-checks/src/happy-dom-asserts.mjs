// Capability 8 · Storytree's own test and gate entries. A failing assert.equal, strictEqual or deepEqual whose operand
// is a happy-dom node makes Node describe the node, which never finishes: about 29 GB a run, and five box-wide
// out-of-memory kills on the Mint box on 2026-11-04 (friction_edc7a93a10fe, a recurrence of friction_e4786f8de376).
// A rule authors must remember failed twice, so `pnpm lint` (lint.mjs) refuses the form in every test file that
// imports happy-dom, in `pnpm gate` and in CI. The test's way out is to compare by identity, assert.ok(a === b, message),
// or to compare a string or number read from the node.
//
// It reads the code alone (Babel's parser, no types), so it refuses an operand that may be a node by its shape: a DOM
// query's result (querySelector, getElementById, closest, …), a property only a node has (firstElementChild,
// parentElement, …), a new Window, a property of one of those that holds a node (body, children, target, …), an
// array or object holding one, or a name, destructured name, loop variable or callback parameter bound to one, a
// parameter typed as a node, or the result of a local function that returns one, followed through names, destructuring,
// members and the object a local function returns (a page() factory's helpers). Strings, numbers and booleans read
// from a node (textContent, dataset values, .length, a comparison) are never refused.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

const FAMILY = new Set(["equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "partialDeepStrictEqual"]);
/** Methods that return a node or a collection of nodes, whatever they are called on. */
const QUERIES = new Set([
  "querySelector", "querySelectorAll", "getElementById", "getElementsByClassName", "getElementsByTagName", "getElementsByTagNameNS",
  "getElementsByName", "closest", "createElement", "createElementNS", "createTextNode", "createComment", "createDocumentFragment",
  "elementFromPoint", "elementsFromPoint", "cloneNode", "importNode", "adoptNode", "attachShadow", "getRootNode", "appendChild",
  "insertBefore", "replaceChild", "removeChild",
]);
/** Properties only a node, a document or a window has, each holding a node. */
const NODE_PROPS = new Set([
  "activeElement", "documentElement", "firstChild", "firstElementChild", "lastChild", "lastElementChild", "parentElement", "parentNode",
  "nextSibling", "nextElementSibling", "previousSibling", "previousElementSibling", "childNodes", "ownerDocument", "shadowRoot",
  "selectedOptions", "contentDocument", "contentWindow", "defaultView", "offsetParent", "ownerElement", "assignedSlot",
  "scrollingElement", "fullscreenElement", "pointerLockElement", "srcElement",
]);
/** Properties that hold a node, or an object that holds one, when they are read from a node, a document, a window or an event. */
const HELD_PROPS = new Set([
  "body", "head", "document", "window", "children", "target", "currentTarget", "relatedTarget", "form", "options", "elements",
  "host", "labels", "style", "classList", "attributes", "content", "control", "list", "cells", "rows", "tBodies", "sheet",
]);
/** Array methods whose result holds the elements of what they are called on. */
const KEEPS = new Set(["filter", "find", "findLast", "at", "slice", "sort", "toSorted", "reverse", "toReversed", "concat", "flat", "item", "values", "pop", "shift"]);
/** Array methods whose callback's first parameter is an element of what they are called on. */
const VISITS = new Set(["forEach", "map", "filter", "find", "findLast", "findIndex", "findLastIndex", "some", "every", "flatMap"]);
/** Type names that are DOM nodes, windows, collections or events, when the file neither imports nor declares them otherwise. */
const DOM_TYPE = /^(?:Node|Element|HTML\w*Element|SVG\w*Element|Document|DocumentFragment|ShadowRoot|Window|BrowserWindow|NodeList|NodeListOf|HTMLCollection|HTMLCollectionOf|Text|Comment|Attr|EventTarget|\w*Event|CSSStyleDeclaration|DOMTokenList|NamedNodeMap)$/;
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const HAPPY_DOM = /^(?:happy-dom|@happy-dom\/[\w-]+)(?:\/|$)/;

/** One sentence per assert.equal-family call on what may be a happy-dom node, in the test files under `root` that import happy-dom. */
export function happyDomAssertProblems(root) {
  const problems = [];
  for (const file of testFiles(root)) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (!text.includes("happy-dom")) continue;
    problems.push(...problemsIn(file, text));
  }
  return problems.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function testFiles(root, dir = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...testFiles(root, rel));
    else if (TEST_FILE.test(entry.name)) files.push(rel);
  }
  return files;
}

function problemsIn(file, text) {
  let ast;
  try {
    ast = parse(text, {
      sourceType: "unambiguous", errorRecovery: true, createImportExpressions: true,
      plugins: ["decorators-legacy", ...(/\.[cm]?tsx?$/.test(file) ? ["typescript"] : []), ...(/\.[jt]sx$/.test(file) ? ["jsx"] : [])],
    });
  } catch {
    return [];
  }
  const parents = new WeakMap();
  const nodes = [];
  walk(ast.program, undefined, parents, nodes);
  const { imports, importedNames } = importsOf(ast.program);
  if (![...imports.values()].some((source) => HAPPY_DOM.test(source))) return [];
  const reader = domReader({ parents, nodes, imports });
  const problems = [];
  for (const node of nodes) {
    if (node.type !== "CallExpression" || !isAssertion(node.callee, imports, importedNames)) continue;
    const operand = node.arguments.slice(0, 2).find((argument) => reader.isDom(argument));
    if (operand === undefined) continue;
    const shown = text.slice(operand.start, operand.end).replace(/\s+/g, " ");
    problems.push(`${file}:${node.loc.start.line} ${text.slice(node.callee.start, node.callee.end)} compares ${shown.length > 60 ? `${shown.slice(0, 57)}...` : shown}, which may be a happy-dom node: a failure makes Node describe it without bound (about 29 GB, friction_edc7a93a10fe); compare by identity with assert.ok(a === b, message), or compare a string or number read from it`);
  }
  return problems;
}

function walk(node, parent, parents, nodes) {
  parents.set(node, parent);
  nodes.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key) || value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === "object" && typeof child.type === "string") walk(child, node, parents, nodes);
    }
  }
}

/** Each name the file imports, mapped to the module it comes from, and each named import to the name it has there. */
function importsOf(program) {
  const imports = new Map();
  const importedNames = new Map();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      imports.set(specifier.local.name, statement.source.value);
      if (specifier.type === "ImportSpecifier") importedNames.set(specifier.local.name, specifier.imported.name ?? specifier.imported.value);
    }
  }
  return { imports, importedNames };
}

function isAssertModule(source) {
  return source === "assert" || source === "assert/strict" || source === "node:assert" || source === "node:assert/strict";
}

function isAssertion(callee, imports, importedNames) {
  if (callee.type === "Identifier") return FAMILY.has(importedNames.get(callee.name) ?? "") && isAssertModule(imports.get(callee.name) ?? "");
  if (callee.type !== "MemberExpression" || callee.computed || !FAMILY.has(callee.property.name)) return false;
  const object = callee.object;
  if (object.type === "Identifier") return object.name === "assert" || isAssertModule(imports.get(object.name) ?? "");
  return object.type === "MemberExpression" && !object.computed && object.property.name === "assert";
}

function domReader({ parents, nodes, imports }) {
  const declared = new Set(nodes.flatMap((node) => (/^(?:TSInterfaceDeclaration|TSTypeAliasDeclaration|TSEnumDeclaration|ClassDeclaration)$/.test(node.type) && node.id ? [node.id.name] : [])));
  const fromHappyDom = (name) => HAPPY_DOM.test(imports.get(name) ?? "");
  const domTypeName = (name) => fromHappyDom(name) || (DOM_TYPE.test(name) && !imports.has(name) && !declared.has(name));
  const assignments = nodes.filter((node) => node.type === "AssignmentExpression" && node.left.type === "Identifier");
  const seen = new Set();
  const following = new Set();

  function isDomType(type) {
    if (type === null || type === undefined) return false;
    switch (type.type) {
      case "TSTypeAnnotation": return isDomType(type.typeAnnotation);
      case "TSTypeReference":
        return (type.typeName.type === "Identifier" && domTypeName(type.typeName.name)) || (type.typeParameters?.params ?? type.typeArguments?.params ?? []).some(isDomType);
      case "TSArrayType": return isDomType(type.elementType);
      case "TSUnionType": case "TSIntersectionType": return type.types.some(isDomType);
      case "TSTupleType": return type.elementTypes.some((element) => isDomType(element.type === "TSNamedTupleMember" ? element.elementType : element));
      case "TSTypeOperator": case "TSOptionalType": case "TSRestType": return isDomType(type.typeAnnotation);
      case "TSTypeLiteral": return type.members.some((member) => isDomType(member.typeAnnotation));
      default: return false;
    }
  }

  /** Whether the value of `node`, an expression, may be or hold a node. */
  function isDom(node) {
    if (node === null || node === undefined || seen.has(node)) return false;
    seen.add(node);
    try {
      return domExpression(node);
    } finally {
      seen.delete(node);
    }
  }

  function domExpression(node) {
    switch (node.type) {
      case "TSNonNullExpression": case "ParenthesizedExpression": case "TSSatisfiesExpression": case "AwaitExpression":
        return isDom(node.expression ?? node.argument);
      case "TSAsExpression": case "TSTypeAssertion":
        return isDomType(node.typeAnnotation) || isDom(node.expression);
      case "NewExpression":
        return (node.callee.type === "Identifier" && (node.callee.name === "Window" || fromHappyDom(node.callee.name))) || (isMember(node.callee) && isDom(node.callee.object));
      case "CallExpression": case "OptionalCallExpression":
        return callIsDom(node);
      case "MemberExpression": case "OptionalMemberExpression": {
        const name = propertyName(node);
        if (name !== undefined && NODE_PROPS.has(name)) return true;
        if (name !== undefined && !HELD_PROPS.has(name)) return false;
        return isDom(node.object);
      }
      case "Identifier":
        return identifierIsDom(node);
      case "ArrayExpression":
        return node.elements.some((element) => element !== null && isDom(element.type === "SpreadElement" ? element.argument : element));
      case "ObjectExpression":
        return node.properties.some((property) => (property.type === "SpreadElement" ? isDom(property.argument) : property.type === "ObjectProperty" && isDom(property.value)));
      case "ConditionalExpression":
        return isDom(node.consequent) || isDom(node.alternate);
      case "LogicalExpression":
        return isDom(node.left) || isDom(node.right);
      case "SequenceExpression":
        return isDom(node.expressions.at(-1));
      case "AssignmentExpression":
        return isDom(node.right);
      default:
        return false;
    }
  }

  function callIsDom(node) {
    const callee = node.callee;
    if (isMember(callee)) {
      const name = propertyName(callee);
      if (name !== undefined && QUERIES.has(name)) return true;
      if (name !== undefined && KEEPS.has(name)) return isDom(callee.object);
      if (name === "from" && callee.object.type === "Identifier" && callee.object.name === "Array") return node.arguments.length === 1 && isDom(node.arguments[0]);
    }
    const fn = functionOf(callee);
    return fn !== undefined && returnsDom(fn);
  }

  /**
   * The local function `node` evaluates to, when the code says which: one written in place or declared, or one bound to a
   * name or held in an object's property, followed through names, destructuring and the object a local function returns.
   */
  function functionOf(node) {
    if (node === null || node === undefined || following.has(node)) return undefined;
    following.add(node);
    try {
      if (FUNCTIONS.has(node.type)) return node;
      switch (node.type) {
        case "TSNonNullExpression": case "ParenthesizedExpression": case "TSAsExpression": case "TSSatisfiesExpression": case "TSTypeAssertion":
          return functionOf(node.expression);
        case "Identifier": {
          const binding = resolve(node);
          if (binding?.kind === "function") return binding.fn;
          if (binding?.kind !== "var") return undefined;
          return functionOf(binding.pattern === binding.id ? binding.declarator.init : readOf(binding.declarator.init, binding.pattern, binding.id));
        }
        case "MemberExpression": case "OptionalMemberExpression": {
          const name = propertyName(node);
          return name === undefined ? undefined : functionOf(propertyValue(node.object, name));
        }
        default:
          return undefined;
      }
    } finally {
      following.delete(node);
    }
  }

  /** The expression the property `name` of `object` holds, when the code says which: an object written in place, named, or returned by a local function. */
  function propertyValue(object, name) {
    if (object === null || object === undefined || following.has(object)) return undefined;
    following.add(object);
    try {
      switch (object.type) {
        case "TSNonNullExpression": case "ParenthesizedExpression": case "TSAsExpression": case "TSSatisfiesExpression": case "TSTypeAssertion": case "AwaitExpression":
          return propertyValue(object.expression ?? object.argument, name);
        case "ObjectExpression":
        {
          const property = object.properties.findLast((candidate) => (candidate.type === "ObjectProperty" || (candidate.type === "ObjectMethod" && candidate.kind === "method")) && !candidate.computed && (candidate.key.name ?? candidate.key.value) === name);
          return property?.type === "ObjectProperty" ? property.value : property;
        }
        case "Identifier": {
          const binding = resolve(object);
          if (binding?.kind !== "var") return undefined;
          return propertyValue(binding.pattern === binding.id ? binding.declarator.init : readOf(binding.declarator.init, binding.pattern, binding.id), name);
        }
        case "MemberExpression": case "OptionalMemberExpression": {
          const key = propertyName(object);
          return key === undefined ? undefined : propertyValue(propertyValue(object.object, key), name);
        }
        case "CallExpression": case "OptionalCallExpression": {
          const fn = functionOf(object.callee);
          if (fn === undefined) return undefined;
          if (fn.body.type !== "BlockStatement") return propertyValue(fn.body, name);
          for (const node of nodes) {
            if (node.type !== "ReturnStatement" || node.argument === null || enclosingFunction(node) !== fn) continue;
            const value = propertyValue(node.argument, name);
            if (value !== undefined) return value;
          }
          return undefined;
        }
        default:
          return undefined;
      }
    } finally {
      following.delete(object);
    }
  }

  function returnsDom(fn) {
    if (seen.has(fn)) return false;
    seen.add(fn);
    try {
      if (isDomType(fn.returnType)) return true;
      if (fn.body.type !== "BlockStatement") return isDom(fn.body);
      return nodes.some((node) => node.type === "ReturnStatement" && node.argument !== null && enclosingFunction(node) === fn && isDom(node.argument));
    } finally {
      seen.delete(fn);
    }
  }

  function enclosingFunction(node) {
    for (let at = parents.get(node); at !== undefined; at = parents.get(at)) if (FUNCTIONS.has(at.type)) return at;
    return undefined;
  }

  function identifierIsDom(node) {
    const binding = resolve(node);
    if (binding === undefined) return node.name === "document" || node.name === "window";
    if (binding.kind === "var") {
      const { declarator, pattern, id } = binding;
      if (isDomType(id.typeAnnotation)) return true;
      const reassigned = assignments.some((assignment) => assignment.left.name === node.name && resolve(assignment.left)?.declarator === declarator && isDom(assignment.right));
      if (reassigned) return true;
      if (pattern === id) return declarator.init !== null && !FUNCTIONS.has(declarator.init?.type) && isDom(declarator.init);
      return destructuredIsDom(declarator.init, pattern, id);
    }
    if (binding.kind === "param") {
      const { fn, pattern, id } = binding;
      if (isDomType(id.typeAnnotation) || (pattern.type === "AssignmentPattern" && isDom(pattern.right))) return true;
      const call = parents.get(fn);
      if (pattern !== fn.params[0] || call?.type !== "CallExpression" && call?.type !== "OptionalCallExpression" || call.arguments[0] !== fn || !isMember(call.callee)) return false;
      return VISITS.has(propertyName(call.callee)) && isDom(call.callee.object);
    }
    if (binding.kind === "loop") return isDom(binding.right);
    return false;
  }

  /** A name destructured from `init`: a node when the pattern reads it from a property holding one, or from an array of nodes. */
  function destructuredIsDom(init, pattern, id) {
    if (init === null || init === undefined) return false;
    if (pattern.type === "ArrayPattern") return isDom(init);
    const step = pattern.type === "ObjectPattern" ? propertyRead(init, pattern, id) : undefined;
    if (step === undefined) return false;
    return step.inner === id ? isDom(step.read) : destructuredIsDom(step.read, step.inner, id);
  }

  /** The read of `init` an object pattern makes for the name `id`, when it reads it only through properties: `init.a.b` for `{ a: { b } }`. */
  function readOf(init, pattern, id) {
    if (init === null || init === undefined || pattern.type !== "ObjectPattern") return undefined;
    const step = propertyRead(init, pattern, id);
    if (step === undefined) return undefined;
    return step.inner === id ? step.read : readOf(step.read, step.inner, id);
  }

  /** One level of an object pattern: the property of `init` that holds `id`, read as a member, and the pattern it is bound by there. */
  function propertyRead(init, pattern, id) {
    const property = pattern.properties.find((candidate) => candidate.type === "ObjectProperty" && contains(candidate.value, id));
    if (property === undefined || property.computed) return undefined;
    const read = { type: "MemberExpression", object: init, property: { type: "Identifier", name: property.key.name ?? property.key.value }, computed: false };
    return { read, inner: property.value.type === "AssignmentPattern" ? property.value.left : property.value };
  }

  function contains(pattern, id) {
    if (pattern === id) return true;
    switch (pattern?.type) {
      case "ObjectPattern": return pattern.properties.some((property) => contains(property.type === "RestElement" ? property.argument : property.value, id));
      case "ArrayPattern": return pattern.elements.some((element) => element !== null && contains(element, id));
      case "AssignmentPattern": return contains(pattern.left, id);
      case "RestElement": return contains(pattern.argument, id);
      default: return false;
    }
  }

  /** The declaration the identifier `node` reads, by walking out through its enclosing blocks and functions. */
  function resolve(node) {
    const name = node.name;
    for (let at = parents.get(node); at !== undefined; at = parents.get(at)) {
      const found = declaredIn(at, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function declaredIn(scope, name) {
    if (FUNCTIONS.has(scope.type)) {
      for (const param of scope.params) {
        const id = bound(param, name);
        if (id !== undefined) return { kind: "param", fn: scope, pattern: param, id };
      }
      if (scope.type === "FunctionExpression" && scope.id?.name === name) return { kind: "function", fn: scope };
      return undefined;
    }
    if (scope.type === "ForOfStatement" || scope.type === "ForInStatement") {
      const id = scope.left.type === "VariableDeclaration" ? bound(scope.left.declarations[0].id, name) : undefined;
      if (id === undefined) return undefined;
      return scope.type === "ForOfStatement" && id === scope.left.declarations[0].id ? { kind: "loop", right: scope.right } : { kind: "other" };
    }
    if (scope.type === "ForStatement" && scope.init?.type === "VariableDeclaration") return varIn(scope.init, name);
    if (scope.type === "CatchClause") return scope.param !== null && bound(scope.param, name) !== undefined ? { kind: "other" } : undefined;
    if (scope.type !== "Program" && scope.type !== "BlockStatement" && scope.type !== "StaticBlock") return undefined;
    for (const raw of scope.body) {
      const statement = raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration" ? raw.declaration ?? raw : raw;
      if (statement.type === "VariableDeclaration") {
        const found = varIn(statement, name);
        if (found !== undefined) return found;
      } else if (statement.type === "FunctionDeclaration" && statement.id?.name === name) {
        return { kind: "function", fn: statement };
      } else if ((statement.type === "ClassDeclaration" && statement.id?.name === name) || (statement.type === "ImportDeclaration" && statement.specifiers.some((specifier) => specifier.local.name === name))) {
        return { kind: "other" };
      }
    }
    return undefined;
  }

  function varIn(declaration, name) {
    for (const declarator of declaration.declarations) {
      const id = bound(declarator.id, name);
      if (id !== undefined) return { kind: "var", declarator, pattern: declarator.id, id };
    }
    return undefined;
  }

  /** The identifier in `pattern` that binds `name`, if one does. */
  function bound(pattern, name) {
    switch (pattern?.type) {
      case "Identifier": return pattern.name === name ? pattern : undefined;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          const id = bound(property.type === "RestElement" ? property.argument : property.value, name);
          if (id !== undefined) return id;
        }
        return undefined;
      case "ArrayPattern":
        for (const element of pattern.elements) {
          const id = element === null ? undefined : bound(element, name);
          if (id !== undefined) return id;
        }
        return undefined;
      case "AssignmentPattern": return bound(pattern.left, name);
      case "RestElement": return bound(pattern.argument, name);
      case "TSParameterProperty": return bound(pattern.parameter, name);
      default: return undefined;
    }
  }

  return { isDom };
}

function isMember(node) {
  return node.type === "MemberExpression" || node.type === "OptionalMemberExpression";
}

function propertyName(member) {
  if (!member.computed) return member.property.name;
  return member.property.type === "StringLiteral" ? member.property.value : undefined;
}
