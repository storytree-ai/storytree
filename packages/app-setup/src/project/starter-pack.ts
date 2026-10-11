/**
 * Capability 6 · Make a folder a project. The starter pack (contract 6.7): what a new project's library holds on day one.
 * The owner chose it (2026-10-01): roles drawn from storytree's own, adapted for a user's project. ADR-0996
 * grew it to the full system storytree's own sessions work with: every role (starter-roles.ts), the
 * principles, guardrails, patterns and processes they stand on (starter-notes.ts), and the six quality
 * control checks the change-reviewer answers for every green change before it lands (here).
 * starter-pack-classification.md records where each came from. These files are the one place its
 * text lives: change it there and raise STARTER_PACK_VERSION.
 *
 * Seeding writes only what the library does not already hold under the same title, so setting a
 * project up again after a failed try adds no second copy. Joining a project from another machine
 * seeds nothing: its library was seeded when it was first set up, and is the user's since.
 */
import type { Library, NewKnowledge } from "@storytree/library";
import { GUARDRAILS, NO_MODULE_MOCK, PATTERNS, PRINCIPLES, PROCESSES, TEST_CREATION } from "./starter-notes.js";
import { ROLES } from "./starter-roles.js";

/** The pack's version: raise it whenever its text changes. */
export const STARTER_PACK_VERSION = 3;

/** Who the history says wrote the pack's records. */
const ACTOR = `storytree setup (starter pack v${STARTER_PACK_VERSION})`;

type Check = Omit<NewKnowledge<"check">, "enforces"> & { readonly enforces: readonly string[] };

/** The quality control checks the change-reviewer answers for every green change (adapted from storytree's own six). */
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
    howToAnswer: "Yes when an assertion the test relies on would still pass if the code produced a plausible wrong result: a value checked only for being defined or truthy when its content is the point, a file checked for existing but not for what it holds, a function checked for being called but not for what it was given or produced, a success flag checked without the result it claims, a length or count checked only for being above zero when the right number or content is known, or an error swallowed in a catch so that a throw still passes. No when each such check sits beside an assertion on the produced content or behaviour, the unhappy path included, or when existence itself is what the contract promises. Ask the deletion check first, but do not stop there: a proxy can fail on deletion and still pass on a wrong answer. The fix is to assert the content, the value or the message.",
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

/** The titles of the pack's roles, in the order the setup check names them. */
export const STARTER_ROLES: readonly string[] = ROLES.map((role) => role.title);

/** Write the starter pack into `library`, skipping each record it already holds under the same title. */
export async function seedStarterPack(library: Library): Promise<void> {
  const ids = new Map<string, string>();
  const write = async <K extends NoteKind>(kind: K, notes: readonly NewKnowledge<K>[]) => {
    const heldNow = await held(library, kind);
    for (const note of notes) ids.set(note.title, heldNow.get(note.title) ?? (await library.writeKnowledge(kind, note, { actor: ACTOR })).id);
  };
  await write("principle", PRINCIPLES);
  await write("guardrail", GUARDRAILS);
  await write("pattern", PATTERNS);
  await write("process", PROCESSES);
  const linked = (titles: readonly string[] = []) =>
    titles.map((title) => ids.get(title) ?? fail(`the starter pack links "${title}", which it does not hold`));
  const checks = await held(library, "check");
  for (const { enforces, ...check } of CHECKS) {
    if (!checks.has(check.title)) await library.writeKnowledge("check", { ...check, enforces: linked(enforces) }, { actor: ACTOR });
  }
  const roles = await held(library, "agent");
  for (const { standsOn, rules, refuse, ...role } of ROLES) {
    if (roles.has(role.title)) continue;
    const links = { context: linked(standsOn), ...(rules === undefined ? {} : { rules: linked(rules) }), ...(refuse === undefined ? {} : { antiPatterns: linked(refuse) }) };
    await library.writeKnowledge("agent", { ...role, ...links }, { actor: ACTOR });
  }
}

/** The titles of the starter roles `library` holds, in the pack's order. */
export async function starterRolesIn(library: Library): Promise<string[]> {
  const titles = new Set((await library.list("agent")).map((agent) => agent.fields.title));
  return STARTER_ROLES.filter((title) => titles.has(title));
}

type NoteKind = "principle" | "guardrail" | "pattern" | "process";

/** The ids of the live `type` records `library` holds, by title. */
async function held(library: Library, type: NoteKind | "check" | "agent"): Promise<Map<string, string>> {
  return new Map((await library.list(type)).map((note) => [note.fields.title, note.id]));
}

function fail(message: string): never {
  throw new Error(message);
}
