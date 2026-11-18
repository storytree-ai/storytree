// Capability 1 · Base structure measures
import { parse } from "@babel/parser";

export interface SourceText {
  readonly path: string;
  readonly text: string;
}

export type FileKind = "source" | "test" | "out";

export interface Size {
  readonly files: number;
  readonly sourceLines: number;
  readonly testLines: number;
  readonly commentLines: number;
  readonly commentShare: number;
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUPPORT = /(?:^|\/)testing\//;
const GENERATED_NAME = /\.gen\.[cm]?[jt]sx?$/;
function leadingComments(text: string): string | undefined {
  let at = text.startsWith("#!") ? (text.indexOf("\n") + 1 || text.length) : 0;
  let end = -1;
  for (;;) {
    let next = at;
    while (next < text.length && /\s/.test(text[next]!)) next += 1;
    if (text.startsWith("//", next)) {
      const line = text.indexOf("\n", next);
      at = line < 0 ? text.length : line;
    } else if (text.startsWith("/*", next)) {
      const close = text.indexOf("*/", next + 2);
      if (close < 0) break;
      at = close + 2;
    } else break;
    end = at;
  }
  return end < 0 ? undefined : text.slice(0, end);
}
const GENERATED_MARK = /@generated\b|\bdo not edit\b|\b(?:code|file|is) (?:auto-?)?generated\b|\bauto-?generated\b/i;

export function kindOf(file: SourceText): FileKind {
  if (!CODE_FILE.test(file.path) || DECLARATION.test(file.path) || GENERATED_NAME.test(file.path)) return "out";
  if (TEST_FILE.test(file.path) || TEST_SUPPORT.test(file.path)) return "test";
  const leading = leadingComments(file.text);
  return leading !== undefined && GENERATED_MARK.test(leading) ? "out" : "source";
}

export interface Token {
  readonly type: string | { readonly label: string };
  readonly value?: unknown;
  readonly loc: { readonly start: { readonly line: number }; readonly end: { readonly line: number } };
}

export interface Node {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number }; readonly end: { readonly line: number } };
  readonly [key: string]: unknown;
}

export interface Parsed {
  readonly program: Node | undefined;
  readonly tokens: readonly Token[];
  readonly comments: readonly { readonly value: string; readonly loc: Token["loc"] }[];
  readonly codeLines: ReadonlySet<number>;
  readonly commentLines: ReadonlySet<number>;
}

const PARSED = new WeakMap<SourceText, Parsed>();

const isComment = (token: Token): boolean => token.type === "CommentLine" || token.type === "CommentBlock";

export const labelOf = (token: Token): string => (typeof token.type === "string" ? token.type : token.type.label);

export function parsed(file: SourceText): Parsed {
  const kept = PARSED.get(file);
  if (kept !== undefined) return kept;
  const lines = file.text.split("\n");
  const blank = (line: number) => (lines[line - 1] ?? "").trim() === "";
  let reading: Parsed;
  try {
    const jsx = /\.[jt]sx$/.test(file.path) || /\.js$/.test(file.path);
    const ast = parse(file.text, {
      sourceType: "module",
      plugins: jsx ? ["typescript", "jsx"] : ["typescript"],
      tokens: true,
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowUndeclaredExports: true,
    }) as unknown as { program: Node; tokens: Token[]; comments: Parsed["comments"] };
    const codeLines = new Set<number>();
    const touched = new Set<number>();
    const tokens: Token[] = [];
    for (const token of ast.tokens) {
      const label = labelOf(token);
      if (label === "eof") continue;
      if (isComment(token)) {
        for (let line = token.loc.start.line; line <= token.loc.end.line; line++) if (!blank(line)) touched.add(line);
        continue;
      }
      if (label === "jsxText" && String(token.value).trim() === "") continue;
      tokens.push(token);
      for (let line = token.loc.start.line; line <= token.loc.end.line; line++) if (!blank(line)) codeLines.add(line);
    }
    reading = { program: ast.program, tokens, comments: ast.comments, codeLines, commentLines: new Set([...touched].filter((line) => !codeLines.has(line))) };
  } catch {
    const codeLines = new Set(lines.map((_, index) => index + 1).filter((line) => !blank(line)));
    reading = { program: undefined, tokens: [], comments: [], codeLines, commentLines: new Set() };
  }
  PARSED.set(file, reading);
  return reading;
}

export const sourcesOf = (files: readonly SourceText[]): SourceText[] => files.filter((file) => kindOf(file) === "source");

export const linesOf = (file: SourceText): number => parsed(file).codeLines.size;

export function sizeOf(files: readonly SourceText[]): Size {
  let count = 0;
  let sourceLines = 0;
  let testLines = 0;
  let commentLines = 0;
  for (const file of files) {
    const kind = kindOf(file);
    if (kind === "test") testLines += linesOf(file);
    if (kind !== "source") continue;
    count++;
    sourceLines += linesOf(file);
    commentLines += parsed(file).commentLines.size;
  }
  return { files: count, sourceLines, testLines, commentLines, commentShare: sourceLines === 0 ? 0 : commentLines / sourceLines };
}

export function* childrenOf(node: Node): Generator<Node> {
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) yield item;
    } else if (isNode(value)) yield value;
  }
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

export function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of childrenOf(node)) yield* walk(child);
}
