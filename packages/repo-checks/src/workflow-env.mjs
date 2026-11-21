// Capability 8 · Storytree's own test and gate entries.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseSync } from "oxc-parser";

import { literal } from "./eslint-rules/nodes.mjs";

const ESCAPE = "escape_1b3b0da5720a";
const KEY = /^("[^"]*"|'[^']*'|[^\s"'#][^:]*?):(?:\s(.*))?$/;
const ITEM = /^-(?:\s|$)/;
const SCRIPT_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const GITHUB_ENV_WRITE = /\b([A-Za-z_]\w*)=[^\n]*>>\s*"?\$\{?GITHUB_ENV\b/g;

async function gitFiles(root, ...patterns) {
  const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "--", ...patterns], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean);
}

function unquote(text) {
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function readYaml(text) {
  const lines = text.split(/\r?\n/).map((line) => ({ indent: line.match(/^ */)[0].length, text: line.trim(), raw: line }));
  let at = 0;
  const skip = () => {
    while (at < lines.length && (lines[at].text === "" || lines[at].text.startsWith("#"))) at++;
  };
  const block = (parent) => {
    const taken = [];
    while (at < lines.length && (lines[at].text === "" || lines[at].indent > parent)) taken.push(lines[at++].raw);
    const margin = Math.min(...taken.filter((line) => line.trim() !== "").map((line) => line.match(/^ */)[0].length));
    return taken.map((line) => line.slice(margin)).join("\n");
  };
  const value = (rest, indent) => {
    if (rest !== undefined && /^[|>]/.test(rest)) return block(indent);
    if (rest !== undefined) return unquote(rest);
    skip();
    if (at >= lines.length) return null;
    const next = lines[at];
    if (next.indent > indent || (next.indent === indent && ITEM.test(next.text))) return node(next.indent);
    return null;
  };
  const node = (indent) => {
    skip();
    if (ITEM.test(lines[at].text)) {
      const items = [];
      while (skip(), at < lines.length && lines[at].indent === indent && ITEM.test(lines[at].text)) {
        const rest = lines[at].text.slice(1).trim();
        if (!KEY.test(rest)) {
          at++;
          items.push(unquote(rest));
          continue;
        }
        lines[at] = { indent: indent + 2, text: rest, raw: " ".repeat(indent + 2) + rest };
        items.push(node(indent + 2));
      }
      return items;
    }
    const map = {};
    while (skip(), at < lines.length && lines[at].indent === indent && !ITEM.test(lines[at].text)) {
      const found = KEY.exec(lines[at].text);
      at++;
      if (found) map[unquote(found[1])] = value(found[2]?.trim() || undefined, indent);
    }
    return map;
  };
  skip();
  return at < lines.length ? node(lines[at].indent) : {};
}

function envNames(env) {
  return env !== null && typeof env === "object" && !Array.isArray(env) ? Object.keys(env) : [];
}

function written(run) {
  return [...String(run ?? "").matchAll(GITHUB_ENV_WRITE)].map((found) => found[1]);
}

function commands(run) {
  return String(run ?? "").replace(/\\\r?\n/g, " ").split(/\n|&&|\|\||;|\|/).map((command) => command.trim().split(/\s+/).filter(Boolean).map(unquote));
}

function packageScript(root, dir, name) {
  const file = path.join(root, dir, "package.json");
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, "utf8")).scripts ?? {})[name] ?? null;
}

function entries(root, run, dir, packages, seen = new Set()) {
  const found = [];
  for (const words of commands(run)) {
    const start = words.findIndex((word) => word === "node" || word === "pnpm");
    if (start < 0) continue;
    const rest = words.slice(start + 1);
    if (words[start] === "node") {
      const at = rest.findIndex((word) => SCRIPT_FILE.test(word));
      if (at < 0 || !rest.slice(0, at).every((word, index) => word.startsWith("-") || rest[index - 1]?.startsWith("-"))) continue;
      const file = path.posix.normalize(path.posix.join(dir, rest[at]));
      if (existsSync(path.join(root, file))) found.push({ file, args: rest.slice(at + 1) });
      continue;
    }
    let target = dir;
    let at = 0;
    while (rest[at] === "--filter" || rest[at] === "-F" || rest[at]?.startsWith("--filter=")) {
      const name = rest[at].startsWith("--filter=") ? rest[at].slice("--filter=".length) : rest[++at];
      target = packages.get(name);
      at++;
    }
    if (target === undefined) continue;
    if (rest[at] === "run") at++;
    const name = rest[at];
    const script = name === undefined ? null : packageScript(root, target, name);
    const key = `${target}\0${name}`;
    if (script === null || seen.has(key)) continue;
    found.push(...entries(root, [script, ...rest.slice(at + 1)].join(" "), target, packages, new Set([...seen, key])));
  }
  return found;
}

const FALLBACK = new Set(["??", "||"]);
const SCOPES = new Set(["BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "CatchClause", "StaticBlock"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const POSITIONS = new Set(["parent", "start", "end", "range", "loc"]);

const bare = (node) => node?.type === "ParenthesizedExpression" || node?.type === "ChainExpression" ? bare(node.expression) : node;

const isMember = (node, object, property) => node?.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.object.name === object && node.property.name === property;

function envRead(node) {
  const read = bare(node);
  if (read?.type !== "MemberExpression" || !isMember(read.object, "process", "env")) return null;
  return read.computed ? literal(read.property) ?? null : read.property.name;
}

function initializerReads(node) {
  const read = bare(node);
  if (read.type === "LogicalExpression" && FALLBACK.has(read.operator)) return [...initializerReads(read.left), ...initializerReads(read.right)];
  if (read.type === "ConditionalExpression") return [...initializerReads(read.consequent), ...initializerReads(read.alternate)];
  const name = envRead(read);
  return name === null ? [] : [name];
}

function argvIndex(node) {
  if (node?.type !== "MemberExpression" || !node.computed || !isMember(node.object, "process", "argv") || node.property.type !== "Literal" || typeof node.property.value !== "number") return null;
  return node.property.value;
}

function argvTest(condition) {
  const test = bare(condition);
  if (test.type === "BinaryExpression" && ["===", "=="].includes(test.operator)) {
    for (const [side, other] of [[test.left, test.right], [test.right, test.left]]) {
      const index = argvIndex(side);
      if (index !== null && literal(other) !== undefined) return { index, words: [literal(other)] };
    }
  }
  if (test.type === "CallExpression" && test.callee.type === "MemberExpression" && !test.callee.computed && test.callee.property.name === "includes" &&
    test.callee.object.type === "ArrayExpression" && test.arguments.length === 1) {
    const index = argvIndex(test.arguments[0]);
    const elements = test.callee.object.elements;
    if (index !== null && elements.every((element) => literal(element) !== undefined)) return { index, words: elements.map(literal) };
  }
  return null;
}

function reachedWith(node, args) {
  for (let child = node; child.parent; child = child.parent) {
    const parent = child.parent;
    if (parent.type !== "IfStatement" || parent.consequent !== child) continue;
    const test = argvTest(parent.test);
    const word = test === null ? undefined : args[test.index - 2];
    if (test !== null && !word?.startsWith("$") && !test.words.includes(word)) return false;
  }
  return true;
}

function boundNames(pattern) {
  if (pattern === null || pattern === undefined) return [];
  switch (pattern.type) {
    case "Identifier": return [pattern.name];
    case "ObjectPattern": return pattern.properties.flatMap((property) => boundNames(property.type === "RestElement" ? property.argument : property.value));
    case "ArrayPattern": return pattern.elements.flatMap(boundNames);
    case "AssignmentPattern": return boundNames(pattern.left);
    case "RestElement": return boundNames(pattern.argument);
    case "TSParameterProperty": return boundNames(pattern.parameter);
    default: return [];
  }
}

function childNodes(node) {
  return Object.entries(node).filter(([key]) => !POSITIONS.has(key)).flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((child) => child !== null && typeof child === "object" && typeof child.type === "string");
}

const RELATIVE = /^\.\.?\//;
const IMPORTS = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"]);
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs", ".jsx"];

function resolveImport(root, from, specifier) {
  const written = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const candidates = [written, ...(/\.js$/.test(written) ? [written.replace(/\.js$/, ".ts"), written.replace(/\.js$/, ".tsx")] : []),
    ...(path.posix.extname(written) === "" ? EXTENSIONS.map((extension) => written + extension) : [])];
  return candidates.find((file) => SCRIPT_FILE.test(file) && existsSync(path.join(root, file))) ?? null;
}

function relativeImports(program) {
  return program.body.filter((node) => IMPORTS.has(node.type) && typeof node.source?.value === "string" && RELATIVE.test(node.source.value))
    .map((node) => node.source.value);
}

function fallbackReads(file, text) {
  const { program } = parseSync(file, text, { sourceType: "module" });
  const fallbacks = [];
  const declare = (scope, pattern, names = []) => {
    for (const name of boundNames(pattern)) scope.names.set(name, names);
  };
  const functionScope = (scope) => scope.function ? scope : functionScope(scope.parent);
  const visit = (node, parent, scope) => {
    node.parent = parent;
    let inner = scope;
    if (FUNCTIONS.has(node.type)) {
      if (node.type === "FunctionDeclaration" && node.id) declare(scope, node.id);
      inner = { names: new Map(), parent: scope, function: true };
      if (node.type === "FunctionExpression" && node.id) declare(inner, node.id);
      for (const param of node.params) declare(inner, param);
    } else if (SCOPES.has(node.type)) {
      inner = { names: new Map(), parent: scope, function: false };
      if (node.type === "CatchClause") declare(inner, node.param);
    } else if (node.type === "VariableDeclaration") {
      const target = node.kind === "var" ? functionScope(scope) : scope;
      for (const { id, init } of node.declarations) declare(target, id, node.kind === "const" && id.type === "Identifier" && init ? initializerReads(init) : []);
    } else if (node.type === "ClassDeclaration" && node.id) {
      declare(scope, node.id);
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) declare(scope, specifier.local);
    } else if (node.type === "LogicalExpression" && FALLBACK.has(node.operator)) {
      fallbacks.push({ node, scope });
    }
    for (const child of childNodes(node)) visit(child, node, inner);
  };
  visit(program, null, { names: new Map(), parent: null, function: true });
  const resolve = (scope, name) => scope === null ? [] : scope.names.get(name) ?? resolve(scope.parent, name);
  const reads = fallbacks.flatMap(({ node, scope }) => {
    const direct = envRead(node.left);
    const names = direct !== null ? [direct] : node.left.type === "Identifier" ? resolve(scope, node.left.name) : [];
    return names.map((name) => ({ name, line: text.slice(0, node.start).split("\n").length, node }));
  });
  return { reads, imports: relativeImports(program) };
}

async function moduleReads(root, entry, parsed) {
  const reached = [];
  const queue = [entry];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift();
    if (!parsed.has(file)) parsed.set(file, fallbackReads(file, await readFile(path.join(root, file), "utf8")));
    const { reads, imports } = parsed.get(file);
    reached.push(...reads.map((read) => ({ ...read, file })));
    for (const next of imports.map((specifier) => resolveImport(root, file, specifier))) {
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return reached;
}

export async function workflowEnvProblems(root) {
  const workflows = await gitFiles(root, ".github/workflows/*.yml", ".github/workflows/*.yaml");
  const packages = new Map();
  for (const file of await gitFiles(root, "package.json", "*/package.json")) {
    const name = JSON.parse(await readFile(path.join(root, file), "utf8")).name;
    if (typeof name === "string") packages.set(name, path.posix.dirname(file));
  }
  const runs = [];
  for (const workflow of workflows) {
    const parsed = readYaml(await readFile(path.join(root, workflow), "utf8"));
    const jobs = Object.entries(parsed.jobs ?? {}).map(([id, job]) => ({ id, env: envNames(job?.env), steps: Array.isArray(job?.steps) ? job.steps : [] }));
    const set = new Set([...envNames(parsed.env), ...jobs.flatMap((job) => [...job.env, ...job.steps.flatMap((step) => [...envNames(step?.env), ...written(step?.run)])])]);
    for (const job of jobs) {
      const has = new Set([...envNames(parsed.env), ...job.env]);
      for (const step of job.steps) {
        const here = new Set([...has, ...envNames(step?.env)]);
        for (const entry of entries(root, step?.run, ".", packages)) runs.push({ workflow, job: job.id, entry, set, here });
        for (const name of written(step?.run)) has.add(name);
      }
    }
  }
  const parsed = new Map();
  const readsOf = new Map();
  for (const file of new Set(runs.map(({ entry }) => entry.file))) readsOf.set(file, await moduleReads(root, file, parsed));
  const problems = new Set();
  for (const { workflow, job, entry, set, here } of runs) {
    for (const read of readsOf.get(entry.file)) {
      if (!set.has(read.name) || here.has(read.name) || !reachedWith(read.node, entry.args)) continue;
      const through = read.file === entry.file ? "" : `, which imports ${read.file}`;
      problems.add(`${workflow} job ${job}: runs ${entry.file}${through}, whose ${read.file}:${read.line} reads ${read.name} with a fallback (?? or ||), ` +
        `but job ${job} never sets ${read.name} though another part of ${workflow} does, so it runs on the fallback in silence (${ESCAPE}): ` +
        `set ${read.name} in the job's env, the step's env, the workflow's env or an earlier step's $GITHUB_ENV`);
    }
  }
  return [...problems];
}
