// Capability 8 · Storytree's own test and gate entries. Two floors under a test's strength (arc_9631097b677e,
// research_5864a61a3dcb route R6, ADR-1355 option A), refused by `pnpm lint` (lint.mjs) in every test file, in `pnpm gate`
// and in CI:
// - A numbered test (`N.M …`) that calls no assertion: no node:assert call, no `t.assert`, no helper that asserts and no
//   throw of its own. research_ebd23d8fe4d8 found nine such build-only tests, each passing whatever the code does.
// - An assertion inside a catch block that does not rethrow: when the call in its try stops throwing, the assertion never
//   runs and the test passes (principle_049430a6e917's swallowed error). assert.rejects or assert.throws says the same
//   and fails when nothing throws.
//
// It reads the code alone (Babel's parser, no types). A helper that asserts is a function the test calls that calls an
// assertion, or throws when it is written in a test file or under a testing/ folder, itself or through a helper of its own:
// one written in the test file, or exported by a module the test file imports by a relative path, followed into that
// module. A throw in the code under test is no check of it. A call through anything else (a package, a method of
// an object) is not taken as an assertion, so a test whose only check runs there names one of its own.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** A test helper under a testing/ folder, whose throw is a check as a test file's is; a throw in the code under test is not. */
const TEST_SUPPORT = /(?:^|\/)testing\//;
const CODE_EXTENSIONS = [".mjs", ".js", ".ts", ".mts", ".cjs", ".cts", ".tsx", ".jsx"];
/** A numbered test's title: `N.M` first, after a story's prefix if it has one. */
const NUMBERED_TITLE = /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+\b/;
const ASSERT_MODULE = /^(?:node:)?assert(?:\/strict)?$/;
/** The calls that declare a test, by their callee's name; `.skip` and `.todo` ones run nothing, so are not read. */
const TEST_CALLS = new Set(["test", "it"]);

/** One sentence per numbered test that asserts nothing and per assertion swallowed in a catch, in the test files under `root`. */
export function testAssertProblems(root) {
  const modules = moduleReader();
  const problems = [];
  for (const file of testFiles(root)) problems.push(...problemsIn(file, modules.read(path.join(root, file)), modules));
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

function problemsIn(file, module, modules) {
  if (module === undefined) return [];
  const problems = [];
  for (const node of module.nodes) {
    const title = numberedTest(node);
    if (title !== undefined && !modules.asserts(module, node.arguments.findLast((argument) => FUNCTIONS.has(argument.type)))) {
      problems.push(`${file}:${node.loc.start.line} the numbered test "${title}" calls no assertion: a test that checks nothing passes whatever the code does; assert the outcome it protects (node:assert, t.assert, or a helper that asserts)`);
    }
    if (node.type === "CatchClause") {
      let swallowed;
      if (!some(node.body, false, (inner) => inner.type === "ThrowStatement")) some(node.body, false, (inner) => inner.type === "CallExpression" && isAssertion(module, inner.callee) && (swallowed = inner) !== undefined);
      if (swallowed !== undefined) {
        problems.push(`${file}:${swallowed.loc.start.line} ${module.text.slice(swallowed.callee.start, swallowed.callee.end)} sits in a catch block that does not rethrow, so it never runs when nothing throws and the test passes; use assert.rejects or assert.throws instead`);
      }
    }
  }
  return problems;
}

/** The title of `node` when it is a numbered test that runs (`test`, `it`, `t.test`, `.only`), else undefined. */
function numberedTest(node) {
  if (node.type !== "CallExpression") return undefined;
  const callee = node.callee;
  const name = callee.type === "Identifier" ? callee.name
    : callee.type === "MemberExpression" && !callee.computed
      ? callee.property.name === "only" && callee.object.type === "Identifier" ? callee.object.name : callee.property.name
      : undefined;
  if (!TEST_CALLS.has(name)) return undefined;
  const first = node.arguments[0];
  const title = first?.type === "StringLiteral" ? first.value
    : first?.type === "TemplateLiteral" && first.expressions.length === 0 ? first.quasis[0].value.cooked : undefined;
  if (title === undefined || !NUMBERED_TITLE.test(title)) return undefined;
  return node.arguments.some((argument) => FUNCTIONS.has(argument.type)) ? title : undefined;
}

/**
 * Whether `found` holds for a node under `node`, crossing into the functions written there only when `nested` (a callback a
 * test passes on is part of it); the walk stops at the first that does.
 */
function some(node, nested, found) {
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child !== null && typeof child?.type === "string" && (found(child) || ((nested || !FUNCTIONS.has(child.type)) && some(child, nested, found)))) return true;
    } else if (typeof value.type === "string" && (found(value) || ((nested || !FUNCTIONS.has(value.type)) && some(value, nested, found)))) {
      return true;
    }
  }
  return false;
}

/** Whether `callee` is an assertion: a node:assert import or a member of one, `assert(…)`, or any `….assert…` (`t.assert.equal`). */
function isAssertion(module, callee) {
  let root = callee;
  while (root.type === "MemberExpression" || root.type === "OptionalMemberExpression") {
    if (!root.computed && root.property.name === "assert") return true;
    root = root.object;
  }
  if (root.type !== "Identifier") return false;
  const source = module.imports.get(root.name)?.source;
  return source === undefined ? root.name === "assert" : ASSERT_MODULE.test(source);
}

/** Parses and caches modules, and answers whether a function asserts, following helpers into relatively imported modules. */
function moduleReader() {
  const cache = new Map();
  const deciding = new Set();
  const decided = new Map();

  function read(file) {
    if (cache.has(file)) return cache.get(file);
    cache.set(file, undefined);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
    let ast;
    try {
      ast = parse(text, {
        sourceType: "unambiguous", errorRecovery: true, createImportExpressions: true,
        plugins: ["decorators-legacy", ...(/\.[cm]?tsx?$/.test(file) ? ["typescript"] : []), ...(/\.[jt]sx$/.test(file) ? ["jsx"] : [])],
      });
    } catch {
      return undefined;
    }
    const module = { file, text, program: ast.program, nodes: everyNode(ast.program), imports: importsOf(ast.program) };
    cache.set(file, module);
    return module;
  }

  /**
   * Whether `fn`, a function in `module`, asserts: an assertion call in it, a throw when `module` is a test file or a test
   * helper, or a call of a helper that does.
   */
  function asserts(module, fn) {
    if (fn === undefined) return false;
    if (decided.has(fn)) return decided.get(fn);
    if (deciding.has(fn)) return false;
    deciding.add(fn);
    const calls = (node) => node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression";
    const throws = TEST_FILE.test(module.file) || TEST_SUPPORT.test(module.file.split(path.sep).join("/"));
    const result = some(fn, true, (node) => (throws && node.type === "ThrowStatement") || (calls(node) && isAssertion(module, node.callee))) ||
      some(fn, true, (node) => calls(node) && helpers(module, node.callee).some(({ module: at, fn: helper }) => asserts(at, helper)));
    deciding.delete(fn);
    decided.set(fn, result);
    return result;
  }

  /** The functions `callee` may name: a local one by its name, or one a relatively imported module exports. */
  function helpers(module, callee) {
    if (callee.type !== "Identifier") return [];
    const imported = module.imports.get(callee.name);
    if (imported !== undefined) {
      if (!imported.source.startsWith(".")) return [];
      const target = resolveFile(path.dirname(module.file), imported.source);
      const other = target === undefined ? undefined : read(target);
      return other === undefined ? [] : exported(other, imported.name);
    }
    return declared(module, callee.name).map((fn) => ({ module, fn }));
  }

  function exported(module, name, seen = new Set()) {
    if (seen.has(module.file)) return [];
    seen.add(module.file);
    for (const statement of module.program.body) {
      if (statement.type === "ExportDefaultDeclaration" && name === "default") {
        const declaration = statement.declaration;
        if (FUNCTIONS.has(declaration.type)) return [{ module, fn: declaration }];
        if (declaration.type === "Identifier") return declared(module, declaration.name).map((fn) => ({ module, fn }));
      }
      if (statement.type !== "ExportNamedDeclaration") continue;
      const declaration = statement.declaration;
      if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === name) return [{ module, fn: declaration }];
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier" && declarator.id.name === name && FUNCTIONS.has(declarator.init?.type)) return [{ module, fn: declarator.init }];
        }
      }
      for (const specifier of statement.specifiers ?? []) {
        const outer = specifier.exported.name ?? specifier.exported.value;
        if (outer !== name) continue;
        const inner = specifier.local?.name;
        if (statement.source) {
          const target = resolveFile(path.dirname(module.file), statement.source.value);
          const other = target === undefined || !statement.source.value.startsWith(".") ? undefined : read(target);
          return other === undefined ? [] : exported(other, inner, seen);
        }
        return declared(module, inner).map((fn) => ({ module, fn }));
      }
    }
    for (const statement of module.program.body) {
      if (statement.type !== "ExportAllDeclaration" || !statement.source.value.startsWith(".")) continue;
      const target = resolveFile(path.dirname(module.file), statement.source.value);
      const other = target === undefined ? undefined : read(target);
      const found = other === undefined ? [] : exported(other, name, seen);
      if (found.length > 0) return found;
    }
    return [];
  }

  return { read, asserts };
}

function everyNode(program) {
  const nodes = [program];
  some(program, true, (node) => nodes.push(node) === 0);
  return nodes;
}

/** Every function in `module` bound to `name`: declared, or a function expression or arrow assigned to a variable. */
function declared(module, name) {
  if (module.functions === undefined) {
    module.functions = new Map();
    const add = (id, fn) => module.functions.set(id, [...(module.functions.get(id) ?? []), fn]);
    for (const node of module.nodes) {
      if (node.type === "FunctionDeclaration" && node.id) add(node.id.name, node);
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && FUNCTIONS.has(node.init?.type)) add(node.id.name, node.init);
    }
  }
  return module.functions.get(name) ?? [];
}

function resolveFile(dir, specifier) {
  const base = path.resolve(dir, specifier);
  const candidates = [base, ...CODE_EXTENSIONS.map((extension) => base.replace(/\.[cm]?js$/, "") + extension), ...CODE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep) && /\.[cm]?[jt]sx?$/.test(candidate));
}

/** Each name the file imports, mapped to the module it comes from and the name it has there (`default` for a default import). */
function importsOf(program) {
  const imports = new Map();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      const name = specifier.type === "ImportSpecifier" ? specifier.imported.name ?? specifier.imported.value : specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
      imports.set(specifier.local.name, { source: statement.source.value, name });
    }
  }
  return imports;
}
