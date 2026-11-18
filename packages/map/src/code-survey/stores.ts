// Capability 8 · Code survey
import type { SharedStore, StoreLink, StoreTable } from "@storytree/library";

export type { SharedStore, StoreTable } from "@storytree/library";

const MEDIA: Readonly<Record<string, string>> = { postgresql: "postgres", mariadb: "mysql", rediss: "redis", "mongodb+srv": "mongodb" };

export function mediumOf(address: string): string {
  const scheme = /^([A-Za-z][\w+.-]*):\/\//.exec(address)?.[1]?.toLowerCase() ?? address;
  return MEDIA[scheme] ?? scheme;
}

export function linkedStores(stories: readonly { readonly capabilities: readonly { readonly storeLinks?: readonly Pick<StoreLink, "store" | "table">[] }[] }[]): SharedStore[] {
  const stores = new Map<string, Set<string>>();
  for (const { store, table } of stories.flatMap(({ capabilities }) => capabilities.flatMap(({ storeLinks = [] }) => storeLinks))) {
    const tables = stores.get(store) ?? new Set<string>();
    tables.add(table);
    stores.set(store, tables);
  }
  return [...stores].map(([address, tables]) => ({ address, medium: mediumOf(address), tables: [...tables].map((name): StoreTable => ({ name })) }));
}
