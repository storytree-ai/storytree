/**
 * Capability 1 · Base structure measures. Each function's cognitive complexity by SonarSource's rules (G. Ann Campbell,
 * 2017, as eslint-plugin-sonarjs implements them) and its length, and a story's tails over them (contract 1.2, B2 and B3).
 *
 * - +1 for each if, else if, else, conditional, switch, loop (for, for-in, for-of, while, do), catch, labelled break or
 *   continue, each sequence of like logical operators, and each direct recursive call.
 * - If, conditional, switch, loops and catch add one more per level of nesting; else, else if and logical sequences
 *   take none. Nesting rises inside those structures' bodies.
 * - Every function is listed and scored on its own from nesting 0, a nested one (a callback, an inner arrow) included,
 *   as eslint-plugin-sonarjs scores them: the function enclosing it counts none of its structures.
 */
import { childrenOf, linesOf, parsed, sourcesOf, type Node, type SourceText } from "./source.js";

/** One listed function: its name, its first line, its score, and its length in non-blank, non-comment lines. */
export interface FunctionReading {
  readonly name: string;
  readonly line: number;
  readonly complexity: number;
  readonly length: number;
}

/** A story's complexity and length tails (B2, B3). */
export interface ComplexityReading {
  readonly functions: number;
  /** The functions' scores at the 90th percentile by nearest rank, and their max; none with no functions. */
  readonly p90: number | null;
  readonly max: number | null;
  /** The scores' sum per 1,000 source lines. */
  readonly per1000: number;
  readonly lengthP90: number | null;
  readonly lengthMax: number | null;
  /** The longest source file by non-blank, non-comment lines. */
  readonly longestFile: { readonly path: string; readonly lines: number } | null;
}

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const LOGICAL = new Set(["&&", "||", "??"]);

const isFunction = (node: Node): boolean => FUNCTIONS.has(node.type) && node.body !== undefined && node.body !== null;

/** A property key's name: an identifier, a private name, or a literal. */
function keyName(key: unknown): string | undefined {
  const node = key as Node | undefined;
  if (node?.type === "Identifier") return node.name as string;
  if (node?.type === "PrivateName") return `#${(node.id as Node).name as string}`;
  if (node?.type === "StringLiteral" || node?.type === "NumericLiteral") return String(node.value);
  return undefined;
}

/** What a listed function is called: its own name, the name it is assigned to, or its class and key. */
function nameOf(fn: Node, parent: Node | undefined, className: string | undefined): string {
  if (fn.type === "ClassMethod" || fn.type === "ClassPrivateMethod" || fn.type === "ObjectMethod") {
    const key = keyName(fn.key) ?? "<computed>";
    return className === undefined ? key : `${className}.${key}`;
  }
  const own = (fn.id as Node | null | undefined)?.name as string | undefined;
  if (own !== undefined) return own;
  if (parent?.type === "VariableDeclarator") return keyName(parent.id) ?? "<anonymous>";
  if (parent?.type === "AssignmentExpression") return keyName(parent.left) ?? keyName((parent.left as Node).property) ?? "<anonymous>";
  if (parent?.type === "CallExpression" || parent?.type === "NewExpression") {
    const callee = parent.callee as Node;
    const called = keyName(callee) ?? keyName(callee.property);
    return called === undefined ? "<anonymous>" : `<callback of ${called}>`;
  }
  if (parent?.type === "ObjectProperty" || parent?.type === "ClassProperty" || parent?.type === "ClassPrivateProperty") {
    const key = keyName(parent.key) ?? "<computed>";
    return parent.type === "ObjectProperty" || className === undefined ? key : `${className}.${key}`;
  }
  return "<anonymous>";
}

/** The scorer of one listed function: its own name, for recursion, and its running total. */
class Scorer {
  total = 0;
  constructor(private readonly name: string) {}

  node(node: Node, nesting: number): void {
    switch (node.type) {
      case "IfStatement":
        return this.if(node, nesting, false);
      case "ConditionalExpression":
        this.total += 1 + nesting;
        this.node(node.test as Node, nesting);
        this.node(node.consequent as Node, nesting + 1);
        return this.node(node.alternate as Node, nesting + 1);
      case "SwitchStatement":
        this.total += 1 + nesting;
        this.node(node.discriminant as Node, nesting);
        for (const one of node.cases as Node[]) this.node(one, nesting + 1);
        return;
      case "CatchClause":
        this.total += 1 + nesting;
        if (node.param) this.node(node.param as Node, nesting);
        return this.node(node.body as Node, nesting + 1);
      case "BreakStatement":
      case "ContinueStatement":
        if (node.label) this.total += 1;
        return;
      case "LogicalExpression":
        return this.logical(node, nesting);
      case "CallExpression": {
        const callee = node.callee as Node;
        if (callee.type === "Identifier" && callee.name === this.name) this.total += 1;
        break;
      }
    }
    if (LOOPS.has(node.type)) {
      this.total += 1 + nesting;
      for (const child of childrenOf(node)) this.node(child, child === node.body ? nesting + 1 : nesting);
      return;
    }
    if (isFunction(node)) return; // scored on its own
    for (const child of childrenOf(node)) this.node(child, nesting);
  }

  /** An if, or an else if (no nesting increment), with its else. */
  private if(node: Node, nesting: number, elseIf: boolean): void {
    this.total += elseIf ? 1 : 1 + nesting;
    this.node(node.test as Node, nesting);
    this.node(node.consequent as Node, nesting + 1);
    const alternate = node.alternate as Node | null | undefined;
    if (alternate === null || alternate === undefined) return;
    if (alternate.type === "IfStatement") return this.if(alternate, nesting, true);
    this.total += 1;
    this.node(alternate, nesting + 1);
  }

  /** A run of logical operators read left to right: +1 for its first operator and for each change of operator. */
  private logical(node: Node, nesting: number): void {
    if (!LOGICAL.has(node.operator as string)) {
      for (const child of childrenOf(node)) this.node(child, nesting);
      return;
    }
    const operators: string[] = [];
    const operands: Node[] = [];
    const flatten = (part: Node): void => {
      if (part.type === "LogicalExpression" && LOGICAL.has(part.operator as string)) {
        flatten(part.left as Node);
        operators.push(part.operator as string);
        flatten(part.right as Node);
      } else operands.push(part);
    };
    flatten(node);
    this.total += operators.filter((operator, index) => index === 0 || operator !== operators[index - 1]).length;
    for (const operand of operands) this.node(operand, nesting);
  }
}

/** Every function in `file`, nested ones included, with its line, its cognitive complexity and its length. */
export function functionsOf(file: SourceText): FunctionReading[] {
  const { program, codeLines } = parsed(file);
  const found: FunctionReading[] = [];
  const visit = (node: Node, parent: Node | undefined, className: string | undefined): void => {
    if (isFunction(node)) {
      const name = nameOf(node, parent, className);
      const scorer = new Scorer(name);
      for (const child of childrenOf(node)) scorer.node(child, 0);
      const start = node.loc!.start.line;
      const end = node.loc!.end.line;
      let length = 0;
      for (let line = start; line <= end; line++) if (codeLines.has(line)) length++;
      found.push({ name, line: start, complexity: scorer.total, length });
      for (const child of childrenOf(node)) visit(child, node, className);
      return;
    }
    const inClass = node.type === "ClassDeclaration" || node.type === "ClassExpression" ? keyName(node.id) : className;
    for (const child of childrenOf(node)) visit(child, node, inClass);
  };
  if (program !== undefined) visit(program, undefined, undefined);
  return found;
}

/** The value at the 90th percentile of `values` by nearest rank, or none. */
export function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1]!;
}

const maxOf = (values: readonly number[]): number | null => (values.length === 0 ? null : Math.max(...values));

/** The complexity and length tails of `files`' source functions, and their longest source file (B2, B3); tests are not read. */
export function complexityOf(files: readonly SourceText[]): ComplexityReading {
  const sources = sourcesOf(files);
  const functions = sources.flatMap(functionsOf);
  const scores = functions.map((fn) => fn.complexity);
  const lengths = functions.map((fn) => fn.length);
  let lines = 0;
  let longestFile: ComplexityReading["longestFile"] = null;
  for (const file of sources) {
    const own = linesOf(file);
    lines += own;
    if (longestFile === null || own > longestFile.lines) longestFile = { path: file.path, lines: own };
  }
  const sum = scores.reduce((total, score) => total + score, 0);
  return { functions: functions.length, p90: p90(scores), max: maxOf(scores), per1000: lines === 0 ? 0 : (sum * 1000) / lines, lengthP90: p90(lengths), lengthMax: maxOf(lengths), longestFile };
}
