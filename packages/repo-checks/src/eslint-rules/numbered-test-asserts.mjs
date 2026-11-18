// Capability 8 · Storytree's own test and gate entries.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import tseslint from "typescript-eslint";

import { FUNCTIONS, importsOf, isAssertion, some, TEST_FILE } from "./assertions.mjs";
import { literal } from "./nodes.mjs";

const TEST_SUPPORT = /(?:^|\/)testing\//;
const CODE_EXTENSIONS = [".mjs", ".js", ".ts", ".mts", ".cjs", ".cts", ".tsx", ".jsx"];
const NUMBERED_TITLE = /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+\b/;
const TEST_CALLS = new Set(["test", "it"]);
const CALLS = new Set(["CallExpression", "NewExpression"]);

const parsed = new Map();

function moduleOf(file, program) {
  const nodes = [program];
  some(program, true, (node) => nodes.push(node) === 0);
  return { file, program, nodes, imports: importsOf(program) };
}

function readModule(file) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return undefined;
  }
  const cached = parsed.get(file);
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.module;
  let module;
  try {
    const text = readFileSync(file, "utf8");
    const { ast } = tseslint.parser.parseForESLint(text, { filePath: file, sourceType: "module", ecmaVersion: "latest", range: true, loc: true, ecmaFeatures: { jsx: /\.[jt]sx$/.test(file) } });
    module = moduleOf(file, ast);
  } catch {
    module = undefined;
  }
  parsed.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, module });
  return module;
}

function resolveFile(dir, specifier) {
  const base = path.resolve(dir, specifier);
  const candidates = [base, ...CODE_EXTENSIONS.map((extension) => base.replace(/\.[cm]?js$/, "") + extension), ...CODE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep) && /\.[cm]?[jt]sx?$/.test(candidate));
}

function relativeModule(module, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolveFile(path.dirname(module.file), specifier);
  return target === undefined ? undefined : readModule(target);
}

function declared(module, name) {
  if (module.functions === undefined) {
    module.functions = new Map();
    const add = (id, fn) => module.functions.set(id, [...(module.functions.get(id) ?? []), fn]);
    for (const node of module.nodes) {
      if (node.type === "FunctionDeclaration" && node.id) add(node.id.name, node);
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && FUNCTIONS.has(node.init?.type)) add(node.id.name, node.init);
    }
  }
  return (module.functions.get(name) ?? []).map((fn) => ({ module, fn }));
}

function exported(module, name, seen = new Set()) {
  if (seen.has(module.file)) return [];
  seen.add(module.file);
  for (const statement of module.program.body) {
    if (statement.type === "ExportDefaultDeclaration" && name === "default") {
      const declaration = statement.declaration;
      if (FUNCTIONS.has(declaration.type)) return [{ module, fn: declaration }];
      if (declaration.type === "Identifier") return declared(module, declaration.name);
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
      if ((specifier.exported.name ?? specifier.exported.value) !== name) continue;
      const inner = specifier.local.name ?? specifier.local.value;
      if (statement.source) {
        const other = relativeModule(module, statement.source.value);
        return other === undefined ? [] : exported(other, inner, seen);
      }
      return declared(module, inner);
    }
  }
  for (const statement of module.program.body) {
    if (statement.type !== "ExportAllDeclaration" || statement.exported) continue;
    const other = relativeModule(module, statement.source.value);
    const found = other === undefined ? [] : exported(other, name, seen);
    if (found.length > 0) return found;
  }
  return [];
}

function helpers(module, callee) {
  if (callee.type !== "Identifier") return [];
  const imported = module.imports.get(callee.name);
  if (imported === undefined) return declared(module, callee.name);
  const other = relativeModule(module, imported.source);
  return other === undefined ? [] : exported(other, imported.name);
}

function assertionReader() {
  const deciding = new Set();
  const decided = new Map();
  function asserts(module, fn) {
    if (fn === undefined) return false;
    if (decided.has(fn)) return decided.get(fn);
    if (deciding.has(fn)) return false;
    deciding.add(fn);
    const throws = TEST_FILE.test(module.file) || TEST_SUPPORT.test(module.file.split(path.sep).join("/"));
    const result = some(fn, true, (node) => (throws && node.type === "ThrowStatement") || (CALLS.has(node.type) && isAssertion(module.imports, node.callee))) ||
      some(fn, true, (node) => CALLS.has(node.type) && helpers(module, node.callee).some(({ module: at, fn: helper }) => asserts(at, helper)));
    deciding.delete(fn);
    decided.set(fn, result);
    return result;
  }
  return asserts;
}

function numberedTest(node) {
  if (node.type !== "CallExpression") return undefined;
  const callee = node.callee;
  const name = callee.type === "Identifier" ? callee.name
    : callee.type === "MemberExpression" && !callee.computed
      ? callee.property.name === "only" && callee.object.type === "Identifier" ? callee.object.name : callee.property.name
      : undefined;
  if (!TEST_CALLS.has(name)) return undefined;
  const title = literal(node.arguments[0]);
  if (title === undefined || !NUMBERED_TITLE.test(title)) return undefined;
  return node.arguments.some((argument) => FUNCTIONS.has(argument.type)) ? title : undefined;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      assertsNothing: "the numbered test \"{{title}}\" calls no assertion: a test that checks nothing passes whatever the code does; assert the outcome it protects (node:assert, t.assert, or a helper that asserts)",
    },
  },
  create(context) {
    if (!TEST_FILE.test(context.filename)) return {};
    return {
      Program(program) {
        const module = moduleOf(context.filename, program);
        const asserts = assertionReader();
        for (const node of module.nodes) {
          const title = numberedTest(node);
          if (title === undefined || asserts(module, node.arguments.findLast((argument) => FUNCTIONS.has(argument.type)))) continue;
          context.report({ node, messageId: "assertsNothing", data: { title } });
        }
      },
    };
  },
};
