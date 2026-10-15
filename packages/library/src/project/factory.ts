/**
 * Capability 1 · Project libraries. A project's factory (ADR-1040): the user's factory is a project of its own holding
 * the system their product projects build with, and each product project names it. Both facts are the library's own,
 * kept in library_meta beside the project's name: `kind` is `factory` or `product`, and a product's `factory` is the
 * name of the project it builds with. A project that says neither (one made before factories, or by a join) has none.
 */
import type { Pool } from "pg";

import { assertProjectName } from "./names.js";

/** What a project is to factories: the user's factory, a product project naming its factory, or neither. */
export type FactoryLink = { readonly kind: "factory" } | { readonly kind: "product"; readonly factory: string } | { readonly kind: "none" };

/** A project's factory link, read and written in its library_meta. */
export class ProjectLineage {
  readonly #pool: Pool;
  readonly #name: string;

  constructor(pool: Pool, name: string) {
    this.#pool = pool;
    this.#name = name;
  }

  /** Whether this project is a factory, a product naming its factory, or neither. */
  async factory(): Promise<FactoryLink> {
    const { rows } = await this.#pool.query<{ key: string; value: string }>("SELECT key, value FROM library_meta WHERE key IN ('kind', 'factory')");
    const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    if (meta.kind === "factory") return { kind: "factory" };
    if (meta.kind === "product" && meta.factory !== undefined) return { kind: "product", factory: meta.factory };
    return { kind: "none" };
  }

  /**
   * Make this project a factory. True when this call made it one, false when it was one already, so of two setups
   * racing to make the same factory only one seeds it. A product project is refused: it builds with a factory.
   */
  async markFactory(): Promise<boolean> {
    const made = await this.#pool.query("INSERT INTO library_meta (key, value) VALUES ('kind', 'factory') ON CONFLICT (key) DO NOTHING");
    if (made.rowCount === 1) return true;
    const link = await this.factory();
    if (link.kind === "factory") return false;
    throw new Error(`Project "${this.#name}" is a product project${link.kind === "product" ? ` built with factory "${link.factory}"` : ""}, so it cannot be made a factory.`);
  }

  /**
   * Record that this project is a product built with factory `name`, replacing any factory it named before. A
   * factory is refused, and so is a project naming itself.
   */
  async recordFactory(name: string): Promise<void> {
    assertProjectName(name);
    if (name === this.#name) throw new RangeError(`Project "${name}" cannot be its own factory.`);
    const client = await this.#pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      const marked = await client.query(
        `INSERT INTO library_meta (key, value) VALUES ('kind', 'product') ON CONFLICT (key)
           DO UPDATE SET value = excluded.value WHERE library_meta.value <> 'factory'`,
      );
      if (marked.rowCount !== 1) throw new Error(`Project "${this.#name}" is a factory, so it builds with no factory of its own.`);
      await client.query("INSERT INTO library_meta (key, value) VALUES ('factory', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [name]);
      await client.query("COMMIT");
    } catch (error) {
      failed = true;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(failed);
    }
  }
}
