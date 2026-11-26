// Capability 29 · Factory and product
import type { FactoryLink } from "./lineage.js";
import { ProjectGoneError } from "./names.js";

export type Reached<P> =
  | { readonly project: string; readonly opened: P; readonly unopened?: undefined }
  | { readonly project: string; readonly opened?: undefined; readonly unopened: string };

export interface CircleMember {
  readonly name: string;
  readonly lineage: { factory(): Promise<FactoryLink> };
  close(): Promise<void>;
}

export class FactoryCircle<P extends CircleMember> {
  readonly #project: P;
  readonly #open: (name: string) => Promise<P>;
  readonly #list: () => Promise<string[]>;
  readonly #reached = new Map<string, Promise<P | undefined>>();

  constructor(project: P, open: (name: string) => Promise<P>, list: () => Promise<string[]>) {
    this.#project = project;
    this.#open = open;
    this.#list = list;
  }

  async reach(name: string): Promise<P> {
    if (name === this.#project.name) return this.#project;
    const factory = await this.#factory();
    if (factory === undefined) throw new Error(`"${this.#project.name}" names no factory, so it reaches no other project`);
    const opened = await this.#member(name, factory);
    if (opened === undefined) throw new Error(`"${name}" is not in the circle of the factory "${factory}" that "${this.#project.name}" belongs to`);
    return opened;
  }

  async reachAll(): Promise<Reached<P>[]> {
    const factory = await this.#factory();
    if (factory === undefined) return [];
    const reached: Reached<P>[] = [];
    for (const name of await this.#list()) {
      if (name === this.#project.name) continue;
      try {
        const opened = await this.#member(name, factory);
        if (opened !== undefined) reached.push({ project: name, opened });
      } catch (error) {
        if (!(error instanceof ProjectGoneError)) reached.push({ project: name, unopened: error instanceof Error ? error.message : String(error) });
      }
    }
    return reached;
  }

  async close(): Promise<void> {
    const reached = [...this.#reached.values()];
    this.#reached.clear();
    await Promise.all(reached.map((opening) => opening.then((opened) => opened?.close(), () => undefined)));
  }

  #member(name: string, factory: string): Promise<P | undefined> {
    const held = this.#reached.get(name);
    if (held !== undefined) return held;
    const opening = this.#open(name).then(async (opened) => {
      const link = await opened.lineage.factory();
      if (name === factory ? link.kind === "factory" : link.kind === "product" && link.factory === factory) return opened;
      await opened.close();
      return undefined;
    });
    this.#reached.set(name, opening);
    opening.catch(() => this.#reached.delete(name));
    return opening;
  }

  async #factory(): Promise<string | undefined> {
    const link = await this.#project.lineage.factory();
    return link.kind === "factory" ? this.#project.name : link.kind === "product" ? link.factory : undefined;
  }
}
