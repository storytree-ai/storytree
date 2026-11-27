// Capability 29 · Factory and product
import type { Pool } from "pg";

export type FactoryLink = { readonly kind: "factory" } | { readonly kind: "product"; readonly factory: string } | { readonly kind: "none" };

export function linkOf(project: string, meta: Readonly<Record<string, string>> | undefined): FactoryLink {
  if (meta?.["kind"] === "factory") return { kind: "factory" };
  const named = meta?.["factory"];
  if (named === undefined) return { kind: "none" };
  return named === project ? { kind: "factory" } : { kind: "product", factory: named };
}

export class ProjectLineage {
  readonly #pool: Pool;
  readonly #name: string;

  constructor(pool: Pool, name: string) {
    this.#pool = pool;
    this.#name = name;
  }

  async factory(): Promise<FactoryLink> {
    const { rows } = await this.#pool.query<{ key: string; value: string }>("SELECT key, value FROM library_meta WHERE key IN ('kind', 'factory')");
    return linkOf(this.#name, Object.fromEntries(rows.map(({ key, value }) => [key, value])));
  }

  async markFactory(): Promise<boolean> {
    const link = await this.factory();
    if (link.kind === "product") throw new Error(`"${this.#name}" is a product project of the factory "${link.factory}", so it cannot be a factory too`);
    if (link.kind === "factory") return false;
    await this.#pool.query("INSERT INTO library_meta (key, value) VALUES ('kind', 'factory') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    return true;
  }

  async recordFactory(name: string): Promise<void> {
    if (name === this.#name) throw new RangeError(`"${name}" cannot name itself as its factory`);
    if ((await this.factory()).kind === "factory") throw new Error(`"${this.#name}" is a factory, so it names no factory of its own`);
    await this.#pool.query("INSERT INTO library_meta (key, value) VALUES ('kind', 'product'), ('factory', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [name]);
  }
}
