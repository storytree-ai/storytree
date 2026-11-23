// Capability 6 · Make a folder a project.
import { isDeepStrictEqual } from "node:util";

import { ProjectGoneError, type Library, type NewKnowledge, type Storytree } from "@storytree/library";
import { GUARDRAILS, NO_MODULE_MOCK, PATTERNS, PRINCIPLES, PROCESSES, TEST_CREATION } from "./starter-notes.js";
import { ROLES } from "./starter-roles.js";

export const STARTER_PACK_VERSION = 18;

const ACTOR = `storytree setup (starter pack v${STARTER_PACK_VERSION})`;

type Check = Omit<NewKnowledge<"check">, "enforces"> & { readonly enforces: readonly string[] };

const CHECKS: readonly Check[] = [
  {
    title: "Tautological expected value",
    description: "A test whose expected value is computed the way the code computes it passes by construction.",
    question: "Is any expected value in the change's tests computed the way the code under test computes it?",
    howToAnswer: "Yes when a test's expected value is produced by the same formula, helper or steps the code under test uses (for example, the test recomputes a price with the same arithmetic, or builds the expected list by calling the function being tested), so the test passes by construction and cannot disagree with the code. No when every expected value is a worked number or a literal written down independently of the code (by hand, from the contract, or from a known case), or comes from an independent source the code does not share. The deletion check does not settle it: deleting the function breaks the test's import, yet the test still could not catch a wrong formula. When the answer is yes, the fix is a worked value, saying how it was worked.",
    enforces: [TEST_CREATION],
  },
  {
    title: "Test title without a contract number",
    description: "storytree credits a test only to the contract its title starts with, so a test without one proves nothing on the plan.",
    question: "Does any test the change adds or retitles lack, at the start of its title, the number of the contract of its own story that it proves?",
    howToAnswer: "Yes when a test the change adds or retitles does not start its title with the contract it proves: a number (`8.1 …`), a list (`1.1, 1.2 …`) or a range (`3.1–3.3 …`), followed by a space, never a colon. Also yes when the number names no contract of the story that owns the test's package, or a contract the test does not in fact prove. No when every added or retitled test starts with the number of a contract of its own story that it proves. storytree's landing names a source file no numbered test reaches, but not whether the number names the right contract; this check does.",
    enforces: [TEST_CREATION],
  },
  {
    title: "Proxy assertion",
    description: "An assertion on existence, a call, a flag or a non-zero length passes without proving the outcome.",
    question: "Does any assertion in the change's tests check a proxy for the outcome (that something exists, was called, returned a success flag, or has a length above zero) instead of the outcome itself?",
    howToAnswer: "Yes when an assertion the test relies on would still pass if the code produced a plausible wrong result: a value checked only for being defined or truthy when its content is the point, a file checked for existing but not for what it holds, a function checked for being called but not for what it was given or produced, a success flag checked without the result it claims, a length or count checked only for being above zero when the right number or content is known, or an error swallowed in a catch so that a throw still passes. No when each such check sits beside an assertion on the produced content or behaviour, the unhappy path included, or when existence itself is what the contract guarantees. Ask the deletion check first, but do not stop there: a proxy can fail on deletion and still pass on a wrong answer. The fix is to assert the content, the value or the message.",
    enforces: [TEST_CREATION],
  },
  {
    title: "Wall-clock duration",
    description: "A test that asserts how long something took measures the machine's load, not the code.",
    question: "Does any test in the change assert on a wall-clock duration or depend on real time passing, instead of an injected clock?",
    howToAnswer: "Yes when a test reads real time (`Date.now`, `performance.now`, `process.hrtime`, a real `setTimeout` or `setInterval`) and its verdict depends on how long something took: a measured duration asserted under a bound, a race between real timers, or a sleep the code is expected to finish within. On a busy machine that measures the load, not the code. No when time comes from an injected clock or fake timers, or when a real timeout only stops a hung test and is not what the test asserts. The fix is to pass the clock in and step it.",
    enforces: [TEST_CREATION],
  },
  {
    title: "Module mock",
    description: "A test that rewrites a module's import never runs the real collaborator, so the suite can be green while the code throws.",
    question: "Does any test in the change replace a module with a module mock, or substitute a collaborator that drops what the real one requires, instead of passing a real-shaped collaborator through a seam?",
    howToAnswer: "Yes when any test replaces a module (`vi.mock`, `vi.doMock`, `jest.mock`, `mock.module`, a loader hook or any other rewritten import, partial mocks included). Also yes when a stand-in for a collaborator, even one passed through a seam, drops options the real dependency requires, or when fixture values stay far below real magnitudes in a rule that depends on scale. No when every substitute is passed in through a narrow parameter the code accepts, with a real default so no production caller changes, and carries what the real dependency needs; or when the test uses the real collaborator. A mock the builder calls unavoidable still trips the check: a component that cannot be tested without rewriting imports has a design problem, and the fix is the seam.",
    enforces: [NO_MODULE_MOCK, TEST_CREATION],
  },
  {
    title: "Hidden skip",
    description: "A test skipped by an if around its declaration is never reported, so a test that did not run reads as proof.",
    question: "Does any test in the change skip itself invisibly (an if around its declaration, an early return), or skip visibly with no reason?",
    howToAnswer: "Yes when a test that cannot run here is left out invisibly, so it is never reported as skipped: an `if` around the `test(...)` or `describe(...)` declaration, a `return` at the top of the test body, or a condition that builds the test list without it. Also yes when a visible skip gives no reason. No when every test that cannot run here skips through the test runner's skip option (`{ skip: reason }` in node:test, `test.skipIf`) with its reason.",
    enforces: [TEST_CREATION],
  },
];

export const STARTER_ROLES: readonly string[] = ROLES.map((role) => role.title);
export const STARTER_CHECKS: readonly string[] = CHECKS.map((check) => check.title);

const BARE_BONES: readonly string[] = [];

type NoteKind = "principle" | "guardrail" | "pattern" | "process";
export type PackKind = NoteKind | "check" | "agent";
export const PACK_KINDS: readonly PackKind[] = ["principle", "guardrail", "pattern", "process", "check", "agent"];
type Fields = { readonly title: string } & Readonly<Record<string, unknown>>;
interface PackRecord {
  readonly kind: PackKind;
  readonly fields: Fields;
}
export interface StarterPackRecord {
  readonly kind: PackKind;
  readonly title: string;
  readonly id: string;
}

const NOTES: readonly PackRecord[] = [
  ...PRINCIPLES.map((fields) => ({ kind: "principle" as const, fields })),
  ...GUARDRAILS.map((fields) => ({ kind: "guardrail" as const, fields })),
  ...PATTERNS.map((fields) => ({ kind: "pattern" as const, fields })),
  ...PROCESSES.map((fields) => ({ kind: "process" as const, fields })),
];

function partsOf(parts: Iterable<string>): Set<string> {
  const chosen = new Set<string>();
  for (const title of parts) {
    const check = CHECKS.find((each) => each.title === title);
    const role = ROLES.find((each) => each.title === title);
    if (check === undefined && role === undefined && !NOTES.some(({ fields }) => fields.title === title)) {
      throw new Error(`"${title}" is no part of the starter pack. Its roles are ${STARTER_ROLES.join(", ")}; its checks are ${STARTER_CHECKS.join(", ")}; any note a role or check links is taken by its title too.`);
    }
    for (const linked of [title, ...(check?.enforces ?? []), ...(role === undefined ? [] : [...role.standsOn, ...(role.rules ?? []), ...(role.refuse ?? [])])]) chosen.add(linked);
  }
  return chosen;
}

function heldParts(holding: Held): string[] {
  const held = (kind: PackKind, title: string) => (holding.get(kind)!.has(title) ? [title] : []);
  return [...NOTES.flatMap(({ kind, fields }) => held(kind, fields.title)), ...CHECKS.flatMap(({ title }) => held("check", title)), ...ROLES.flatMap(({ title }) => held("agent", title))];
}

function notesOf(chosen: ReadonlySet<string>): PackRecord[] {
  return NOTES.filter(({ fields }) => chosen.has(fields.title));
}

function linkedRecords(chosen: ReadonlySet<string>, linked: (titles: readonly string[]) => string[]): PackRecord[] {
  const wanted = ({ title }: { readonly title: string }) => chosen.has(title);
  return [
    ...CHECKS.filter(wanted).map(({ enforces, ...check }) => ({ kind: "check" as const, fields: { ...check, enforces: linked(enforces) } })),
    ...ROLES.filter(wanted).map(({ standsOn, rules, refuse, ...role }) => ({
      kind: "agent" as const,
      fields: { ...role, context: linked(standsOn), ...(rules === undefined ? {} : { rules: linked(rules) }), ...(refuse === undefined ? {} : { antiPatterns: linked(refuse) }) },
    })),
  ];
}

export async function seedStarterPack(library: Library): Promise<void> {
  const holding = await heldRecords(library);
  const ids = new Map<string, string>();
  const write = async ({ kind, fields }: PackRecord) => {
    ids.set(fields.title, holding.get(kind)!.get(fields.title)?.id ?? (await library.writeKnowledge(kind, fields as never, { actor: ACTOR })).id);
  };
  const chosen = partsOf(BARE_BONES);
  for (const record of notesOf(chosen)) await write(record);
  for (const record of linkedRecords(chosen, linkedBy(ids))) await write(record);
}

export async function starterRolesIn(library: Library): Promise<string[]> {
  const titles = new Set((await library.list("agent")).map((agent) => agent.fields.title));
  return STARTER_ROLES.filter((title) => titles.has(title));
}

export interface StarterPackStatus {
  readonly seeded: number | null;
  readonly current: number;
  readonly offered: boolean;
  readonly factory?: string;
}

export async function starterPackStatus(library: Library, storytree?: Storytree): Promise<StarterPackStatus> {
  const factory = await packFactory(library, storytree);
  if (factory === undefined) return statusIn(library);
  try {
    return { ...(await statusIn(factory.library)), factory: factory.name };
  } finally {
    await factory.library.close();
  }
}

async function packFactory(library: Library, storytree: Storytree | undefined): Promise<{ readonly name: string; readonly library: Library } | undefined> {
  if (storytree === undefined) return undefined;
  const link = await library.factory();
  if (link.kind !== "product" || (await statusIn(library)).seeded !== null) return undefined;
  const opened = await storytree.openProject(link.factory, { create: false }).catch((error: unknown) => {
    if (error instanceof ProjectGoneError) return undefined;
    throw error;
  });
  if (opened === undefined) return undefined;
  if ((await opened.factory()).kind === "factory") return { name: link.factory, library: opened };
  await opened.close();
  return undefined;
}

async function statusIn(library: Library): Promise<StarterPackStatus> {
  const holding = await heldRecords(library);
  const ids = new Map([...holding.values()].flatMap((byTitle) => [...byTitle].map(([title, record]) => [title, record.id] as const)));
  const chosen = partsOf([...BARE_BONES, ...heldParts(holding)]);
  const records = [...notesOf(chosen), ...linkedRecords(chosen, (titles) => titles.map((title) => ids.get(title) ?? `(not held) ${title}`))];
  const verdicts = await Promise.all(records.map((record) => verdictOf(library, holding, record)));
  const versions = verdicts.flatMap((verdict) => (verdict.seeded === undefined ? [] : [verdict.seeded]));
  const seeded = versions.length === 0 ? null : Math.max(...versions);
  const writes = verdicts.some((verdict) => verdict.action === "add" || verdict.action === "replace");
  return { seeded, current: STARTER_PACK_VERSION, offered: seeded !== null && seeded < STARTER_PACK_VERSION && writes };
}

export interface StarterPackTake {
  readonly added: StarterPackRecord[];
  readonly replaced: StarterPackRecord[];
  readonly kept: (StarterPackRecord & { readonly newer: Fields })[];
  readonly factory?: string;
}

export async function takeStarterPack(library: Library, storytree?: Storytree, include: readonly string[] = []): Promise<StarterPackTake> {
  partsOf(include);
  const factory = await packFactory(library, storytree);
  if (factory === undefined) return takeInto(library, include);
  try {
    return { ...(await takeInto(factory.library, include)), factory: factory.name };
  } finally {
    await factory.library.close();
  }
}

async function takeInto(library: Library, include: readonly string[]): Promise<StarterPackTake> {
  const holding = await heldRecords(library);
  const chosen = partsOf([...BARE_BONES, ...heldParts(holding), ...include]);
  const ids = new Map<string, string>();
  const took: { added: StarterPackRecord[]; replaced: StarterPackRecord[]; kept: (StarterPackRecord & { newer: Fields })[] } = { added: [], replaced: [], kept: [] };
  const take = async (record: PackRecord) => {
    const { kind, fields } = record;
    const verdict = await verdictOf(library, holding, record);
    const id = verdict.id ?? (await library.writeKnowledge(kind, fields as never, { actor: ACTOR })).id;
    ids.set(fields.title, id);
    const named = { kind, title: fields.title, id };
    if (verdict.action === "add") took.added.push(named);
    if (verdict.action === "replace") {
      await library.editNote(id, fields as never, { actor: ACTOR });
      took.replaced.push(named);
    }
    if (verdict.action === "keep") took.kept.push({ ...named, newer: fields });
  };
  for (const record of notesOf(chosen)) await take(record);
  for (const record of linkedRecords(chosen, linkedBy(ids))) await take(record);
  return took;
}

export const PACK_ACTOR = /^storytree setup \(starter pack v(\d+)\)$/;

type Held = ReadonlyMap<PackKind, ReadonlyMap<string, { readonly id: string; readonly fields: Readonly<Record<string, unknown>> }>>;

async function heldRecords(library: Library): Promise<Held> {
  return new Map(await Promise.all(PACK_KINDS.map(async (kind) => [kind, new Map((await library.list(kind)).map((record) => [record.fields.title, { id: record.id, fields: record.fields as Record<string, unknown> }]))] as const)));
}

async function verdictOf(library: Library, holding: Held, { kind, fields }: PackRecord): Promise<{ action: "add" | "same" | "replace" | "keep"; id?: string; seeded?: number }> {
  const held = holding.get(kind)!.get(fields.title);
  if (held === undefined) return { action: "add" };
  const history = await library.history({ id: held.id });
  const versions = history.flatMap((entry) => {
    const version = PACK_ACTOR.exec(entry.actor ?? "")?.[1];
    return version === undefined ? [] : [Number(version)];
  });
  const seeded = versions.length === 0 ? {} : { seeded: Math.max(...versions) };
  const differs = Object.entries(fields).some(([field, value]) => !isDeepStrictEqual(held.fields[field], value));
  if (!differs) return { action: "same", id: held.id, ...seeded };
  return { action: PACK_ACTOR.test(history.at(-1)?.actor ?? "") ? "replace" : "keep", id: held.id, ...seeded };
}

function linkedBy(ids: ReadonlyMap<string, string>): (titles: readonly string[]) => string[] {
  return (titles) => titles.map((title) => ids.get(title) ?? fail(`the starter pack links "${title}", which it does not hold`));
}

function fail(message: string): never {
  throw new Error(message);
}
