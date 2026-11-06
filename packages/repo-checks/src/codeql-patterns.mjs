// Capability 8 · Storytree's own test and gate entries. The CodeQL patterns a pull request has met, refused locally so
// they never reach the repository (increment_15f747652fc7, Mick's voice note voice.note_496b63639fbb): `pnpm lint`
// (lint.mjs) refuses them over the whole tree, in `pnpm gate` and in CI, and the push check (push-check.mjs) refuses
// a push whose commits add one. One pattern so far, PR #489's (CodeQL's js/incomplete-multi-character-sanitization):
// a global replace that removes an HTML tag or comment by a regex starting with `<`, replaced with the empty string,
// in one pass. What it removes can re-form from what is left (`<scr<script>ipt>`). A replace repeated in a loop until
// nothing changes passes, as do a spaced replacement, a single (non-global) replace, an escape and a split.
//
// It reads the code alone (Babel's parser), so a pattern inside a string or comment is never refused. A fix session
// that meets a new pattern adds it here, beside this one, with its numbered test.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

export const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const LOOPS = new Set(["WhileStatement", "DoWhileStatement", "ForStatement", "ForOfStatement", "ForInStatement"]);
/** A cheap look for the shape, so only a file that may hold one is parsed: a replace whose regex opens with `<`. */
const MAY_HOLD = /replace(?:All)?\s*\(\s*(?:\/[(?:]*<|(?:new\s+)?RegExp\s*\(\s*["'`][(?:]*<)/;
const RULE = "CodeQL's js/incomplete-multi-character-sanitization";
const ADVICE = "repeat it until nothing changes, split on the pattern instead, or escape the text rather than strip it";

/** Each tag-removing global replace in `text`, the code of `file`: its line and the regex it removes. */
export function sanitizationHits(file, text) {
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
  const hits = [];
  const visit = (node, inLoop) => {
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const regex = stripping(node);
      if (regex !== undefined && !inLoop) hits.push({ line: node.loc.start.line, regex });
    }
    const loop = FUNCTIONS.has(node.type) ? false : inLoop || LOOPS.has(node.type);
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key) || value === null || typeof value !== "object") continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child !== null && typeof child === "object" && typeof child.type === "string") visit(child, loop);
      }
    }
  };
  visit(ast.program, false);
  return hits;
}

/** One sentence per hit in the code files under `root`, naming file and line. */
export function codeqlPatternProblems(root) {
  const problems = [];
  for (const file of codeFiles(root)) {
    for (const { line, regex } of sanitizationHits(file, readFileSync(path.join(root, file), "utf8"))) {
      problems.push(`${file}:${line} ${describe(regex)}`);
    }
  }
  return problems.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** What a hit is and the way out, for a refusal. */
export const describe = (regex) => `removes ${regex.length > 40 ? `${regex.slice(0, 37)}...` : regex} by one global replace with "" (${RULE}): what it removes can re-form from what is left; ${ADVICE}`;

function codeFiles(root, dir = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...codeFiles(root, rel));
    else if (CODE_FILE.test(entry.name)) files.push(rel);
  }
  return files;
}

/** The regex, shown as `/source/flags`, when `call` is a global replace of a multi-character `<…` pattern by "". */
function stripping(call) {
  const callee = call.callee;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
  const method = callee.computed ? (callee.property.type === "StringLiteral" ? callee.property.value : undefined) : callee.property.name;
  if (method !== "replace" && method !== "replaceAll") return undefined;
  const [pattern, replacement] = call.arguments;
  const regex = regexOf(pattern);
  if (regex === undefined || !(regex.flags.includes("g") || method === "replaceAll")) return undefined;
  if (!isEmptyString(replacement) || !removesTag(regex.source)) return undefined;
  return `/${regex.source}/${regex.flags}`;
}

function regexOf(node) {
  if (node?.type === "RegExpLiteral") return { source: node.pattern, flags: node.flags };
  if ((node?.type === "NewExpression" || node?.type === "CallExpression") && node.callee.type === "Identifier" && node.callee.name === "RegExp") {
    const [source, flags] = node.arguments.map(literal);
    if (source === undefined) return undefined;
    return { source, flags: node.arguments.length > 1 ? flags ?? "" : "" };
  }
  return undefined;
}

function literal(node) {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

const isEmptyString = (node) => literal(node) === "";

/** Whether a regex source starts, past any opening groups, with `<` followed by more of the pattern. */
function removesTag(source) {
  const rest = /^(?:\((?:\?:)?)*<(.*)$/s.exec(source)?.[1];
  return rest !== undefined && rest !== "" && !/^(?:[+*?]|\{\d+(?:,\d*)?\})\??$/.test(rest);
}
