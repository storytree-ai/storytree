// Capability 8 · Storytree's own test and gate entries.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

import { MINIFIED_NAME } from "./eslint-rules/sketch-bundle-names.mjs";

export const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function sanitizationHits(file, text) {
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
  const readsRegexes = !TEST_FILE.test(file) && !MINIFIED_NAME.test(file);
  const visit = (node) => {
    const regex = !readsRegexes ? undefined : node.type === "RegExpLiteral" || (node.type === "NewExpression" || node.type === "CallExpression") && literal(node.arguments[0]) !== undefined ? regexOf(node) : undefined;
    const pump = regex === undefined ? undefined : overlapping(regex);
    if (pump !== undefined) hits.push({ line: node.loc.start.line, regex: `/${regex.source}/${regex.flags}`, pump, kind: "redos" });
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key) || value === null || typeof value !== "object") continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child !== null && typeof child === "object" && typeof child.type === "string") visit(child);
      }
    }
  };
  visit(ast.program);
  return hits;
}

export function codeqlPatternProblems(root) {
  const problems = [];
  for (const file of codeFiles(root)) {
    for (const hit of sanitizationHits(file, readFileSync(path.join(root, file), "utf8"))) {
      problems.push(`${file}:${hit.line} ${describe(hit)}`);
    }
  }
  return problems.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function describe({ regex, pump }) {
  const shown = regex.length > 40 ? `${regex.slice(0, 37)}...` : regex;
  return `matches ${shown} by repeated parts that overlap (CodeQL's js/polynomial-redos): a run of ${JSON.stringify(pump)} can be split between ` +
    "them in many ways, so a long one that fails backtracks super-linearly; make the repeated parts match disjoint characters " +
    "(a negated class such as [^{]*), drop the optional part between them, or bound one";
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

const ALPHABET = [...Array.from({ length: 128 }, (_, code) => code), 0xa0, 0xc9, 0xe9, 0x2028, 0x2029, 0x4e2d, 0xfeff];
const PREFERRED = [...ALPHABET.keys()].sort((a, b) => rank(ALPHABET[a]) - rank(ALPHABET[b]) || a - b);
function rank(code) {
  const char = String.fromCharCode(code);
  return /[a-z]/.test(char) ? 0 : /[A-Z]/.test(char) ? 1 : /\d/.test(char) ? 2 : code >= 0x20 && code < 0x7f ? 3 : 4;
}
const POSITIONS = 300;
const STEPS = 2_000_000;
const REPEATS = 3;
const overlaps = new Map();
const memberships = new Map();

function overlapping({ source, flags }) {
  const key = `${flags}/${source}`;
  if (!overlaps.has(key)) {
    let pump;
    try {
      new RegExp(source, flags);
      pump = repeatedOverlap(source, flags);
    } catch {
      pump = undefined;
    }
    overlaps.set(key, pump);
  }
  return overlaps.get(key);
}

function repeatedOverlap(source, flags) {
  const read = flags.replace(/[^isuv]/g, "");
  const alphabet = alphabetOf(source, read);
  const automaton = positions(regexTree(source, flags), (src) => membership(src, read, alphabet), 1n << BigInt(alphabet.length));
  const pump = sharedLoop(automaton, alphabet.length);
  return pump?.map((bits) => String.fromCodePoint(alphabet[PREFERRED.find((at) => (bits >> BigInt(at)) & 1n) ?? bitIndexes(bits)[0]])).join("");
}

const bitIndexes = (bits) => [...bits.toString(2)].reverse().flatMap((bit, at) => bit === "1" ? [at] : []);

function alphabetOf(source, flags) {
  const named = [...(/[uv]/.test(flags) ? source : source.split(""))].map((char) => char.codePointAt(0));
  for (const [, braced, four, two] of source.matchAll(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g)) {
    named.push(Number.parseInt(braced ?? four ?? two, 16));
  }
  const alphabet = [...ALPHABET];
  const seen = new Set(alphabet);
  const add = (code) => {
    if (code <= 0x10ffff && !seen.has(code)) { seen.add(code); alphabet.push(code); }
  };
  for (const code of named) {
    add(code);
    if (!flags.includes("i")) continue;
    for (const other of [String.fromCodePoint(code).toLowerCase(), String.fromCodePoint(code).toUpperCase()]) {
      if ([...other].length === 1) add(other.codePointAt(0));
    }
  }
  return alphabet;
}

function membership(src, flags, alphabet) {
  const key = `${flags}/${src}`;
  if (!memberships.has(key)) memberships.set(key, bitsOver(src, flags, ALPHABET, 0));
  const base = memberships.get(key);
  return alphabet.length === ALPHABET.length ? base : base | bitsOver(src, flags, alphabet.slice(ALPHABET.length), ALPHABET.length);
}

function bitsOver(src, flags, codes, offset) {
  const one = new RegExp(`^(?:${src})$`, flags);
  let bits = 0n;
  codes.forEach((code, at) => {
    if (one.test(String.fromCodePoint(code))) bits |= 1n << BigInt(offset + at);
  });
  return bits;
}

const EMPTY = { t: "empty" };
const END = { t: "end" };

function regexTree(source, flags) {
  const unicode = /[uv]/.test(flags);
  const groups = captureGroups(source);
  let at = 0;
  const fail = () => {
    throw new Error(`unread regex at ${at}`);
  };
  const alternation = () => {
    const items = [sequence()];
    while (source[at] === "|") {
      at++;
      items.push(sequence());
    }
    return { t: "alt", items };
  };
  const sequence = () => {
    const items = [];
    while (at < source.length && source[at] !== "|" && source[at] !== ")") items.push(quantified(atom()));
    return { t: "seq", items };
  };
  const BRACES = /\{(\d+)(?:(,)(\d*))?\}/y;
  const quantified = (body) => {
    let min;
    let max;
    if (source[at] === "*" || source[at] === "+" || source[at] === "?") {
      [min, max] = source[at] === "*" ? [0, Infinity] : source[at] === "+" ? [1, Infinity] : [0, 1];
      at++;
    } else {
      BRACES.lastIndex = at;
      const braces = BRACES.exec(source);
      if (braces === null) return body;
      min = Number(braces[1]);
      max = braces[2] === undefined ? min : braces[3] === "" ? Infinity : Number(braces[3]);
      at = BRACES.lastIndex;
    }
    if (source[at] === "?") at++;
    return { t: "rep", body, min, max };
  };
  const GROUP_HEAD = /\?(?::|=|!|<=|<!|<[^>]*>)/y;
  const atom = () => {
    const start = at;
    const char = source[at];
    if (char === "^" || char === "$") {
      at++;
      return char === "$" && !flags.includes("m") ? END : EMPTY;
    }
    if (char === "(") {
      at++;
      let look = false;
      if (source[at] === "?") {
        GROUP_HEAD.lastIndex = at;
        const head = GROUP_HEAD.exec(source)?.[0] ?? fail();
        if (head === "?!" || head === "?<!") fail();
        look = head === "?=" || head === "?<=";
        at = GROUP_HEAD.lastIndex;
      }
      const inner = alternation();
      if (source[at] !== ")") fail();
      at++;
      return look ? EMPTY : inner;
    }
    if (char === "[") {
      classEnd();
    } else if (char === "\\") {
      if (escapeEnd()) return EMPTY;
    } else {
      at += unicode ? String.fromCodePoint(source.codePointAt(at)).length : 1;
    }
    return { t: "char", src: source.slice(start, at) };
  };
  const classEnd = () => {
    let depth = 0;
    for (; at < source.length; at++) {
      if (source[at] === "\\") at++;
      else if (source[at] === "[" && (depth === 0 || flags.includes("v"))) depth++;
      else if (source[at] === "]" && --depth === 0) {
        at++;
        return;
      }
    }
    fail();
  };
  const escapeEnd = () => {
    const next = source[at + 1];
    const sticky = (pattern) => {
      pattern.lastIndex = at + 1;
      return pattern.exec(source)?.[0];
    };
    if (next === "b" || next === "B") {
      at += 2;
      return true;
    }
    if (next === "k" && source[at + 2] === "<") {
      at = source.indexOf(">", at) + 1 || fail();
      return true;
    }
    if (/[1-9]/.test(next)) {
      const digits = sticky(/\d+/y);
      if (unicode || Number(digits) <= groups) {
        at += 1 + digits.length;
        return true;
      }
    }
    const escape = sticky(/c[A-Za-z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}/y) ??
      (unicode ? sticky(/u\{[0-9a-fA-F]+\}|[pP]\{[^}]*\}/y) : sticky(/[0-3][0-7]{0,2}|[4-7][0-7]?/y)) ?? (next === undefined ? fail() : String.fromCodePoint(source.codePointAt(at + 1)));
    at += 1 + escape.length;
    return false;
  };
  const tree = alternation();
  if (at !== source.length) fail();
  return tree;
}

function captureGroups(source) {
  let count = 0;
  let inClass = false;
  for (let at = 0; at < source.length; at++) {
    if (source[at] === "\\") at++;
    else if (inClass) inClass = source[at] !== "]";
    else if (source[at] === "[") inClass = true;
    else if (source[at] === "(" && (source[at + 1] !== "?" || (source[at + 2] === "<" && !/[=!]/.test(source[at + 3] ?? "")))) count++;
  }
  return count;
}

function positions(tree, setOf, end) {
  const sets = [];
  const follow = [];
  const NONE = { nullable: true, first: [], last: [] };
  const concat = (a, b) => {
    for (const last of a.last) for (const first of b.first) follow[last].add(first);
    return { nullable: a.nullable && b.nullable, first: a.nullable ? [...a.first, ...b.first] : a.first, last: b.nullable ? [...a.last, ...b.last] : b.last };
  };
  const build = (node) => {
    if (node.t === "empty") return NONE;
    if (node.t === "char" || node.t === "end") {
      if (sets.length >= POSITIONS) throw new Error("too many positions");
      sets.push(node.t === "end" ? end : setOf(node.src));
      follow.push(new Set());
      return { nullable: false, first: [sets.length - 1], last: [sets.length - 1] };
    }
    if (node.t === "seq") return node.items.map(build).reduce(concat, NONE);
    if (node.t === "alt") {
      const parts = node.items.map(build);
      return { nullable: parts.some((part) => part.nullable), first: parts.flatMap((part) => part.first), last: parts.flatMap((part) => part.last) };
    }
    const { body, min, max } = node;
    if (max === Infinity) {
      const parts = Array.from({ length: Math.min(Math.max(min - 1, 0), REPEATS) }, () => build(body));
      const loop = build(body);
      concat(loop, loop);
      return [...parts, { ...loop, nullable: loop.nullable || min === 0 }].reduce(concat, NONE);
    }
    const parts = Array.from({ length: Math.min(min, REPEATS) }, () => build(body));
    let optional = NONE;
    for (let copies = Math.min(max - min, REPEATS); copies > 0; copies--) optional = { ...concat(build(body), optional), nullable: true };
    return [...parts, optional].reduce(concat, NONE);
  };
  const { nullable, last } = build(tree);
  return { sets, follow: follow.map((next) => [...next]), last: new Set(last), nullable, end };
}

function sharedLoop(automaton, size) {
  const { sets, follow } = automaton;
  const n = sets.length;
  const reach = follow.map((next) => {
    const seen = new Uint8Array(n);
    const stack = [...next];
    for (const to of stack) seen[to] = 1;
    while (stack.length > 0) {
      for (const to of follow[stack.pop()]) {
        if (!seen[to]) {
          seen[to] = 1;
          stack.push(to);
        }
      }
    }
    return seen;
  });
  let steps = STEPS;
  const between = (p, q) => {
    const start = (p * n + p) * n + q;
    const goal = (p * n + q) * n + q;
    const parent = new Map([[start, undefined]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const state = queue[head];
      const [a, b, c] = [Math.floor(state / n / n), Math.floor(state / n) % n, state % n];
      for (const a2 of follow[a]) {
        if (!reach[a2][p]) continue;
        for (const b2 of follow[b]) {
          const ab = sets[a2] & sets[b2];
          if (!reach[b2][q] || ab === 0n) continue;
          for (const c2 of follow[c]) {
            if (--steps < 0) throw new Error("too many steps");
            const abc = ab & sets[c2];
            const next = (a2 * n + b2) * n + c2;
            if (!reach[c2][q] || abc === 0n || parent.has(next)) continue;
            parent.set(next, [state, abc]);
            if (next === goal) {
              const pump = [];
              for (let at = goal; at !== start; at = parent.get(at)[0]) pump.unshift(parent.get(at)[1]);
              return pump;
            }
            queue.push(next);
          }
        }
      }
    }
    return undefined;
  };
  for (let p = 0; p < n; p++) {
    if (!reach[p][p]) continue;
    for (let q = 0; q < n; q++) {
      if (q === p || !reach[q][q] || !reach[p][q] || (sets[p] & sets[q]) === 0n) continue;
      const pump = between(p, q);
      if (pump !== undefined && canFail([p, q], automaton, size)) return pump;
    }
  }
  return undefined;
}

const SUBSETS = 200;

function canFail(from, { sets, follow, last, end }, size) {
  const stops = (at) => last.has(at) && sets[at] !== end;
  const ends = sets.map((_, at) => last.has(at));
  for (let changed = true; changed;) {
    changed = false;
    sets.forEach((_, at) => {
      if (!ends[at] && follow[at].some((to) => sets[to] === end && ends[to])) ends[at] = changed = true;
    });
  }
  const seen = new Set([from.join()]);
  const queue = [from];
  for (let head = 0; head < queue.length && head < SUBSETS; head++) {
    const subset = queue[head];
    if (subset.some(stops)) continue;
    if (!subset.some((at) => ends[at])) return true;
    for (let code = 0; code < size; code++) {
      const bit = 1n << BigInt(code);
      const next = [...new Set(subset.flatMap((at) => follow[at].filter((to) => (sets[to] & bit) !== 0n)))].sort((a, b) => a - b);
      if (!seen.has(next.join())) {
        seen.add(next.join());
        queue.push(next);
      }
    }
  }
  return false;
}
