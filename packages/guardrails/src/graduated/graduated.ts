/**
 * Capability 4 · Graduated checks (the Guardrails story, ADR-0956 D5): the parts of quality control
 * checks that are fixed patterns, run on the files a branch changes against origin/main. It reads the
 * checkout alone and writes nothing; what it finds is its answer, which Quality assurance records in
 * the QA ledger under the check each part graduated from, since Guardrails does not reach the library.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every graduated check by name, so a check record can name only one that exists. */
export const GRADUATED_CHECKS = ["self-equal-assertion"] as const;

export type GraduatedCheck = (typeof GRADUATED_CHECKS)[number];

/** One place a graduated check trips: the check's name, the repo-relative file and the line. */
export interface Trip {
  readonly check: GraduatedCheck;
  readonly file: string;
  readonly line: number;
}

/** What the graduated checks found on a change; without a base to compare with they have not run, which is never a pass. */
export type GraduatedReport = { readonly ran: true; readonly trips: readonly Trip[] } | { readonly ran: false; readonly reason: string };

const SOURCE = /\.[cm]?[jt]sx?$/;

const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000, windowsHide: true });

/** Run every graduated check on the source files the checkout at `root` changes against origin/main, committed or not. */
export function graduatedChecks(root: string): GraduatedReport {
  let base: string;
  try {
    base = git(root, "merge-base", "origin/main", "HEAD").trim();
  } catch {
    return { ran: false, reason: "origin/main is not in this checkout (or shares no history with it), so there is no change to check." };
  }
  const changed = [git(root, "diff", "--name-only", base), git(root, "ls-files", "--others", "--exclude-standard")].join("\n");
  const files = [...new Set(changed.split("\n").filter((file) => SOURCE.test(file) && existsSync(path.join(root, file))))].sort();
  const trips = files.flatMap((file) => selfEqualAssertions(readFileSync(path.join(root, file), "utf8")).map((line) => ({ check: "self-equal-assertion" as const, file, line })));
  return { ran: true, trips };
}

/**
 * The lines where an equality assertion's two sides are the same expression, ignoring whitespace outside
 * strings: assert[.strict].equal / strictEqual / deepEqual / deepStrictEqual(a, a), or expect(a).toBe /
 * toEqual / toStrictEqual(a). Such an assertion can never fail, so it protects nothing.
 */
export function selfEqualAssertions(text: string): number[] {
  const code = mask(text);
  const lines: number[] = [];
  const lineAt = (at: number) => text.slice(0, at).split("\n").length;
  for (const head of code.matchAll(/\bassert(?:\.strict)?\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/g)) {
    const call = argsOf(code, head.index + head[0].length - 1);
    if (call !== null && call.args.length >= 2 && same(text, code, call.args[0]!, call.args[1]!)) lines.push(lineAt(head.index));
  }
  for (const head of code.matchAll(/\bexpect\s*\(/g)) {
    const subject = argsOf(code, head.index + head[0].length - 1);
    if (subject === null || subject.args.length !== 1) continue;
    const matcher = /^\s*\.(?:toBe|toEqual|toStrictEqual)\s*\(/.exec(code.slice(subject.end));
    if (matcher === null) continue;
    const expected = argsOf(code, subject.end + matcher[0].length - 1);
    if (expected !== null && expected.args.length === 1 && same(text, code, subject.args[0]!, expected.args[0]!)) lines.push(lineAt(head.index));
  }
  return [...new Set(lines)].sort((a, b) => a - b);
}

type Span = readonly [start: number, end: number];

/** `text` with every string's and comment's characters but newlines turned to "_", so only code is left to match. */
function mask(text: string): string {
  const out = [...text];
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = "_";
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const to = end === -1 ? text.length : end;
      blank(i, to);
      i = to;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const to = end === -1 ? text.length : end + 2;
      blank(i, to);
      i = to;
    } else if (c === '"' || c === "'" || c === "`") {
      let k = i + 1;
      while (k < text.length && text[k] !== c) k += text[k] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(k, text.length));
      i = k + 1;
    } else i++;
  }
  return out.join("");
}

/** The top-level arguments of the call whose "(" is at `open` in masked `code`, and where it ends; null when it never closes. */
function argsOf(code: string, open: number): { args: Span[]; end: number } | null {
  const args: Span[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        if (code.slice(start, i).trim() !== "") args.push([start, i]);
        return { args, end: i + 1 };
      }
      depth--;
    } else if (c === "," && depth === 0) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/** Whether two spans hold the same expression once whitespace outside strings is dropped. */
function same(text: string, code: string, a: Span, b: Span): boolean {
  const squeeze = ([from, to]: Span) => {
    let out = "";
    for (let i = from; i < to; i++) if (!/\s/.test(code[i]!)) out += text[i];
    return out;
  };
  const left = squeeze(a);
  return left !== "" && left === squeeze(b);
}
