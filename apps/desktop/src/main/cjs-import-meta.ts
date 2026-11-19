// Capability 4 · Updates
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "@babel/parser";
import { build, type BuildOptions } from "esbuild";

export interface ImportMetaHazard {
  file: string;
  line: number;
  text: string;
}

interface Syntax {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number } };
  [key: string]: unknown;
}

const CHECKOUT_ONLY_SITES_NEVER_IN_THE_PACKAGED_APP = [
  { file: path.join("packages", "app-setup", "src", "setup", "built-from-main.ts"), functions: ["buildBins", "linkEmbeddingRuntime"] },
  { file: path.join("packages", "mark", "src", "icons.ts"), functions: ["iconPath"] },
];

const READS = new Set(["url", "dirname", "filename"]);
const TAKERS = new Set(["fileURLToPath", "createRequire"]);

const isSyntax = (value: unknown): value is Syntax => typeof value === "object" && value !== null && typeof (value as Syntax).type === "string";

const isImportMeta = (node: unknown): boolean =>
  isSyntax(node) && node.type === "MetaProperty" && (node.meta as Syntax & { name: string }).name === "import" && (node.property as Syntax & { name: string }).name === "meta";

const propertyName = (node: Syntax): string | undefined => {
  const property = node.property as Syntax & { name?: string; value?: string };
  return node.computed ? property.value : property.name;
};

const isMetaMember = (node: unknown, names: Set<string>): node is Syntax =>
  isSyntax(node) && node.type === "MemberExpression" && isImportMeta(node.object) && names.has(propertyName(node) ?? "");

const unwrap = (node: Syntax): Syntax =>
  ["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(node.type) ? unwrap(node.expression as Syntax) : node;

function takesPathOrUrl(call: Syntax): boolean {
  const callee = unwrap(call.callee as Syntax);
  if (call.type === "NewExpression") return callee.type === "Identifier" && callee.name === "URL";
  if (callee.type === "Identifier") return TAKERS.has(callee.name as string);
  if (callee.type !== "MemberExpression") return false;
  const object = unwrap(callee.object as Syntax);
  return TAKERS.has(propertyName(callee) ?? "") || (object.type === "Identifier" && object.name === "path");
}

function mentionsImportMeta(node: unknown): boolean {
  if (isImportMeta(node)) return true;
  if (Array.isArray(node)) return node.some(mentionsImportMeta);
  if (!isSyntax(node)) return false;
  return Object.entries(node).some(([key, value]) => key !== "loc" && typeof value === "object" && mentionsImportMeta(value));
}

function guarded(node: Syntax, ancestors: Syntax[]): boolean {
  let inner = node;
  for (let at = ancestors.length - 1; at >= 0; at -= 1) {
    const outer = ancestors[at]!;
    if ((outer.type === "ConditionalExpression" || outer.type === "IfStatement") && outer.test !== inner && mentionsImportMeta(outer.test)) return true;
    if (outer.type === "LogicalExpression" && outer.right === inner && mentionsImportMeta(outer.left)) return true;
    inner = outer;
  }
  return false;
}

function functionName(node: Syntax, parent: Syntax | undefined): string | undefined {
  if (node.type === "FunctionDeclaration") return (node.id as Syntax | null)?.name as string | undefined;
  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    if (parent?.type === "VariableDeclarator") return (parent.id as Syntax).name as string | undefined;
    return (node.id as Syntax | null)?.name as string | undefined;
  }
  if (node.type === "ObjectMethod" || node.type === "ClassMethod") return (node.key as Syntax).name as string | undefined;
  return undefined;
}

function enclosingFunction(ancestors: Syntax[]): string | undefined {
  for (let at = ancestors.length - 1; at >= 0; at -= 1) {
    const name = functionName(ancestors[at]!, ancestors[at - 1]);
    if (name !== undefined) return name;
  }
  return undefined;
}

function exempt(file: string, ancestors: Syntax[]): boolean {
  const name = enclosingFunction(ancestors);
  return CHECKOUT_ONLY_SITES_NEVER_IN_THE_PACKAGED_APP.some((site) => file.endsWith(path.sep + site.file) && name !== undefined && site.functions.includes(name));
}

function hazardsIn(file: string, source: string): ImportMetaHazard[] {
  const tree = parse(source, { sourceType: "module", plugins: /\.[cm]?[jt]sx$/.test(file) ? ["typescript", "jsx"] : ["typescript"] });
  const found: ImportMetaHazard[] = [];
  const report = (node: Syntax, ancestors: Syntax[]) => {
    if (guarded(node, ancestors) || exempt(file, ancestors)) return;
    found.push({ file, line: node.loc.start.line, text: source.slice(node.start, node.end) });
  };
  const visit = (node: Syntax, ancestors: Syntax[]) => {
    if (node.type === "CallExpression" && isMetaMember(node.callee, new Set(["resolve"]))) report(node, ancestors);
    if ((node.type === "CallExpression" || node.type === "NewExpression") && takesPathOrUrl(node)) {
      for (const argument of node.arguments as Syntax[]) {
        if (isMetaMember(unwrap(argument), READS)) report(argument, [...ancestors, node]);
      }
    }
    const inside = [...ancestors, node];
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      for (const child of Array.isArray(value) ? value : [value]) if (isSyntax(child)) visit(child, inside);
    }
  };
  visit(tree.program as unknown as Syntax, []);
  return found;
}

async function importMetaFiles(options: BuildOptions): Promise<string[]> {
  const result = await build({
    ...options,
    write: false,
    logLevel: "silent",
    logOverride: { ...options.logOverride, "empty-import-meta": "warning" },
  });
  const base = options.absWorkingDir ?? process.cwd();
  return result.warnings
    .filter((warning) => warning.id === "empty-import-meta" && warning.location !== null)
    .map((warning) => path.resolve(base, warning.location!.file))
    .filter((file) => !file.split(path.sep).includes("node_modules"));
}

export async function importMetaHazards(builds: BuildOptions[]): Promise<ImportMetaHazard[]> {
  const files = [...new Set((await Promise.all(builds.map(importMetaFiles))).flat())].sort();
  const found = await Promise.all(files.map(async (file) => hazardsIn(file, await readFile(file, "utf8"))));
  return found.flat();
}
