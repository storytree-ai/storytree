// Capability 8 · Storytree's own test and gate entries.
export const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
export const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const SKIP_KEYS = new Set(["parent", "loc", "range", "start", "end", "tokens", "comments", "leadingComments", "trailingComments"]);
const ASSERT_MODULE = /^(?:node:)?assert(?:\/strict)?$/;

export function some(node, nested, found) {
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child === null || typeof child?.type !== "string") continue;
      if (found(child) || ((nested || !FUNCTIONS.has(child.type)) && some(child, nested, found))) return true;
    }
  }
  return false;
}

export function importsOf(program) {
  const imports = new Map();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      const name = specifier.type === "ImportSpecifier" ? specifier.imported.name ?? specifier.imported.value : specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
      imports.set(specifier.local.name, { source: statement.source.value, name });
    }
  }
  return imports;
}

export function isAssertion(imports, callee) {
  let root = callee;
  while (root.type === "MemberExpression") {
    if (!root.computed && root.property.name === "assert") return true;
    root = root.object;
  }
  if (root.type !== "Identifier") return false;
  const source = imports.get(root.name)?.source;
  return source === undefined ? root.name === "assert" : ASSERT_MODULE.test(source);
}
