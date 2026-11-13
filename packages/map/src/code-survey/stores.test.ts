/**
 * Capability 8 · Code survey: a project's shared stores, read from its compose file and committed connection settings,
 * with each SQL store's tables from its .sql migrations (ADR-1332 D1, D2's declared layer).
 * Written against a repository shaped like the checkbox interview one: Postgres with pgvector in compose, an API that
 * reaches it by a connection string, and numbered .sql migrations.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readStores } from "./read-survey.js";
import { storesOf, type SharedStore } from "./stores.js";

const filesOf = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ path, text }));

const CHECKBOX = {
  "docker-compose.yml": [
    "services:",
    "  db:",
    "    image: pgvector/pgvector:pg16  # Postgres with vectors",
    "    environment:",
    "      POSTGRES_USER: app",
    "      POSTGRES_DB: \"checkbox\"",
    "    ports:",
    "      - \"5432:5432\"",
    "    volumes:",
    "      - ./migrations:/docker-entrypoint-initdb.d",
    "  api:",
    "    build: .",
    "    environment:",
    "      - DATABASE_URL=postgresql+psycopg://app:secret@db:5432/checkbox",
    "    depends_on: [db]",
    "",
  ].join("\n"),
  ".env.example": "# For running outside compose\nDATABASE_URL=postgresql://app:secret@localhost:5432/checkbox\n",
  "migrations/001_init.sql": [
    "-- CREATE TABLE commented_out (id int);",
    "/* CREATE TABLE also_not (id int); */",
    "CREATE EXTENSION IF NOT EXISTS vector;",
    "CREATE TABLE IF NOT EXISTS public.users (",
    "  id SERIAL PRIMARY KEY,",
    "  email TEXT NOT NULL DEFAULT 'a, b', -- a comment, with a comma",
    "  \"Display Name\" varchar(80)",
    ");",
    "CREATE TABLE forms (id bigint PRIMARY KEY, title text);",
    "create table answers (",
    "  id bigserial,",
    "  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,",
    "  amount numeric(10, 2),",
    "  embedding vector(1536),",
    "  PRIMARY KEY (id),",
    "  CONSTRAINT one_per_user UNIQUE (user_id, id)",
    ");",
    "INSERT INTO forms VALUES (1, 'CREATE TABLE in a string');",
    "",
  ].join("\n"),
  "migrations/001_init.down.sql": "DROP TABLE answers;\n",
  "migrations/002_forms.sql": [
    "ALTER TABLE answers ADD COLUMN form_id bigint;",
    "ALTER TABLE ONLY answers ADD CONSTRAINT answers_form FOREIGN KEY (form_id) REFERENCES public.forms(id);",
    "ALTER TABLE answers DROP COLUMN amount, ADD score real;",
    "ALTER TABLE forms RENAME COLUMN title TO name;",
    "CREATE TABLE scratch (id int);",
    "DROP TABLE IF EXISTS scratch;",
    "",
  ].join("\n"),
  "app/db.py": "import os\nURL = os.environ['DATABASE_URL']\n",
};

test("8.66 · a project's Postgres store is read from its compose file and connection settings, with its tables, columns and foreign keys from its .sql migrations", () => {
  const stores = storesOf(filesOf(CHECKBOX));
  assert.deepEqual(stores, [{
    address: "postgres://db/checkbox",
    medium: "postgres",
    evidence: [
      { file: ".env.example", says: "DATABASE_URL" },
      { file: "docker-compose.yml", says: "service db (image pgvector/pgvector:pg16)" },
      { file: "docker-compose.yml", says: "service api: DATABASE_URL" },
    ],
    tables: [
      {
        name: "answers",
        columns: [
          { name: "id", type: "bigserial" },
          { name: "user_id", type: "integer" },
          { name: "embedding", type: "vector(1536)" },
          { name: "form_id", type: "bigint" },
          { name: "score", type: "real" },
        ],
        foreignKeys: [
          { columns: ["user_id"], table: "users", references: ["id"] },
          { columns: ["form_id"], table: "forms", references: ["id"] },
        ],
        from: ["migrations/001_init.sql", "migrations/002_forms.sql"],
      },
      { name: "forms", columns: [{ name: "id", type: "bigint" }, { name: "name", type: "text" }], foreignKeys: [], from: ["migrations/001_init.sql", "migrations/002_forms.sql"] },
      { name: "users", columns: [{ name: "id", type: "serial" }, { name: "email", type: "text" }, { name: "Display Name", type: "varchar(80)" }], foreignKeys: [], from: ["migrations/001_init.sql"] },
    ],
  }] satisfies SharedStore[]);
});

test("8.66 · a project with no store evidence has no store, even with .sql files", () => {
  assert.deepEqual(storesOf(filesOf({
    "app/main.py": "print('postgres://not/config')\n",
    "schema.sql": "CREATE TABLE lonely (id int);\n",
    "README.md": "Run against postgres://localhost/dev\n",
    "package.json": "{\"name\":\"x\"}\n",
  })), []);
});

test("8.66 · a store is named by medium, host and database with no credentials or port, from placeholders the compose file resolves, and one compose names stays one store", () => {
  const stores = storesOf(filesOf({
    "compose.yaml": [
      "services:",
      "  cache:",
      "    image: redis:7-alpine",
      "  postgres:",
      "    image: postgres:16",
      "    environment:",
      "      - POSTGRES_PASSWORD=secret",
      "      - POSTGRES_DB=${DB_NAME:-shop}",
      "  worker:",
      "    image: example/worker",
      "    environment:",
      "      REDIS_URL: redis://cache:6379/0",
      "      DATABASE_URL: postgres://${PGUSER}:${PGPASS}@postgres/${DB_NAME:-shop}",
      "",
    ].join("\n"),
    "config/settings.toml": "[queue]\nbroker = \"rediss://user:pw@queue.example.com:6380/2\"\n",
  }));
  assert.deepEqual(stores.map(({ address, medium, tables }) => ({ address, medium, tables })), [
    { address: "postgres://postgres/shop", medium: "postgres", tables: [] },
    { address: "redis://cache", medium: "redis", tables: [] },
    { address: "redis://queue.example.com", medium: "redis", tables: [] },
  ]);
  assert.deepEqual(stores[0]!.evidence, [
    { file: "compose.yaml", says: "service postgres (image postgres:16)" },
    { file: "compose.yaml", says: "service worker: DATABASE_URL" },
  ]);
});

test("8.66 · with two SQL stores, a migration goes to the store whose compose service mounts its folder, and to none when nothing says which", () => {
  const stores = storesOf(filesOf({
    "docker-compose.yml": [
      "services:",
      "  users-db:",
      "    image: postgres:15",
      "    volumes:",
      "      - ./db/users:/docker-entrypoint-initdb.d:ro",
      "  orders-db:",
      "    image: mysql:8",
      "    environment:",
      "      MYSQL_DATABASE: orders",
      "",
    ].join("\n"),
    "db/users/01.sql": "CREATE TABLE account (id int);\n",
    "db/orders/01.sql": "CREATE TABLE purchase (id int);\n",
  }));
  assert.deepEqual(stores.map(({ address, tables }) => ({ address, tables: tables.map(({ name }) => name) })), [
    { address: "mysql://orders-db/orders", tables: [] },
    { address: "postgres://users-db/postgres", tables: ["account"] },
  ]);
});

test("8.66 · the survey reads a folder's stores from what it commits, leaving out folders it never reads", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-stores-"));
  try {
    for (const [file, text] of Object.entries({ ...CHECKBOX, "node_modules/pg/docker-compose.yml": "services:\n  other:\n    image: redis\n" })) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      writeFileSync(path.join(folder, file), text);
    }
    const stores = await readStores(folder);
    assert.deepEqual(stores.map(({ address, tables }) => ({ address, tables: tables.map(({ name }) => name) })), [
      { address: "postgres://db/checkbox", tables: ["answers", "forms", "users"] },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
