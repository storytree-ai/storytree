// Capability 8 · Storytree's own test and gate entries. The CodeQL patterns a pull request has met, refused locally so
// they never reach the repository (increment_15f747652fc7, Mick's voice note voice.note_496b63639fbb): `pnpm lint`
// (lint.mjs) refuses them over the whole tree, in `pnpm gate` and in CI, and the push check (push-check.mjs) refuses
// a push whose commits add one. Two patterns so far:
// - PR #489's (CodeQL's js/incomplete-multi-character-sanitization): a global replace that removes an HTML tag or
//   comment by a regex starting with `<`, replaced with the empty string, in one pass. What it removes can re-form
//   from what is left (`<scr<script>ipt>`). A replace repeated in a loop until nothing changes passes, as do a spaced
//   replacement, a single (non-global) replace, an escape and a split.
// - PR #724's (CodeQL's js/incomplete-sanitization, increment_171a0ab97911): a replace that escapes characters by a
//   backslash, its regex one character, a class or a group of either, none of which is backslash (`/\./g, "\\."`).
//   A backslash already in the text is left bare, so it escapes the next character instead. A pattern that matches
//   backslash too (the full escape `/[.*+?^${}()|[\]\\]/g, "\\$&"`, a range over it, `\W`, a negated class) passes.
//   A string pattern of one character other than backslash (`replaceAll(".", "\\.")`) is the same shape, and with
//   `replace` it escapes only the first (increment_82d197743d7b).
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
/** A cheap look for either shape, so only a file that may hold one is parsed: a replace whose regex opens with `<`, or
 * a string argument opening with a backslash. */
const MAY_HOLD = /replace(?:All)?\s*\(\s*(?:\/[(?:]*<|(?:new\s+)?RegExp\s*\(\s*["'`][(?:]*<)|,\s*["'`]\\\\/;

/** Each tag-removing global replace and each partial backslash escape in `text`, the code of `file`: its line, its
 * regex and which of the two it is. */
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
      const stripped = stripping(node);
      if (stripped !== undefined && !inLoop) hits.push({ line: node.loc.start.line, regex: stripped, kind: "strip" });
      const escaped = partialEscape(node);
      if (escaped !== undefined) hits.push({ line: node.loc.start.line, regex: escaped, kind: "escape" });
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
    for (const hit of sanitizationHits(file, readFileSync(path.join(root, file), "utf8"))) {
      problems.push(`${file}:${hit.line} ${describe(hit)}`);
    }
  }
  return problems.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** What a hit is and the way out, for a refusal. */
export function describe({ regex, kind }) {
  const shown = regex.length > 40 ? `${regex.slice(0, 37)}...` : regex;
  if (kind === "escape") {
    return `escapes ${shown} by a backslash and misses backslash itself (CodeQL's js/incomplete-sanitization): a backslash already in the text is left bare; ` +
      'escape it too, as /[.*+?^${}()|[\\]\\\\]/g, "\\\\$&" does for a regex';
  }
  return `removes ${shown} by one global replace with "" (CodeQL's js/incomplete-multi-character-sanitization): what it removes can re-form from what is left; ` +
    "repeat it until nothing changes, split on the pattern instead, or escape the text rather than strip it";
}

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

/** The method a call names, `replace` or `replaceAll` among them. */
function methodOf(call) {
  const callee = call.callee;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
  return callee.computed ? (callee.property.type === "StringLiteral" ? callee.property.value : undefined) : callee.property.name;
}

/** The regex, shown as `/source/flags`, when `call` is a global replace of a multi-character `<…` pattern by "". */
function stripping(call) {
  const method = methodOf(call);
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

/** The pattern, shown as `/source/flags` or `"c"`, when `call` is a replace by a backslash-led string of a pattern
 * that matches only characters it lists, backslash not among them: a regex, or a string of one character. */
function partialEscape(call) {
  const method = methodOf(call);
  if (method !== "replace" && method !== "replaceAll") return undefined;
  const [pattern, replacement] = call.arguments;
  const escaped = escapedBy(pattern);
  if (escaped === undefined || !literal(replacement)?.startsWith("\\") || escaped.backslash !== "misses") return undefined;
  return escapesBackslashFirst(call.callee.object) ? undefined : escaped.shown;
}

/** Whether `node` is a chain of replaces one of which escapes backslash by a backslash, as `.replace(/\\/g, "\\\\")`. */
function escapesBackslashFirst(node) {
  for (let call = node; call?.type === "CallExpression" || call?.type === "OptionalCallExpression"; call = call.callee.object) {
    const method = methodOf(call);
    if (method !== "replace" && method !== "replaceAll") return false;
    if (literal(call.arguments[1])?.startsWith("\\") && escapedBy(call.arguments[0])?.backslash === "matches") return true;
  }
  return false;
}

/** A replace's pattern as shown and whether it "matches" or "misses" a backslash: a regex of one character, a class
 * or a group of either, or a string of one character; undefined for any other. */
function escapedBy(node) {
  const regex = regexOf(node);
  if (regex !== undefined) return { shown: `/${regex.source}/${regex.flags}`, backslash: characters(regex.source) };
  const text = literal(node);
  if (text?.length !== 1) return undefined;
  return { shown: JSON.stringify(text), backslash: text === "\\" ? "matches" : "misses" };
}

const CLASS_ESCAPES = /^[dDwWsSbBpPkcxuv0-9]$/;

/** For a regex source of one character, a class or a group of either: whether it "matches" a backslash or "misses"
 * it; undefined for any other source. */
function characters(source) {
  const inner = /^\((?:\?:)?(.*)\)$/s.exec(source)?.[1] ?? source;
  if (/^\\.$/s.test(inner)) return inner[1] === "\\" ? "matches" : CLASS_ESCAPES.test(inner[1]) ? undefined : "misses";
  if (/^[^\\[\](){}|.*+?^$]$/.test(inner)) return "misses";
  const [, negated, body] = /^\[(\^?)(.+)\]$/s.exec(inner) ?? [];
  if (body === undefined) return undefined;
  const chars = [];
  let matches = false;
  for (let at = 0; at < body.length; at++) {
    if (body[at] === "]") return undefined; // the class closed early: not one class
    if (body[at] !== "\\") chars.push(body[at]);
    else if (/[WDS]/.test(body[++at] ?? "")) matches = true; // \W, \D and \S match a backslash
    else chars.push(/[dws]/.test(body[at]) ? undefined : body[at]);
  }
  matches ||= chars.includes("\\") || chars.some((char, at) => chars[at + 1] === "-" && char !== undefined && chars[at + 2] !== undefined && char <= "\\" && "\\" <= chars[at + 2]);
  return matches !== (negated === "^") ? "matches" : "misses";
}
