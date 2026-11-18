// Capability 8 · Storytree's own test and gate entries.
// - PR #989's (CodeQL's js/polynomial-redos, increment_b3e14f7421a6): a regex whose repeated parts overlap, so a run
//   of characters both can match is split between them in many ways and a long one that fails backtracks
//   super-linearly (`/^(.*)\{(.*)\}$/`, two `\s*` with only an optional part between them). A regex literal or a
//   `RegExp` of a literal string is read as an automaton of its characters, and refused when two of its loops, the
//   first reaching the second, can both repeat one string (Weideman et al.'s IDA). Parts kept apart by a character
//   neither matches (`/^([^{]*)\{([^}]*)\}$/`), alternatives (`/^\s+|\s+$/`) and bounded repeats pass, as does a regex
//   too big or too unusual to read (a negative lookaround, which often keeps parts apart; a lookahead or lookbehind
//   otherwise reads as empty, a backreference as nothing). A test file (`*.test.*`, `*.spec.*`) and a file named minified
//   are not read for it: CodeQL's rule fires only on a regex run over outside input, which a test's assertion and a
//   vendored bundle never are.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";

import { MINIFIED_NAME } from "./eslint-rules/sketch-bundle-names.mjs";

export const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);
/** A test file, whose regexes run only over the test's own strings, never outside input, so CodeQL's ReDoS rule never
 * fires there. */
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

/** The characters a regex's parts are compared over: ASCII and one of each kind past it (a no-break space, É and é, the
 * line and paragraph separators, a CJK letter and a byte-order mark), each regex adding the others it names. */
const ALPHABET = [...Array.from({ length: 128 }, (_, code) => code), 0xa0, 0xc9, 0xe9, 0x2028, 0x2029, 0x4e2d, 0xfeff];
/** Bit indexes in the order an example string picks them: letters, digits, other printable ASCII, then the rest. */
const PREFERRED = [...ALPHABET.keys()].sort((a, b) => rank(ALPHABET[a]) - rank(ALPHABET[b]) || a - b);
function rank(code) {
  const char = String.fromCharCode(code);
  return /[a-z]/.test(char) ? 0 : /[A-Z]/.test(char) ? 1 : /\d/.test(char) ? 2 : code >= 0x20 && code < 0x7f ? 3 : 4;
}
const POSITIONS = 300; // a regex with more characters than this, its bounded repeats expanded, is not read
const STEPS = 2_000_000; // nor one whose search takes more steps than this
const REPEATS = 3; // a bounded repeat is expanded to at most this many copies, mandatory and optional each
const overlaps = new Map();
const memberships = new Map();

/** For a regex two of whose loops, the first reaching the second, can both repeat one string, that string; else (or
 * when the regex is invalid, too big or too unusual to read) undefined. */
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

/** ALPHABET and every other character the regex names, literally or by an escape, with its other case under `i`. */
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

/** The characters of `alphabet` one character of a regex (`a`, `\s`, `[^{]`, `.`) matches, as bits, read by the engine. */
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

/** A valid regex source as a tree: `alt` and `seq` of items, `rep` of a body (min, max), `char` of the source of one
 * character, `end` for `$` (outside multiline mode) and `empty` for any other anchor, a positive lookaround or a
 * backreference.
 * Throws on what it does not read. */
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
        const head = GROUP_HEAD.exec(source)?.[0] ?? fail(); // a modifier group, (?i:…), is not read
        if (head === "?!" || head === "?<!") fail(); // a negative lookaround often keeps parts apart, so it is not read
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
  /** Moves past an escape; true when it matches no character (\b, \B, a backreference). */
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

/** How many capturing groups a regex source opens, so `\N` past them reads as an octal escape, as the engine does. */
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

/** The position automaton (Glushkov's) of a regex tree: each character a position with the set it matches (`$` a
 * position matching only `end`, the end of the input), the positions that may follow it and those it may stop at.
 * Throws past POSITIONS. */
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

/** Two positions p ≠ q, each on a loop, p reaching q, a non-empty string w that takes p back to p, p to q and q back
 * to q, and an input that then fails from p and q: the sets of w's characters, by a search over triples of positions
 * from (p, p, q) to (p, q, q); undefined when there is none or the search runs past STEPS. */
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

const SUBSETS = 200; // an input that fails is looked for over at most this many sets of positions

/** Whether some input, read on from the positions `from`, fails the match: no prefix of it reaches a position the
 * regex may stop at, and at its end none can pass `$` and stop. Without one, the first split of a run already matches. */
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
