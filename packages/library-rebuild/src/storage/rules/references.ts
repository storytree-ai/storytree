// Capability 6 · Knowledge artifacts
export class MissingReferenceError extends Error {
  override readonly name = "MissingReferenceError";
  readonly field: string;
  readonly id: string;
  readonly expected: string;
  readonly found: string | undefined;

  constructor(field: string, id: string, expected: string, found?: string, why?: string) {
    const what = found === undefined ? "which is no live record" : `a ${found}`;
    super(`${JSON.stringify(field)} names ${JSON.stringify(id)}, ${what}, not a live ${expected}${why === undefined ? "" : `: ${why}`}`);
    this.field = field;
    this.id = id;
    this.expected = expected;
    this.found = found;
  }
}

export interface Reference {
  readonly field: string;
  readonly to: string;
  readonly expected: string;
  readonly kinds: readonly string[];
}

export async function checkReferences(get: (id: string) => Promise<{ readonly type: string } | null>, references: readonly Reference[]): Promise<void> {
  for (const { field, to, expected, kinds } of references) {
    const target = await get(to);
    if (target === null || !kinds.includes(target.type)) throw new MissingReferenceError(field, to, expected, target?.type);
  }
}
