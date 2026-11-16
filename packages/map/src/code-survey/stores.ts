/**
 * Capability 8 · Code survey: a project's shared stores, drawn only from the store links the mapping agent records on
 * capabilities (ADR-1347 D3; question_b13b8ae9e126's option A). The map reads no store from compose files, connection
 * settings or migrations: a project the agent has not mapped has none.
 *
 * - One store per address the links name, in the order first named; its tables are the table names linked to it, in
 *   the order first named, with no columns or foreign keys (links carry none, ADR-1347 D2).
 * - Its medium is the address's scheme, with a medium's other spellings folded into one (postgresql is postgres,
 *   mariadb is mysql, rediss is redis, mongodb+srv is mongodb); an address with no scheme has its whole text as medium.
 *
 * Pure and free of Node, so the page draws from it as the desktop does.
 */
import type { SharedStore, StoreLink, StoreTable } from "@storytree/library";

export type { SharedStore, StoreTable } from "@storytree/library";

const MEDIA: Readonly<Record<string, string>> = { postgresql: "postgres", mariadb: "mysql", rediss: "redis", "mongodb+srv": "mongodb" };

/** The store an address names's medium: its scheme, other spellings of one medium folded into one. */
export function mediumOf(address: string): string {
  const scheme = /^([A-Za-z][\w+.-]*):\/\//.exec(address)?.[1]?.toLowerCase() ?? address;
  return MEDIA[scheme] ?? scheme;
}

/** The project's shared stores, as the plan's capabilities link them. */
export function linkedStores(stories: readonly { readonly capabilities: readonly { readonly storeLinks?: readonly Pick<StoreLink, "store" | "table">[] }[] }[]): SharedStore[] {
  const stores = new Map<string, Set<string>>();
  for (const { store, table } of stories.flatMap(({ capabilities }) => capabilities.flatMap(({ storeLinks = [] }) => storeLinks))) {
    const tables = stores.get(store) ?? new Set<string>();
    tables.add(table);
    stores.set(store, tables);
  }
  return [...stores].map(([address, tables]) => ({ address, medium: mediumOf(address), tables: [...tables].map((name): StoreTable => ({ name })) }));
}
