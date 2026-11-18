// Capability 8 · Storytree's own test and gate entries. A POSIX-only process command run where Windows also runs the
// code (escape_3d876fe9f3df, arc_a8103c0577a8, ADR-1356 D1, D5): PR #859's `ps -eo` threw on a Windows runner because
// nothing branched to its Windows equivalent. `pnpm lint` (lint.mjs) refuses, in a story package's or app's source file
// (not a test file), a call of ps, lsof, pgrep or pkill (a string literal naming it as the call's first argument, or the
// first word of an exec or execSync command string) with no platform branch around it: no enclosing if, ternary or
// logical test, and no earlier if in an enclosing block, that reads the platform (a name or string holding platform,
// win32 or windows). A call only a POSIX machine runs (the Mint box, a caller that branches already) is marked by
// `// posix-only: <why>` on the line before it.
//
// It reads the code alone (Babel's parser), so a command named in a comment or a longer string is never refused.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
const COMMANDS = new Set(["ps", "lsof", "pgrep", "pkill"]);
/** The calls whose first argument is a whole command line, read by its first word. */
const SHELL_CALLS = new Set(["exec", "execSync"]);
/** A cheap look for a command in a string, so only a file that may hold one is parsed. */
const MAY_HOLD = /["'`](?:ps|lsof|pgrep|pkill)\b/;
const PLATFORM = /platform|win32|windows/i;
const MARK = /^\s*\/\/\s*posix-only:\s*\S/;
const BLOCKS = new Set(["Program", "BlockStatement", "StaticBlock"]);

/** One sentence per unbranched, unmarked POSIX-only command in the packages' and apps' source files under `root`. */
export function posixCommandProblems(root) {
  const problems = [];
  for (const top of ["packages", "apps"]) {
    for (const file of sourceFiles(root, top)) {
      const text = readFileSync(path.join(root, file), "utf8");
      for (const { line, command } of unguardedCalls(file, text)) {
        problems.push(`${file}:${line} runs "${command}" with no process.platform branch around it, so it throws on Windows (escape_3d876fe9f3df): ` +
          "branch on process.platform to its Windows equivalent, or, where only a POSIX machine runs it (the Mint box, a caller that branches already), " +
          "mark the line before it // posix-only: <why>");
      }
    }
  }
  return problems.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function sourceFiles(root, dir) {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(root, rel));
    else if (CODE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(rel);
  }
  return files;
}

/** Each call in `text` that runs a POSIX-only command, unbranched and unmarked: its line and the command. */
function unguardedCalls(file, text) {
  if (!MAY_HOLD.test(text)) return [];
  let ast;
  try {
    ast = parse(text, {
      sourceType: "unambiguous", errorRecovery: true, createImportExpressions: true,
      plugins: ["decorators-legacy", ...(/\.[cm]?tsx?$/.test(file) ? ["typescript"] : []), ...(/\.[jt]sx$/.test(file) ? ["jsx"] : [])],
    });
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const found = [];
  const ancestors = [];
  const visit = (node) => {
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const command = commandOf(node);
      const line = node.loc.start.line;
      if (command !== undefined && !MARK.test(lines[line - 2] ?? "") && !branched(node, ancestors)) found.push({ line, command });
    }
    ancestors.push(node);
    for (const child of children(node)) visit(child);
    ancestors.pop();
  };
  visit(ast.program);
  return found;
}

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key) || value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === "object" && typeof child.type === "string") out.push(child);
    }
  }
  return out;
}

/** The POSIX-only command `call` runs, or undefined. */
function commandOf(call) {
  const text = literal(call.arguments[0]);
  if (text === undefined) return undefined;
  if (COMMANDS.has(text)) return text;
  const callee = call.callee;
  const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
  if (!SHELL_CALLS.has(name)) return undefined;
  const first = text.trimStart().split(/\s/)[0];
  return COMMANDS.has(first) ? first : undefined;
}

function literal(node) {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis[0].value.cooked;
  return undefined;
}

/** Whether a platform test encloses `node`: an if, ternary or logical one around it, or an earlier if in a block around it. */
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

/** Whether `test` reads the platform: a name, property or string in it holds platform, win32 or windows. */
function readsPlatform(test) {
  if (test.type === "Identifier") return PLATFORM.test(test.name);
  if (test.type === "StringLiteral") return PLATFORM.test(test.value);
  if ((test.type === "MemberExpression" || test.type === "OptionalMemberExpression") && !test.computed && PLATFORM.test(test.property.name)) return true;
  return children(test).some(readsPlatform);
}
