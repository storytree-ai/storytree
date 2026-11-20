// Capability 8 · Storytree's own test and gate entries.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

const ESCAPE = "escape_1b3b0da5720a";
const KEY = /^("[^"]*"|'[^']*'|[^\s"'#][^:]*?):(?:\s(.*))?$/;
const ITEM = /^-(?:\s|$)/;
const SCRIPT_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const GITHUB_ENV_WRITE = /\b([A-Za-z_]\w*)=[^\n]*>>\s*"?\$\{?GITHUB_ENV\b/g;
const FALLBACK = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);

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

function envRead(node) {
  if (ts.isParenthesizedExpression(node)) return envRead(node.expression);
  const host = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
  if (host === null || !ts.isPropertyAccessExpression(host) || host.getText() !== "process.env") return null;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

function initializerReads(node) {
  if (ts.isParenthesizedExpression(node)) return initializerReads(node.expression);
  if (ts.isBinaryExpression(node) && FALLBACK.has(node.operatorToken.kind)) return [...initializerReads(node.left), ...initializerReads(node.right)];
  if (ts.isConditionalExpression(node)) return [...initializerReads(node.whenTrue), ...initializerReads(node.whenFalse)];
  const name = envRead(node);
  return name === null ? [] : [name];
}

function argvIndex(node) {
  if (!ts.isElementAccessExpression(node) || node.expression.getText() !== "process.argv" || !ts.isNumericLiteral(node.argumentExpression)) return null;
  return Number(node.argumentExpression.text);
}

function argvTest(condition) {
  if (ts.isParenthesizedExpression(condition)) return argvTest(condition.expression);
  if (ts.isBinaryExpression(condition) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(condition.operatorToken.kind)) {
    for (const [side, other] of [[condition.left, condition.right], [condition.right, condition.left]]) {
      const index = argvIndex(side);
      if (index !== null && ts.isStringLiteralLike(other)) return { index, words: [other.text] };
    }
  }
  if (ts.isCallExpression(condition) && ts.isPropertyAccessExpression(condition.expression) && condition.expression.name.text === "includes" &&
    ts.isArrayLiteralExpression(condition.expression.expression) && condition.arguments.length === 1) {
    const index = argvIndex(condition.arguments[0]);
    const elements = condition.expression.expression.elements;
    if (index !== null && elements.every(ts.isStringLiteralLike)) return { index, words: elements.map((element) => element.text) };
  }
  return null;
}

function reachedWith(node, args) {
  for (let child = node; child.parent; child = child.parent) {
    const parent = child.parent;
    if (!ts.isIfStatement(parent) || parent.thenStatement !== child) continue;
    const test = argvTest(parent.expression);
    const word = test === null ? undefined : args[test.index - 2];
    if (test !== null && !word?.startsWith("$") && !test.words.includes(word)) return false;
  }
  return true;
}

function fallbackReads(program, file) {
  const source = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const bound = new Map();
  const reads = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const)) {
      const names = initializerReads(node.initializer);
      const symbol = checker.getSymbolAtLocation(node.name);
      if (names.length > 0 && symbol) bound.set(symbol, names);
    }
    if (ts.isBinaryExpression(node) && FALLBACK.has(node.operatorToken.kind)) {
      const direct = envRead(node.left);
      const symbol = ts.isIdentifier(node.left) ? checker.getSymbolAtLocation(node.left) : undefined;
      const names = direct !== null ? [direct] : (symbol && bound.get(symbol)) ?? [];
      for (const name of names) reads.push({ name, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
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
  if (runs.length === 0) return [];
  const files = [...new Set(runs.map(({ entry }) => path.join(root, entry.file)))];
  const program = ts.createProgram(files, { allowJs: true, noResolve: true, noLib: true, types: [], noEmit: true });
  const readsOf = new Map(files.map((file) => [file, fallbackReads(program, file)]));
  const problems = new Set();
  for (const { workflow, job, entry, set, here } of runs) {
    for (const read of readsOf.get(path.join(root, entry.file))) {
      if (!set.has(read.name) || here.has(read.name) || !reachedWith(read.node, entry.args)) continue;
      problems.add(`${workflow} job ${job}: runs ${entry.file}, whose ${entry.file}:${read.line} reads ${read.name} with a fallback (?? or ||), ` +
        `but job ${job} never sets ${read.name} though another part of ${workflow} does, so it runs on the fallback in silence (${ESCAPE}): ` +
        `set ${read.name} in the job's env, the step's env, the workflow's env or an earlier step's $GITHUB_ENV`);
    }
  }
  return [...problems];
}
