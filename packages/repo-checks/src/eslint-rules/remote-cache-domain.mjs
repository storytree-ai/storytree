// Capability 8 · Storytree's own test and gate entries.
import path from "node:path";

const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;
const CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*)\)/i;
const TABLE_KEY = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i;
const COLUMN_KEY = /\bPRIMARY\s+KEY\b/i;

const textOf = (node) => node.type === "Literal" ? (typeof node.value === "string" ? node.value : undefined) : node.quasis.map((quasi) => quasi.value.cooked ?? "").join("?");

function definitions(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at++) {
    if (body[at] === "(") depth++;
    else if (body[at] === ")") depth--;
    else if (body[at] === "," && depth === 0) {
      out.push(body.slice(start, at).trim());
      start = at + 1;
    }
  }
  out.push(body.slice(start).trim());
  return out;
}

const bare = (name) => name.trim().replace(/^["`]|["`]$/g, "").toLowerCase();

function undomained(text) {
  const [, table, body] = CREATE.exec(text) ?? [];
  if (table === undefined) return undefined;
  const key = [];
  for (const definition of definitions(body)) {
    const listed = TABLE_KEY.exec(definition);
    if (listed) key.push(...listed[1].split(",").map(bare));
    else if (COLUMN_KEY.test(definition)) key.push(bare(definition.split(/\s/)[0]));
  }
  return key.includes("domain") ? undefined : table;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      undomained: "table {{table}} is a local cache of a remote source with no domain column in its key, so two sources' rows share one slot (escape_a1c726a22ef5): " +
        "put a domain column in its primary key that holds the source's server, database and project identity",
    },
  },
  create(context) {
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    const sources = new Set();
    const tables = [];
    const imported = (node) => {
      if (node.source.type === "Literal") sources.add(node.source.value);
    };
    const candidate = (node) => {
      const text = textOf(node);
      const table = text === undefined ? undefined : undomained(text);
      if (table !== undefined) tables.push({ node, table });
    };
    return {
      ImportDeclaration: imported,
      ImportExpression: imported,
      Literal: candidate,
      TemplateLiteral: candidate,
      "Program:exit"() {
        if (!sources.has("node:sqlite") || !sources.has("pg")) return;
        for (const { node, table } of tables) context.report({ node, messageId: "undomained", data: { table } });
      },
    };
  },
};
