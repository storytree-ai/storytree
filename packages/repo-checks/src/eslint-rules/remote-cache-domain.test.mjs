// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["remote-cache-domain"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/library/src/knowledge/embeddings.ts");
const BOTH = [`import type { DatabaseSync } from "node:sqlite";`, `import pg from "pg";`].join("\n");
const source = (...lines) => [BOTH, ...lines].join("\n");
const refused = (table, line, code, filename = SOURCE) => ({ code, filename, errors: [{ messageId: "undomained", data: { table }, line }] });
const passes = (code, filename = SOURCE) => ({ code, filename });
const UNDOMAINED = `export const open = (db: DatabaseSync, pool: pg.Pool) => db.exec("CREATE TABLE IF NOT EXISTS embedding_v1 (model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (model, key))");`;

test("8.26 · storytree/remote-cache-domain refuses, in a non-test source file under packages/ or apps/ importing both node:sqlite and pg (type, value or dynamic import), a string or template CREATE TABLE whose key holds no domain column (embedding_v1's (model, key), a one-column id key, a domain column outside the key, two in one file each), its message naming the table, escape_a1c726a22ef5 and the source's server, database and project; a (domain, ...) or domain PRIMARY KEY table, a file importing only node:sqlite, a test file and a file outside packages/ and apps/ pass", () => {
  const message = rule?.meta?.messages?.undomained ?? "";
  assert.match(message, /\{\{\s*table\s*\}\}/, "names the table");
  assert.match(message, /escape_a1c726a22ef5/);
  assert.match(message, /\bserver\b/);
  assert.match(message, /\bdatabase\b/);
  assert.match(message, /\bproject\b/);

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("remote-cache-domain", rule, {
    valid: [
      passes(source(`export const open = (db: DatabaseSync, pool: pg.Pool) => db.exec("CREATE TABLE IF NOT EXISTS embedding_v2 (domain TEXT NOT NULL, model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (domain, model, key))");`)),
      passes(source(`export const cursor = (db: DatabaseSync, pool: pg.Pool) => db.exec("CREATE TABLE IF NOT EXISTS cursor_v1 (domain TEXT PRIMARY KEY, seq INTEGER NOT NULL)");`)),
      passes(source(
        "export const records = (db: DatabaseSync, pool: pg.Pool) => db.exec(`CREATE TABLE IF NOT EXISTS record_v1 (domain TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL,",
        "  PRIMARY KEY (domain, id))`);",
      )),
      passes([`import type { DatabaseSync } from "node:sqlite";`, UNDOMAINED.replace(", pool: pg.Pool", "")].join("\n")),
      passes(source(UNDOMAINED), at("packages/library/src/knowledge/embeddings.test.ts")),
      passes(source(UNDOMAINED), at("scripts/embeddings.ts")),
    ],
    invalid: [
      refused("embedding_v1", 3, source(UNDOMAINED)),
      refused("record_v0", 3, source(
        "export const records = (db: DatabaseSync, pool: pg.Pool) => db.exec(`CREATE TABLE IF NOT EXISTS record_v0 (id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL,",
        "  PRIMARY KEY (id, type))`);",
      )),
      refused("embedding_v1", 4, [
        `import type { Pool } from "pg";`,
        `export async function open(file: string, pool: Pool) {`,
        `  const { DatabaseSync } = await import("node:sqlite");`,
        `  new DatabaseSync(file).exec("CREATE TABLE IF NOT EXISTS embedding_v1 (model TEXT NOT NULL, key TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (model, key))");`,
        `}`,
      ].join("\n"), at("apps/desktop/src/cache.ts")),
      refused("cursor_v0", 3, source(`export const cursor = (db: DatabaseSync, pool: pg.Pool) => db.exec("CREATE TABLE cursor_v0 (id TEXT PRIMARY KEY, seq INTEGER NOT NULL)");`)),
      refused("cursor_v0", 3, source(`export const cursor = (db: DatabaseSync, pool: pg.Pool) => db.exec("CREATE TABLE cursor_v0 (domain TEXT NOT NULL, id TEXT PRIMARY KEY, seq INTEGER NOT NULL)");`)),
      {
        code: [
          `import { DatabaseSync } from "node:sqlite";`,
          `export const open = async (file: string) => {`,
          `  const pg = await import("pg");`,
          `  const db = new DatabaseSync(file);`,
          `  db.exec("CREATE TABLE IF NOT EXISTS seen_v1 (id TEXT PRIMARY KEY)");`,
          `  db.exec("CREATE TABLE IF NOT EXISTS kept_v1 (id TEXT PRIMARY KEY)");`,
          `  return pg;`,
          `};`,
        ].join("\n"),
        filename: at("packages/library/src/project/record-cache.ts"),
        errors: [{ messageId: "undomained", data: { table: "seen_v1" }, line: 5 }, { messageId: "undomained", data: { table: "kept_v1" }, line: 6 }],
      },
    ],
  });

  const hits = new Linter({ cwd: process.cwd() }).verify(
    source(UNDOMAINED),
    [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, plugins: { storytree: plugin }, rules: { "storytree/remote-cache-domain": "error" } }],
    { filename: SOURCE },
  );
  assert.deepEqual(hits.map(({ line, ruleId }) => [line, ruleId]), [[3, "storytree/remote-cache-domain"]]);
  assert.match(hits[0].message, /\bembedding_v1\b/);
  assert.match(hits[0].message, /escape_a1c726a22ef5/);
  assert.match(hits[0].message, /\bserver\b/);
  assert.match(hits[0].message, /\bdatabase\b/);
  assert.match(hits[0].message, /\bproject\b/);
});
