// Capability 17 · Friction
import type { Library, NewKnowledge, SchemaRecord, WriteOptions } from "@storytree/library";
import { VerbRefusal } from "@storytree/library/verbs";

export class CaptureError extends VerbRefusal {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

export interface NewFriction {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
  readonly links?: string[];
  readonly increment?: string;
  readonly branch?: string;
  readonly lookup?: "none" | { readonly shown: string[]; readonly noneMatch: boolean };
}

export interface Reinforcement {
  readonly branch: string;
  readonly evidence: string;
}

export interface NewResteer {
  readonly title: string;
  readonly description: string;
  readonly doing: string;
  readonly redirect: string;
  readonly evidence: string;
  readonly selfReport?: string;
  readonly disposition: "defect" | "taste";
  readonly dispositionBy: "owner" | "agent";
  readonly mode?: string;
  readonly links?: string[];
  readonly increment?: string;
}

const CONCRETE_EVIDENCE: readonly RegExp[] = [
  /`[^`]+`/,
  /\b[\w-]+\.(ts|tsx|js|mjs|cjs|json|md|sql|sh|yml|yaml|css|html|py|txt|toml|mts|cts)\b/,
  /\b[\w.-]+\/[\w./-]+/,
  /#\d+/,
  /\b[0-9a-f]{7,40}\b/,
  /\b(Error|Exception|Traceback|TS\d{2,}|ERR_[A-Z][A-Z_]+|exit code|non-zero|refused|assert(?:ion)?|FAIL(?:ED)?|throws?)\b/,
  /["'][^"'”]{3,}["'”]|(?:^|["'”])[^"'”“]*“[^"'”]{3,}["'”]/,
  /\b(pnpm|npm|npx|node|git|storytree|tsx|gh|python|pip|cargo|go)\s+[\w-]/,
];

export function hasConcreteEvidence(text: string): boolean {
  return CONCRETE_EVIDENCE.some((pattern) => pattern.test(text));
}

const QUOTED = /"[^"”]{3,}["”]|(?:^|["”])[^"”“]*“[^"”]{3,}["”]/;

export async function recordFriction(library: Library, friction: NewFriction, options?: WriteOptions): Promise<SchemaRecord<"friction">> {
  requireConcreteEvidence(friction.evidence);
  await requireIncrement(library, friction);
  const home = frictionHome(library);
  const { branch = "(no branch)", lookup = "none", ...given } = friction;
  let fields: Omit<NewFriction, "branch" | "lookup"> & { from?: { project: string; increment?: string } } = given;
  if (home !== library) {
    await requireFactoryLinks(home, library.name, given.links);
    const { increment, ...rest } = given;
    fields = { ...rest, from: { project: library.name, ...(increment === undefined ? {} : { increment }) } };
  }
  const date = new Date().toISOString().slice(0, 10);
  const today = (await home.list("friction")).filter(({ fields }) =>
    fields.provenance?.branch === branch && fields.provenance.date === date,
  );
  let filed = 0;
  for (const { id } of today) {
    const writer = (await home.history({ id }))[0]?.actor;
    if (writer === undefined || writer === options?.actor) filed++;
  }
  if (filed >= 3) {
    throw new CaptureError(`Filing cap: 3 friction items already filed on "${branch}" for ${date} by this session (ADR-0716; ADR-0168 D3). Distil to the three that fought you hardest, or use storytree friction reinforce <id> --evidence ... for a recurrence.`);
  }
  return home.writeKnowledge("friction", { ...fields, lookup, provenance: { branch, date, source: "retro" } }, options);
}

export function frictionHome(library: Library): Library {
  return library.factoryLibrary() ?? library;
}

async function requireFactoryLinks(factory: Library, project: string, links: readonly string[] = []): Promise<void> {
  for (const link of links) {
    if ((await factory.get(link)) === null) {
      throw new CaptureError(`links names ${JSON.stringify(link)}, which factory ${factory.name}'s library does not hold: friction filed in project ${project} is kept in its factory's library, which links only to its own records, so the project's memory stays in the project (ADR-1331 D5). Say what it is in the statement instead.`);
    }
  }
}

async function requireIncrement(library: Library, filed: Pick<NewFriction, "links" | "increment">, about = "it happened in"): Promise<void> {
  for (const link of filed.links ?? []) {
    if ((await library.get(link))?.type === "increment") {
      throw new CaptureError(`links names ${JSON.stringify(link)}, an increment: links name only artifacts, so give the increment ${about} as "increment" instead.`);
    }
  }
  if (filed.increment !== undefined && (await library.get(filed.increment))?.type !== "increment") {
    throw new CaptureError(`increment names ${JSON.stringify(filed.increment)}: there is no live increment with that id.`);
  }
}

export interface EarlierFriction {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly recurrences: number;
  readonly filed: string;
}

export interface Closest {
  readonly limit?: number;
  readonly except?: string;
  readonly since?: string;
}

function filedOn(note: SchemaRecord<"friction">): string {
  return note.fields.provenance?.date ?? note.createdAt.slice(0, 10);
}

export async function closestFriction(library: Library, friction: Pick<NewFriction, "title" | "statement">, { limit = 3, except, since }: Closest = {}): Promise<EarlierFriction[]> {
  if ((await library.list("friction")).length === 0) return [];
  const all = { limit: Number.MAX_SAFE_INTEGER };
  let ranked = await library.rank(`${friction.title}\n${friction.statement}`, all);
  if (ranked.by === "words") ranked = await library.rank(friction.title, all);
  return ranked.hits.flatMap(({ note }) => note.type === "friction" && note.id !== except && (since === undefined || filedOn(note) >= since)
    ? [{ id: note.id, title: note.fields.title, state: note.fields.state ?? "open", recurrences: note.fields.reinforcedBy?.length ?? 0, filed: filedOn(note) }]
    : []).slice(0, limit);
}

export async function reinforceFriction(library: Library, id: string, recurrence: Reinforcement, options?: WriteOptions): Promise<SchemaRecord<"friction">> {
  requireConcreteEvidence(recurrence.evidence);
  const factory = frictionHome(library);
  const home = (await factory.get(id))?.type === "friction" ? factory : library;
  const friction = await home.get(id);
  if (friction?.type !== "friction") throw new CaptureError(`No live friction item ${id} to reinforce.`);
  const saved = await home.editNote(id, { reinforcedBy: [
    ...(friction.fields.reinforcedBy ?? []),
    { branch: recurrence.branch, date: new Date().toISOString().slice(0, 10), evidence: recurrence.evidence },
  ] }, options);
  if (saved?.type !== "friction") throw new CaptureError(`Friction item ${id} is no longer there to reinforce.`);
  return saved;
}

function requireConcreteEvidence(evidence: string): void {
  if (!hasConcreteEvidence(evidence)) {
    throw new CaptureError(
      `friction's evidence must be concrete: a path, a pull request, a commit, a command and its output, an error, or a quoted excerpt. Vague prose is refused. You gave: ${evidence}`,
    );
  }
}

export async function recordResteer(library: Library, resteer: NewResteer, options?: WriteOptions): Promise<SchemaRecord<"resteer">> {
  if (!QUOTED.test(resteer.evidence)) {
    throw new CaptureError(
      `a re-steer's evidence is the user's own words inside double quotation marks: put what they said between them, as in "Can you add it now?". A paraphrase is your account of those words, which goes in the self-report. You gave: ${resteer.evidence}`,
    );
  }
  await requireIncrement(library, resteer, "it redirected");
  return library.writeKnowledge("resteer", { ...resteer } as NewKnowledge<"resteer">, options);
}
