// Capability 8 · Code survey
import assert from "node:assert/strict";
import { test } from "node:test";

import { linkedStores } from "./stores.js";

const link = (store: string, table: string) => ({ store, table, direction: "read" as const, cites: ["api/db.py:1"] });

test("8.66 · a project's shared stores are its capabilities' store links: one store per address, its tables the linked names, its medium the address's scheme", () => {
  const stories = [
    { capabilities: [{ storeLinks: [link("postgres://db/checkbox", "users"), link("postgres://db/checkbox", "answers")] }, {}] },
    { capabilities: [{ storeLinks: [link("postgres://db/checkbox", "users"), link("rediss://cache", "sessions"), link("postgres://db/checkbox", "forms")] }] },
  ];
  assert.deepEqual(linkedStores(stories), [
    { address: "postgres://db/checkbox", medium: "postgres", tables: [{ name: "users" }, { name: "answers" }, { name: "forms" }] },
    { address: "rediss://cache", medium: "redis", tables: [{ name: "sessions" }] },
  ], "two capabilities linking one address draw one store, each table once, and a medium's other spelling folds into it");
  assert.deepEqual(linkedStores([{ capabilities: [{ storeLinks: [link("postgresql://db/shop", "orders"), link("mongodb+srv://docs/app", "notes"), link("mariadb://db/crm", "leads"), link("sqlite://data/app.db", "rows"), link("orders-bucket", "rows")] }] }]).map(({ medium }) => medium),
    ["postgres", "mongodb", "mysql", "sqlite", "orders-bucket"], "an unfolded scheme is its own medium, and an address with no scheme is its whole text");
});

test("8.66 · a project no capability links a store from has no shared store", () => {
  assert.deepEqual(linkedStores([]), []);
  assert.deepEqual(linkedStores([{ capabilities: [{}, { storeLinks: [] }] }]), []);
});
