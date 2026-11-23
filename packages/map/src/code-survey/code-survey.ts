// Capability 8 · Code survey
import { parse } from "@babel/parser";

import type { CodeEdge, EdgeFile, StorySurvey, SurveyedFile, SurveyedTest } from "@storytree/library";

import type { Edge, LanguageReader, SourceFile, SurveyPackage } from "./language-reader.js";
import { ALSO_OWNED, packageOf, packagesOf } from "./package-of.js";
import { pythonReader } from "./python-reader.js";
import { aliasTargets } from "./tsconfig.js";

export { ALSO_OWNED, packageOf, packagesOf };
export type { LanguageReader, SourceFile, SurveyPackage };

const ownPrefix = (named: string | undefined, own: string | readonly string[] | undefined): boolean =>
  named === undefined || (typeof own === "string" ? named === own : own?.includes(named) === true);

export type SurveyCapability = { readonly id: string; readonly title: string };

export type CoverageMap = Readonly<Record<string, Readonly<Record<string, number>>>>;

const EXECUTED = 0.5;

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUPPORT = /(?:^|\/)testing\//;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const NUMBERED_TITLE = /^(?:([a-z][a-z0-9-]*)\s+)?(\d+)\.\d+\b/;
const IMPORT = /\b(import|export)\s+(type\s+)?(?:([^\s;'"`](?:[^;'"`]*[^\s;'"`])?)\s*)?\bfrom\s*["']([^"']+)["']|\bimport\s*(?:\(\s*)?["']([^"']+)["']/g;

const BY_TYPES = 1000;

const numberOf = (title: string): number | undefined => {
  const match = /^\s*(\d+)\s*·/.exec(title);
  return match === null ? undefined : Number(match[1]);
};

const SPACE = /\s/;
const spaceBefore = (code: string, at: number): number => {
  while (at > 0 && SPACE.test(code[at - 1]!)) at -= 1;
  return at;
};
const followsCall = (code: string, at: number): boolean => {
  const paren = spaceBefore(code, at) - 1;
  if (code[paren] !== "(") return false;
  const callee = spaceBefore(code, paren) - 1;
  return callee >= 0 && /[\w$.]/.test(code[callee]!);
};
const constantBefore = (code: string, at: number): string | undefined => {
  const equals = spaceBefore(code, at) - 1;
  if (code[equals] !== "=") return undefined;
  const end = spaceBefore(code, equals);
  let start = end;
  while (start > 0 && /[\w$]/.test(code[start - 1]!)) start -= 1;
  const keyword = spaceBefore(code, start);
  if (start === end || /\d/.test(code[start]!) || keyword === start || keyword < 5 || code.slice(keyword - 5, keyword) !== "const") return undefined;
  return keyword === 5 || !/\w/.test(code[keyword - 6]!) ? code.slice(start, end) : undefined;
};

function calledTitles(file: SourceFile): readonly string[] {
  let text = "";
  let kept = 0;
  for (const token of syntaxOf(file, true)?.tokens ?? []) {
    if (typeof token.type === "string" || token.type.label !== "regexp") continue;
    text += file.text.slice(kept, token.start) + file.text.slice(token.start, token.end).replace(/[^\r\n]/g, " ");
    kept = token.end;
  }
  text += file.text.slice(kept);
  const strings: { at: number; quote: string; value: string }[] = [];
  const code = text.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (token: string, quote: string | undefined, at: number) => {
    if (quote !== undefined) strings.push({ at, quote, value: token.slice(1, -1) });
    return token.replace(/[^\r\n]/g, " ");
  });
  const constants = new Map<string, string>();
  for (const { at, value } of strings) {
    const name = constantBefore(code, at);
    if (name !== undefined) constants.set(name, value);
  }
  const titles: { at: number; title: string }[] = [];
  for (const { at, quote, value } of strings) {
    if (!followsCall(code, at)) continue;
    const template = quote === "`" ? /^\$\{\s*([A-Za-z_$][\w$]*)\s*\}([\s\S]*)$/.exec(value) : null;
    const prefix = template === null ? undefined : constants.get(template[1]!);
    const title = template === null ? value : prefix === undefined ? undefined : prefix + template[2];
    if (title !== undefined) titles.push({ at, title });
  }
  for (const call of code.matchAll(/[\w$.]\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    const title = constants.get(call[1]!);
    if (title !== undefined) titles.push({ at: call.index, title });
  }
  return titles.sort((a, b) => a.at - b.at).map(({ title }) => title);
}

const TITLE_PROOF_BUDGET = 256;
const FILE_PROOF_BUDGET = 4096;

function proofTitles(titles: readonly string[]): SurveyedTest["titles"] {
  let remaining = FILE_PROOF_BUDGET;
  return titles.flatMap(title => {
    const lead = /^(?:([a-z][a-z0-9-]*)\s+)?(\d+\.\d+(?:–\d+\.\d+)?(?:(?:\s*[,/]\s*|\s+and\s+)\d+\.\d+(?:–\d+\.\d+)?)*):?(?=\s|$)/.exec(title!);
    if (!lead) return [];
    const ranges: { first: string; capability: string; start: number; width: number }[] = [];
    let count = 0;
    for (const [, first, last] of lead[2]!.matchAll(/(?<!\d)(\d+\.\d+)(?:–(\d+\.\d+))?/g)) {
      const [capability, start] = first!.split(".");
      const [endCapability, end] = (last ?? first!).split(".");
      if (capability !== endCapability || !Number.isSafeInteger(Number(capability)) || !Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end)) || Number(end) < Number(start)) return [];
      const width = Number(end) - Number(start) + 1;
      count += width;
      if (count > TITLE_PROOF_BUDGET || count > remaining) return [];
      ranges.push({ first: first!, capability: capability!, start: Number(start), width });
    }
    remaining -= count;
    const numbers = new Set<string>();
    for (const { first, capability, start, width } of ranges) {
      numbers.add(first);
      for (let offset = 1; offset < width; offset++) numbers.add(`${capability}.${start + offset}`);
    }
    return [...numbers].map(number => ({ number, title: title!, ...(lead[1] === undefined ? {} : { package: lead[1] }) }));
  });
}

const DECLARED = /^(?:#![^\n]*\n)?\s*\/[/*][\s*]*Capability\s+(\d+)\s*·([^\n]*)/;

export const declarationOf = (text: string): { number: number; title: string } | undefined => {
  const match = DECLARED.exec(text);
  return match === null ? undefined : { number: Number(match[1]), title: match[2]!.replace(/^[ \t]+/, "") };
};

export const declaresTitle = (file: SourceFile, title: string): boolean => {
  const named = readerOf(file.path)?.declarationOf(file.text)?.title.toLowerCase();
  const own = title.replace(/^\s*\d+\s*·\s*/, "").toLowerCase();
  return named !== undefined && named.startsWith(own);
};

export function declaredNumberOf(file: SourceFile, ownPackage?: string | readonly string[]): number | undefined {
  if (!isCodeFile(file.path)) return undefined;
  const reader = readerOf(file.path)!;
  if (!reader.tests.test(file.path)) return reader.declarationOf(file.text)?.number;
  const numbers = new Set(reader.titlesOf(file).flatMap((title) => {
    const named = NUMBERED_TITLE.exec(title);
    return named === null || !ownPrefix(named[1], ownPackage) ? [] : [Number(named[2])];
  }));
  return numbers.size === 1 ? [...numbers][0] : undefined;
}

const linesOf = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;

function resolve(from: string, specifier: string, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): string | undefined {
  if (!/^\.{1,2}\//.test(specifier)) {
    const own = packages.filter(pkg => from.startsWith(pkg.root)).sort((a, b) => b.root.length - a.root.length)[0];
    if (own === undefined) return undefined;
    if (specifier.startsWith("#")) {
      const target = own.imports?.[specifier];
      return target === undefined ? undefined : resolve(own.root + "package.json", target, paths, []);
    }
    const named = packages.filter(pkg => specifier === pkg.name || specifier.startsWith(pkg.name + "/")).sort((a, b) => b.name.length - a.name.length)[0];
    if (named !== undefined) {
      const subpath = specifier === named.name ? "." : "." + specifier.slice(named.name.length);
      const at = (target: string) => resolve(named.root + "package.json", target, paths, []);
      if (Object.keys(named.exports).length > 0) return named.exports[subpath] === undefined ? undefined : at(named.exports[subpath]);
      if (subpath !== ".") return at(subpath);
      return (named.main === undefined ? undefined : at(`./${named.main.replace(/^\.\//, "")}`)) ?? at("./index");
    }
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ".";
    const nearest = packages.flatMap(pkg => pkg.tsconfigs ?? []).filter(config => config.dir === "." || dir === config.dir || dir.startsWith(config.dir + "/"))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    for (const target of aliasTargets(specifier, nearest?.aliases ?? [])) {
      const found = fileAt(target, paths);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return fileAt(parts.join("/"), paths);
}

function fileAt(target: string, paths: ReadonlySet<string>): string | undefined {
  const stem = target.replace(/\.[cm]?jsx?$/, "");
  return [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${target}/index.ts`, `${target}/index.tsx`, `${target}/index.js`].find((candidate) => paths.has(candidate));
}

function namesOf(clause: string): Edge["names"] {
  if (clause.includes("*") || clause.trim() === "") return "all";
  const braces = /^[^{]*\{([^}]*)\}/.exec(clause);
  if (braces === null) return [["default", "default"]];
  return braces[1]!.split(",").map((part) => part.trim().replace(/^type\s+/, "")).filter((part) => part !== "").map((part) => {
    const [name, as] = part.split(/(?<!\s)\s+as\s+/);
    return [name!.trim(), (as ?? name!).trim()] as const;
  });
}

const importSyntax = new WeakMap<SourceFile, readonly RegExpExecArray[]>();

function syntaxOf(file: SourceFile, tokens = false): ReturnType<typeof parse> | undefined {
  let text = file.text;
  for (;;) {
    try {
      return parse(text, {
        sourceType: "unambiguous", errorRecovery: true, allowUndeclaredExports: true,
        createImportExpressions: true, attachComment: false, tokens,
        plugins: ["decorators-legacy", ...(/\.[cm]?tsx?$/.test(file.path) ? ["typescript" as const] : []), ...(/\.[jt]sx$/.test(file.path) ? ["jsx" as const] : [])],
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const at = (error as SyntaxError & { pos?: number }).pos ?? text.length;
      const end = Math.max(text.lastIndexOf("\n", at - 1), text.lastIndexOf(";", at - 1));
      if (end < 0) return undefined;
      text = text.slice(0, end);
    }
  }
}

function importsOf(file: SourceFile): readonly RegExpExecArray[] {
  const cached = importSyntax.get(file);
  if (cached !== undefined) return cached;
  const syntax = syntaxOf(file);
  const starts: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as { type: string; start?: number; source?: unknown };
    if (node.start !== undefined && (node.type === "ImportDeclaration" || node.type === "ImportExpression" || node.type === "TSImportType"
      || ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source))) starts.push(node.start);
    Object.values(value).forEach(visit);
  };
  visit(syntax?.program);
  let text = file.text;
  for (const comment of [...syntax?.comments ?? []].reverse()) {
    text = text.slice(0, comment.start) + text.slice(comment.start, comment.end).replace(/[^\r\n]/g, " ") + text.slice(comment.end);
  }
  const pattern = new RegExp(IMPORT.source, "y");
  const imports = starts.sort((a, b) => a - b).flatMap(at => {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    return match === null ? [] : [match];
  });
  importSyntax.set(file, imports);
  return imports;
}

const requireSyntax = new WeakMap<SourceFile, readonly string[]>();

function requiresOf(file: SourceFile): readonly string[] {
  const cached = requireSyntax.get(file);
  if (cached !== undefined) return cached;
  const specifiers: string[] = [];
  if (/\brequire\s*\(/.test(file.text)) {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (value === null || typeof value !== "object" || !("type" in value)) return;
      const node = value as { type: string; callee?: { type: string; name?: string }; arguments?: { type: string; value?: unknown }[] };
      const [first] = node.arguments ?? [];
      if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require" && node.arguments?.length === 1
        && first?.type === "StringLiteral" && typeof first.value === "string") specifiers.push(first.value);
      Object.values(value).forEach(visit);
    };
    visit(syntaxOf(file)?.program);
  }
  requireSyntax.set(file, specifiers);
  return specifiers;
}

const entrySyntax = new WeakMap<SourceFile, readonly string[]>();

function entryPointsOf(file: SourceFile): readonly string[] {
  const cached = entrySyntax.get(file);
  if (cached !== undefined) return cached;
  const specifiers: string[] = [];
  type Node = { type: string; key?: Node; name?: string; value?: unknown; callee?: Node; arguments?: Node[]; object?: Node; property?: Node; meta?: Node };
  const urlOf = (node: Node): string | undefined => {
    const [first, base] = node.arguments ?? [];
    return node.type === "NewExpression" && node.callee?.type === "Identifier" && node.callee.name === "URL" && first?.type === "StringLiteral"
      && typeof first.value === "string" && /^\.{1,2}\//.test(first.value) && base?.type === "MemberExpression" && base.object?.type === "MetaProperty"
      && base.property?.name === "url" ? first.value : undefined;
  };
  const visit = (value: unknown, entry: boolean): void => {
    if (Array.isArray(value)) { value.forEach((one) => visit(one, entry)); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as Node;
    const url = entry ? urlOf(node) : undefined;
    if (url !== undefined) specifiers.push(url);
    const opens = node.type === "ObjectProperty" && (node.key?.name === "entryPoints" || node.key?.value === "entryPoints");
    for (const [key, child] of Object.entries(value)) visit(child, entry || (opens && key === "value"));
  };
  if (TEST_FILE.test(file.path) && file.text.includes("entryPoints")) visit(syntaxOf(file)?.program, false);
  entrySyntax.set(file, specifiers);
  return specifiers;
}

export function specifiersOf(file: SourceFile): string[] {
  return [...importsOf(file).map((match) => match[4] ?? match[5]!), ...requiresOf(file)];
}

function edgesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[] {
  const imports = importsOf(file).flatMap((match): Edge[] => {
    const to = resolve(file.path, match[4] ?? match[5]!, paths, packages);
    if (to === undefined) return [];
    return [{ to, reexport: match[1] === "export", typeOnly: match[2] !== undefined, names: match[5] !== undefined ? "all" : namesOf(match[3] ?? "") }];
  });
  const requires = requiresOf(file).flatMap((specifier): Edge[] => {
    const to = resolve(file.path, specifier, paths, packages);
    return to === undefined ? [] : [{ to, reexport: false, typeOnly: false, names: "all" }];
  });
  const entries = entryPointsOf(file).flatMap((specifier): Edge[] => {
    const to = resolve(file.path, specifier, paths, packages);
    return to === undefined ? [] : [{ to, reexport: false, typeOnly: false, names: "all" }];
  });
  return [...imports, ...requires, ...entries];
}

const registersTests = (file: SourceFile): boolean =>
  importsOf(file).some((match) => match[2] === undefined && (match[4] ?? match[5]) === "node:test") || requiresOf(file).includes("node:test");

const javascriptReader: LanguageReader = {
  files: CODE_FILE, declarations: DECLARATION, tests: TEST_FILE, testSupport: TEST_SUPPORT,
  titlesOf: calledTitles, edgesOf, registersTests, declarationOf,
};

const READERS: readonly LanguageReader[] = [javascriptReader, pythonReader];

const readerOf = (path: string): LanguageReader | undefined => READERS.find((reader) => reader.files.test(path));

export async function readersReady(paths: Iterable<string>): Promise<void> {
  const readers = new Set<LanguageReader>();
  for (const path of paths) {
    const reader = readerOf(path);
    if (reader?.ready !== undefined) readers.add(reader);
  }
  await Promise.all([...readers].map((reader) => reader.ready!()));
}

export const readsFile = (path: string): boolean => readerOf(path) !== undefined;

export const isCodeFile = (path: string): boolean => {
  const reader = readerOf(path);
  return reader !== undefined && reader.declarations?.test(path) !== true;
};

export const isTestFile = (path: string): boolean => readerOf(path)?.tests.test(path) === true;

export const isTestCode = (file: SourceFile): boolean => file.testSupport === true || isTestFile(file.path) || readerOf(file.path)?.testSupport.test(file.path) === true;

const edgesFrom = (file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[] => readerOf(file.path)?.edgesOf(file, paths, packages) ?? [];

export function dependenciesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): string[] {
  return edgesFrom(file, paths, packages).map(edge => edge.to);
}

function reached(test: SourceFile, byPath: ReadonlyMap<string, SourceFile>, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Map<string, number> {
  type Step = { readonly path: string; readonly wanted: readonly string[] | "all"; readonly depth: number };
  const taken = new Map<string, { readonly depth: number; names: Set<string> | "all" }>();
  const queue: Step[] = edgesFrom(test, paths, packages).filter((edge) => !edge.typeOnly && !edge.reexport).map((edge) => ({ path: edge.to, wanted: edge.names === "all" ? "all" : edge.names.map(([name]) => name), depth: 0 }));
  for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
    const file = byPath.get(step.path);
    if (file === undefined || isTestFile(step.path)) continue;
    const before = taken.get(step.path);
    if (before?.names === "all") continue;
    const fresh = step.wanted === "all" ? "all" : step.wanted.filter((name) => before === undefined || !(before.names as Set<string>).has(name));
    if (before !== undefined && fresh !== "all" && fresh.length === 0) continue;
    if (before === undefined) taken.set(step.path, { depth: step.depth, names: fresh === "all" ? "all" : new Set(fresh) });
    else before.names = fresh === "all" ? "all" : new Set([...before.names, ...fresh]);
    for (const edge of edgesFrom(file, paths, packages)) {
      if (edge.typeOnly) continue;
      if (!edge.reexport) {
        if (before === undefined) queue.push({ path: edge.to, wanted: edge.names === "all" ? "all" : edge.names.map(([name]) => name), depth: step.depth + 1 });
        continue;
      }
      const onward = edge.names === "all" ? fresh : edge.names.filter(([, as]) => fresh === "all" || fresh.includes(as)).map(([name]) => name);
      if (onward === "all" || onward.length > 0) queue.unshift({ path: edge.to, wanted: onward, depth: step.depth });
    }
  }
  const typed = new Map<string, number>();
  const frontier: [string, number][] = [[test.path, 0], ...[...taken].map(([path, { depth }]) => [path, depth] as [string, number])];
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    const [path, depth] = next;
    for (const edge of edgesFrom(byPath.get(path)!, paths, packages)) {
      if (taken.has(edge.to) || typed.has(edge.to) || isTestFile(edge.to)) continue;
      typed.set(edge.to, BY_TYPES + depth);
      frontier.push([edge.to, depth + 1]);
    }
  }
  return new Map([...[...taken].map(([path, { depth }]) => [path, depth] as const), ...typed]);
}

export function surveyStory(tree: readonly SourceFile[], capabilities: readonly SurveyCapability[], coverage: CoverageMap = {}, ownPackage?: string | readonly string[], packages: readonly SurveyPackage[] = []): StorySurvey {
  const code = tree.filter((file) => isCodeFile(file.path));
  const paths = new Set(code.map((file) => file.path));
  const byPath = new Map(code.map((file) => [file.path, file]));
  const reaches = new Map(code.filter((file) => isTestFile(file.path)).map((file) => [file.path, reached(file, byPath, paths, packages)]));
  const titlesOf = (file: SourceFile): readonly string[] => readerOf(file.path)!.titlesOf(file);
  const calls = new Map(code.filter(isTestCode).map((file) => [file.path, [...titlesOf(file),
    ...[...reaches.get(file.path) ?? []].filter(([path, depth]) => depth < BY_TYPES && readerOf(path)!.registersTests(byPath.get(path)!)).flatMap(([path]) => titlesOf(byPath.get(path)!))]]));
  const byNumber = new Map(capabilities.flatMap((capability) => {
    const number = numberOf(capability.title);
    return number === undefined ? [] : [[number, capability.id] as const];
  }));

  const reach = new Map<string, Map<number, { depth: number; count: number }>>();
  for (const test of code.filter((file) => isTestFile(file.path))) {
    const counts = new Map<number, number>();
    for (const title of calls.get(test.path) ?? []) {
      const named = NUMBERED_TITLE.exec(title);
      if (named === null || !ownPrefix(named[1], ownPackage)) continue;
      const number = Number(named[2]);
      if (byNumber.has(number)) counts.set(number, (counts.get(number) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    for (const [path, depth] of reaches.get(test.path)!) {
      const tally = reach.get(path) ?? new Map<number, { depth: number; count: number }>();
      for (const [number, count] of counts) {
        const was = tally.get(number);
        if (was === undefined || depth < was.depth) tally.set(number, { depth, count });
        else if (depth === was.depth) was.count += count;
      }
      reach.set(path, tally);
    }
  }

  for (const [path, counts] of Object.entries(coverage)) {
    if (!byPath.has(path)) continue;
    const tally = reach.get(path) ?? new Map<number, { depth: number; count: number }>();
    for (const [number, count] of Object.entries(counts)) {
      const was = tally.get(Number(number));
      if (!byNumber.has(Number(number))) continue;
      if (was === undefined || EXECUTED < was.depth) tally.set(Number(number), { depth: EXECUTED, count });
      else if (was.depth === EXECUTED) was.count += count;
    }
    reach.set(path, tally);
  }

  const sources = code.filter((file) => !isTestCode(file));
  const files = sources.map((file): SurveyedFile => {
    const tally = [...(reach.get(file.path) ?? [])].sort(([a, near], [b, far]) => near.depth - far.depth || far.count - near.count || a - b);
    const declared = readerOf(file.path)!.declarationOf(file.text)?.number;
    const reachedBy = tally.map(([number]) => number).sort((a, b) => a - b);
    const owner = declared !== undefined && reachedBy.includes(declared) ? declared : tally[0]?.[0];
    const capability = owner === undefined ? undefined : byNumber.get(owner);
    return {
      path: file.path, lines: linesOf(file.text),
      ...(capability === undefined ? {} : { capability }),
      ...(declared === undefined ? {} : { declared, reachedBy }),
    };
  });
  const imports = sources.flatMap((file) => edgesFrom(file, paths, packages).filter((edge) => !isTestCode(byPath.get(edge.to)!)).map((edge) => ({ from: file.path, to: edge.to })));
  const tests = code.filter(isTestCode).map((file): SurveyedTest => ({
    kind: "test",
    path: file.path,
    titles: proofTitles(calls.get(file.path) ?? []),
    imports: edgesFrom(file, paths, packages).map((edge) => ({ from: file.path, to: edge.to })),
  }));
  return { files, imports, tests };
}

type PackageImport = { readonly specifier: string; readonly names: readonly (readonly [name: string, typeOnly: boolean])[] | { readonly all: boolean } };

type Offers = {
  readonly local: ReadonlySet<string>;
  readonly from: ReadonlyMap<string, { readonly specifier: string; readonly name: string | undefined }>;
  readonly star: readonly string[];
};

type Node = { readonly type: string; readonly [key: string]: unknown };
const nameOf = (node: unknown): string => {
  const named = node as { name?: string; value?: string };
  return named.name ?? named.value ?? "";
};
const nodes = (value: unknown): Node[] => (Array.isArray(value) ? value : []) as Node[];
const literal = (node: unknown): string | undefined => {
  const found = node as { type?: string; value?: unknown; literal?: unknown } | null;
  if (found?.type === "StringLiteral" && typeof found.value === "string") return found.value;
  return found?.type === "TSLiteralType" ? literal(found.literal) : undefined;
};

type Reading = { readonly offers: Offers; readonly imports: readonly PackageImport[]; readonly ownCode: boolean; readonly composes: readonly string[] };

const reading = new WeakMap<SourceFile, Reading>();

function readingOf(file: SourceFile): Reading {
  const cached = reading.get(file);
  if (cached !== undefined) return cached;
  const program = syntaxOf(file)?.program;
  const local = new Set<string>();
  const from = new Map<string, { specifier: string; name: string | undefined }>();
  const star: string[] = [];
  const imported = new Map<string, { specifier: string; name: string | undefined }>();
  const imports: PackageImport[] = [];
  let ownCode = program === undefined;
  const bound = (pattern: unknown): string[] => {
    const node = pattern as Node | null;
    if (node === null) return [];
    if (node.type === "Identifier") return [nameOf(node)];
    if (node.type === "ObjectPattern") return nodes(node.properties).flatMap((property) => bound(property.type === "RestElement" ? property.argument : property.value));
    if (node.type === "ArrayPattern") return nodes(node.elements).flatMap((element) => bound(element?.type === "RestElement" ? element.argument : element));
    return node.type === "AssignmentPattern" ? bound(node.left) : [];
  };
  for (const statement of nodes(program?.body)) {
    const source = literal(statement.source);
    const typeOnly = statement.importKind === "type" || statement.exportKind === "type";
    if (!(statement.type === "ImportDeclaration" || (statement.type === "ExportNamedDeclaration" && !statement.declaration) || statement.type === "ExportAllDeclaration")) ownCode = true;
    if (statement.type === "ImportDeclaration" && source !== undefined) {
      const specifiers = nodes(statement.specifiers);
      for (const specifier of specifiers) imported.set(nameOf(specifier.local), { specifier: source, name: specifier.type === "ImportSpecifier" ? nameOf(specifier.imported) : specifier.type === "ImportDefaultSpecifier" ? "default" : undefined });
      imports.push({ specifier: source, names: specifiers.length === 0 || specifiers.some((one) => one.type === "ImportNamespaceSpecifier") ? { all: typeOnly } : specifiers.map((one) =>
        [one.type === "ImportDefaultSpecifier" ? "default" : nameOf(one.imported), typeOnly || one.importKind === "type"] as const) });
    } else if (statement.type === "ExportNamedDeclaration") {
      const specifiers = nodes(statement.specifiers);
      for (const specifier of specifiers) {
        const as = nameOf(specifier.exported);
        if (source !== undefined) from.set(as, { specifier: source, name: specifier.type === "ExportNamespaceSpecifier" ? undefined : nameOf(specifier.local) });
        else if (imported.has(nameOf(specifier.local))) from.set(as, imported.get(nameOf(specifier.local))!);
        else {
          local.add(as);
          ownCode = true;
        }
      }
      if (source !== undefined) imports.push({ specifier: source, names: specifiers.some((one) => one.type === "ExportNamespaceSpecifier") ? { all: typeOnly } : specifiers.map((one) => [nameOf(one.local), typeOnly || one.exportKind === "type"] as const) });
      const declaration = statement.declaration as Node | null;
      if (declaration?.type === "VariableDeclaration") for (const declarator of nodes(declaration.declarations)) bound(declarator.id).forEach((name) => local.add(name));
      else if (declaration !== null && declaration !== undefined) local.add(nameOf(declaration.id));
    } else if (statement.type === "ExportDefaultDeclaration") local.add("default");
    else if (statement.type === "ExportAllDeclaration" && source !== undefined) {
      if (statement.exported) from.set(nameOf(statement.exported), { specifier: source, name: undefined });
      else star.push(source);
      imports.push({ specifier: source, names: { all: typeOnly } });
    }
  }
  const composes: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as Node;
    const source = node.type === "ImportExpression" ? literal(node.source) : node.type === "TSImportType" ? literal(node.argument) : undefined;
    if (source !== undefined) imports.push({ specifier: source, names: { all: node.type === "TSImportType" } });
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const kind = literal(nodes(node.arguments)[1]);
      if (kind !== undefined && nameOf(callee.type === "MemberExpression" ? callee.property : callee) === "composeParts") composes.push(kind);
    }
    Object.values(value).forEach(visit);
  };
  visit(program?.body);
  for (const specifier of requiresOf(file)) imports.push({ specifier, names: { all: false } });
  const read = { offers: { local, from, star }, imports, ownCode, composes };
  reading.set(file, read);
  return read;
}

export type EdgeStory = {
  readonly id: string;
  readonly files: readonly SourceFile[];
  readonly packages: readonly SurveyPackage[];
  readonly owners: ReadonlyMap<string, string>;
};

export function storyEdges(stories: readonly EdgeStory[]): Map<string, CodeEdge[]> {
  const byName = new Map(stories.flatMap((story) => story.packages.map((pkg) => [pkg.name, { story, pkg }] as const)));
  const lookups = new Map(stories.map((story) => {
    const code = story.files.filter((file) => isCodeFile(file.path));
    return [story.id, { byPath: new Map(code.filter((file) => CODE_FILE.test(file.path)).map((file) => [file.path, file])), paths: new Set(code.map((file) => file.path)) }] as const;
  }));

  const otherFiles = new Map(stories.map((story) => [story.id, new Map(story.files.map((file) => [file.path, file]))] as const));

  const definer = (story: EdgeStory, path: string, name: string, seen: Set<string>): string | undefined => {
    const { byPath, paths } = lookups.get(story.id)!;
    const file = byPath.get(path);
    if (file === undefined || seen.has(path)) return undefined;
    seen.add(path);
    const { offers } = readingOf(file);
    if (offers.local.has(name)) return path;
    const passed = offers.from.get(name);
    if (passed !== undefined) {
      const next = resolve(path, passed.specifier, paths, story.packages);
      if (next === undefined) return path;
      return passed.name === undefined ? next : definer(story, next, passed.name, seen) ?? next;
    }
    for (const specifier of offers.star) {
      const next = resolve(path, specifier, paths, story.packages);
      const found = next === undefined ? undefined : definer(story, next, name, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const bound = (story: EdgeStory, path: string, name: string, seen: Set<string>): string | undefined => {
    const file = otherFiles.get(story.id)!.get(path);
    const offersOf = file === undefined ? undefined : readerOf(path)?.offersOf;
    if (file === undefined || offersOf === undefined || seen.has(path)) return undefined;
    seen.add(path);
    const offers = offersOf(file, lookups.get(story.id)!.paths, story.packages);
    if (offers.local.has(name)) return path;
    const passed = offers.from.get(name);
    if (passed !== undefined) return passed.name === undefined ? passed.to : bound(story, passed.to, passed.name, seen) ?? passed.to;
    for (const next of offers.star) {
      const found = bound(story, next, name, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const packageNamed = (specifier: string) => [...byName].filter(([name]) => specifier === name || specifier.startsWith(name + "/")).sort(([a], [b]) => b.length - a.length)[0]?.[1];

  const exported = (story: EdgeStory, pkg: SurveyPackage, subpath: string) => {
    const target = pkg.exports[subpath];
    return target === undefined ? undefined : resolve(pkg.root + "package.json", target, lookups.get(story.id)!.paths, []);
  };

  const edges = new Map<string, CodeEdge[]>();
  for (const story of stories) {
    const grouped = new Map<string, { story: string; from?: string; to?: string; files: Map<string, EdgeFile> }>();
    for (const file of story.files) {
      if (isTestCode(file) || !isCodeFile(file.path)) continue;
      if (!CODE_FILE.test(file.path)) {
        const fromCapability = story.owners.get(file.path);
        if (fromCapability === undefined) continue;
        for (const { to: named, typeOnly, names } of readerOf(file.path)!.edgesOf(file, lookups.get(story.id)!.paths, story.packages)) for (const to of names === "all" ? [named] : new Set(names.map(([name]) => bound(story, named, name, new Set()) ?? named))) {
          const toCapability = story.owners.get(to);
          if (toCapability === undefined || toCapability === fromCapability) continue;
          const key = JSON.stringify([story.id, fromCapability, toCapability]);
          const group = grouped.get(key) ?? { story: story.id, from: fromCapability, to: toCapability, files: new Map() };
          grouped.set(key, group);
          const pair = JSON.stringify([file.path, to]);
          group.files.set(pair, { from: file.path, to, typeOnly: typeOnly && (group.files.get(pair)?.typeOnly ?? true) });
        }
        continue;
      }
      const { imports, ownCode, composes } = readingOf(file);
      const sources = new Set(imports.map(({ specifier }) => packageNamed(specifier)?.story.id));
      const forwarder = !ownCode && imports.length > 0 && sources.size === 1 && !sources.has(undefined) && !sources.has(story.id);
      const fromCapability = story.owners.get(file.path);
      const take = (target: EdgeStory, start: string | undefined, name: string | undefined, typeOnly: boolean) => {
        const to = start === undefined || name === undefined ? start : definer(target, start, name, new Set()) ?? start;
        const toCapability = to === undefined ? undefined : target.owners.get(to);
        if (target === story && (fromCapability === undefined || toCapability === undefined || fromCapability === toCapability)) return;
        const key = JSON.stringify([target.id, fromCapability ?? null, toCapability ?? null]);
        const group = grouped.get(key) ?? { story: target.id, ...(fromCapability === undefined ? {} : { from: fromCapability }), ...(toCapability === undefined ? {} : { to: toCapability }), files: new Map() };
        grouped.set(key, group);
        const pair = JSON.stringify([file.path, to ?? null]);
        const before = group.files.get(pair);
        group.files.set(pair, { from: file.path, ...(to === undefined ? {} : { to }), typeOnly: typeOnly && (before?.typeOnly ?? true), ...(forwarder && target !== story ? { forwarder: true as const } : {}) });
      };
      for (const { specifier, names } of imports) {
        const named = packageNamed(specifier);
        const own = named === undefined || named.story.id === story.id;
        const start = own ? resolve(file.path, specifier, lookups.get(story.id)!.paths, story.packages)
          : exported(named.story, named.pkg, specifier === named.pkg.name ? "." : "." + specifier.slice(named.pkg.name.length));
        if (own && start === undefined) continue;
        const taken = "all" in names ? [[undefined, names.all] as const] : names;
        for (const [name, typeOnly] of taken) take(own ? story : named.story, start, name, typeOnly);
      }
      const host = story.packages.filter((pkg) => file.path.startsWith(pkg.root)).sort((a, b) => b.root.length - a.root.length)[0];
      for (const kind of composes) for (const dep of host?.deps ?? []) {
        const named = byName.get(dep);
        for (const part of named?.pkg.parts?.[kind] ?? []) take(named!.story, exported(named!.story, named!.pkg, part.from), part.export, false);
      }
    }
    edges.set(story.id, [...grouped].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, { files, ...edge }]) => {
      const behind = [...files.values()];
      return { ...edge, typeOnly: behind.every((one) => one.typeOnly), files: behind };
    }));
  }
  return edges;
}

const CODE_LAYOUT_GUIDANCE = [
  "Code the map can draw.",
  "- storytree draws a story's code from its own package, packages/<story>/src, <story> being its title in lower case with hyphens, less a leading \"The\" (\"Shopping cart\" is packages/shopping-cart). It reads JavaScript, TypeScript and Python. A package.json dependency on another story's package is a road.",
  "- In Python, a story's package is packages/<story>/pyproject.toml with its module in src/<module>, under a uv workspace over packages/*; a [project] dependency draws the road. Name each pytest test by its contract number: test_2_3_cart_keeps_items, or test_<package>_2_3_… (hyphens as underscores) for another story's contract. CI reads only its name, so a docstring's number is for reading only.",
  "- Start each test's title with the number of the contract it proves (\"2.3 the cart keeps its items\"): the files it reaches are drawn inside that capability.",
  "- A story whose code is not in packages/<story>/ names the folders it lives in (plan_story's folders, or edit_plan), so its numbered tests there are credited to it.",
  "- The map's parts are folders with an entry file (index.ts, __init__.py) and packages: open one only to work in it. An import around a part's entry is a clash: tell the user, suggesting a refactor.",
  "- This is the layout for new stories. An existing repository's code, whatever its layout, is drawn where it is once `import_project` maps it: name and describe its capabilities, never redraw them. Mapping includes running the repository's tests in your shell, then planning one arc: an increment per red capability, naming it, and the user's own requests. The import's answer, and the setup check's in a project with imported stories, say how to build beside it.",
].join("\n");

export const MAPPED_CODE_GUIDANCE = [
  "Build beside imported code.",
  "- An imported story's code predates storytree: assume it works.",
  "- Before changing or deleting imported code (a file in a language storytree's code survey knows), stop and ask the user, even when an increment names the change. Say what would change there and its cost, offering the ways on: change it there, bring that part into this project, retire it, or leave it and build on top. Do what the user says. A README, docs or config file in the imported folder is yours to change with no yes asked.",
  "- After the import the projects are separate: do not watch the old project for changes, and import it again only when the user asks.",
  "- Build new stories on top in their own packages, each depending on the imported package by a link: to its folder under its own name (file: under npm, which has no link:). It declares no exports: import its files by path, match its module type and path aliases, and link its one copy of its framework and type packages.",
  "- Old code never imports new code. Wiring the old project to import a package here is the user's business: storytree does not draw or watch it, so say so before doing it on their yes.",
  "- Bringing in a part of an app's screens means bringing in what serves the screens whole: a package here that serves every page and imports what it does not touch from the imported folder. Offer that, or changing it at source. For Next.js: copy the route folder unchanged, less what the old code imports back, with public/, the middleware or proxy, instrumentation and .env files; a next.config that spreads the old one and sets turbopack.root to the folder holding both; a tsconfig whose path aliases point at the imported folder; and its node_modules a link to the old project's, one copy of the framework.",
  "- Test the interface your package has with the old code.",
  "- Before asking about moving a part, give `focus` the part's folders as its crossing, and bring the user its counts, saying when the part is too large to move.",
].join("\n");

export const codeGuidance: readonly string[] = [CODE_LAYOUT_GUIDANCE];
