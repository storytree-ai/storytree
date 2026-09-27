/** Test fixtures: a library's change history written by hand, as changesSince(0) returns it. */
import type { Change } from "@storytree/library";

/** Builds a history in the order its calls are made, one change per call, each with the next seq. */
export class History {
  readonly changes: Change[] = [];
  readonly #state = new Map<string, { type: string; fields: Record<string, unknown>; createdAt: string }>();
  #seq = 0;

  create(id: string, type: string, fields: Record<string, unknown>): this {
    const at = this.#at();
    this.#state.set(id, { type, fields, createdAt: at });
    return this.#push(id, "created", at);
  }

  /** Set the fields named, keeping the others; a field set to undefined is removed. */
  update(id: string, fields: Record<string, unknown>): this {
    const known = this.#known(id);
    const merged = { ...known.fields, ...fields };
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete merged[key];
    known.fields = merged;
    return this.#push(id, "updated", this.#at());
  }

  retire(id: string): this {
    this.#known(id);
    return this.#push(id, "retired", this.#at());
  }

  /** A decision, accepted unless the fields say otherwise, with the text a decision needs. */
  decision(id: string, fields: Record<string, unknown> = {}): this {
    return this.create(id, "decision", { title: id, text: `${id}'s text`, status: "accepted", ...fields });
  }

  story(id: string): this {
    return this.create(id, "story", { title: id });
  }

  capability(id: string, story: string): this {
    return this.create(id, "capability", { title: id, story });
  }

  memory(id: string, fields: Record<string, unknown> = {}): this {
    return this.create(id, "memory", { title: id, text: `${id}'s text`, ...fields });
  }

  #known(id: string) {
    const known = this.#state.get(id);
    if (known === undefined) throw new Error(`the fixture has no record ${id}`);
    return known;
  }

  #push(id: string, action: Change["action"], at: string): this {
    const { type, fields, createdAt } = this.#known(id);
    this.changes.push({ seq: this.#seq, recordId: id, type, action, record: { id, type, version: 1, fields: structuredClone(fields), createdAt, updatedAt: at } });
    return this;
  }

  #at(): string {
    this.#seq += 1;
    return new Date(Date.UTC(2026, 8, 27, 0, 0, this.#seq)).toISOString();
  }
}
