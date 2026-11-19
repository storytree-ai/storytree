// Capability 1 · Base structure measures
import { kindOf, parsed, walk, type Node, type SourceText } from "./source.js";

export interface TestsReading {
  readonly count: number;
}

const CALLS = new Set(["test", "it"]);
const FORMS = new Set(["only", "skip", "todo"]);
const TITLES = new Set(["StringLiteral", "TemplateLiteral"]);

const named = (node: Node | undefined, names: ReadonlySet<string>): boolean => node?.type === "Identifier" && names.has(node.name as string);

function isTest(node: Node): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as Node;
  const called = named(callee, CALLS) || (callee.type === "MemberExpression" && !callee.computed && named(callee.object as Node, CALLS) && named(callee.property as Node, FORMS));
  const [title] = node.arguments as Node[];
  return called && title !== undefined && TITLES.has(title.type);
}

export function testsOf(files: readonly SourceText[]): TestsReading {
  let count = 0;
  for (const file of files) {
    if (kindOf(file) !== "test") continue;
    const program = parsed(file).program;
    if (program !== undefined) for (const node of walk(program)) if (isTest(node)) count++;
  }
  return { count };
}
