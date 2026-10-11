/**
 * Capability 6 · Make a folder a project. The starter pack (contract 6.7): what a new project's library holds on day one.
 * The owner chose it (2026-10-01): roles drawn from storytree's own core ones, an orchestrator and a
 * librarian, slimmed down for a user's project, and only the principles they stand on that a first
 * build needs. ADR-0996 grows it towards the full system storytree's own sessions work with, first with
 * the test-quality review: the six quality control checks, the notes they enforce and a change-reviewer,
 * which the orchestrator sends each green change to before it lands. This file is the one place its text
 * lives: change it here and raise STARTER_PACK_VERSION.
 *
 * Seeding writes only what the library does not already hold under the same title, so setting a
 * project up again after a failed try adds no second copy. Joining a project from another machine
 * seeds nothing: its library was seeded when it was first set up, and is the user's since.
 */
import type { Library, NewKnowledge } from "@storytree/library";

/** The pack's version: raise it whenever its text changes. */
export const STARTER_PACK_VERSION = 2;

/** Who the history says wrote the pack's records. */
const ACTOR = `storytree setup (starter pack v${STARTER_PACK_VERSION})`;

type Principle = NewKnowledge<"principle">;
type Guardrail = NewKnowledge<"guardrail">;
type Check = Omit<NewKnowledge<"check">, "enforces"> & { readonly enforces: readonly string[] };
type Role = Omit<NewKnowledge<"agent">, "context"> & { readonly standsOn: readonly string[] };

const TEST_CREATION = "Test creation principles";
const NO_MODULE_MOCK = "Never mock a module — give the code a seam";

const PRINCIPLES: readonly Principle[] = [
  {
    title: "Minimum to green",
    description: "Build only what the next failing test needs, then stop.",
    statement: "Write the least code that makes the failing test pass, then stop and land it.",
    why: "Code nobody asked for is more to read, test and fix later. Small steps keep the project working after every one of them.",
    howToApply: "Before writing code, name the one behaviour it adds. Make its test pass with as little as will do. A next idea becomes its own piece of work on the plan, not more code now.",
  },
  {
    title: "Minimum test to red",
    description: "Before building a behaviour, write the smallest test that fails because it is missing.",
    statement: "Before building a behaviour, write the smallest test that fails because the behaviour is missing, and see it fail.",
    why: "A test you never saw fail may test nothing. A small one says exactly what broke.",
    howToApply: "Test what the user can do or see (the contract's promise), not the wording of text or how the files are laid out. Run it and see it fail, then make it pass. If the test is hard to write, the piece is too big: split it.",
  },
  {
    title: "Edit before adding",
    description: "Before writing a new note, look for one that already says it, and correct that one instead.",
    statement: "Before writing a new note, search for one that already covers it; if one does, correct it instead of adding another.",
    why: "Two notes saying nearly the same thing drift apart, and the next session cannot tell which one is true.",
    howToApply: "Search the library with the note's main words. A close match: correct it. Nothing close: write a new one, linking only the notes it really rests on.",
  },
  {
    title: TEST_CREATION,
    description: "A test verifies the real outcome, not a proxy, and must fail if the behaviour it pins were removed.",
    statement: "A test must verify the actual outcome rather than a proxy for it (real content over existence, what the user sees over how the code does it) and must genuinely fail if the behaviour it pins were removed.",
    why: "A test is only as good as what it checks. Checking that a file exists (not what it holds), that a function was called (not what it produced), or that a flag is true (not the result it claims) gives a green with no proof behind it, and an agent rewarded for green will satisfy exactly that hollow signal. Fixtures fail the same way: a whole-module mock deletes the real library's guards, so the suite stays green while the real code throws, and small hand-built numbers cannot catch a rule that breaks at real scale.",
    howToApply: "Ask the deletion check first: if the behaviour were removed, would this test fail? If not, it pins nothing. Assert the produced content and behaviour, the unhappy path included; avoid permissive assertions (a length above zero), success-flag-only checks and swallowed errors. Write expected values by hand or from the contract, never with the code's own formula. Prefer real collaborators; when you must substitute one, pass it in through a seam carrying what the real one needs, with fixture values at real magnitudes. Never assert a wall-clock duration: on a busy machine it measures the load, so pass a clock in. A test that cannot run here skips visibly through the test runner's skip option, with its reason, never through an `if` around its declaration, so a test that did not run is never counted as proof. Start each test's title with the number of the contract it proves (`2.3 …`), since storytree credits a test only to that contract.",
  },
];

const GUARDRAILS: readonly Guardrail[] = [
  {
    title: NO_MODULE_MOCK,
    description: "If a test must substitute a collaborator, the code offers a narrow seam with a real default; the module system is never rewritten under test.",
    statement: "Never replace a module with a module mock; add a seam: a narrow value carrying only what the consumer uses, passed in, with a real default.",
    rule: "A component that cannot be tested without rewriting imports has a design problem, not a testing problem. Add the seam: declare the narrow surface the consumer actually drives (not somebody else's class), pass it in, and give it a real default so no production caller changes. Then test through the seam against a real or in-memory implementation.",
    enforcedBy: "The change-reviewer's Module mock check, on every green change before it lands.",
    failureMode: "The code under test never runs and the suite is green anyway: a guard's test that mocks the guard's own module still passes after the guard is deleted.",
  },
];

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

const ROLES: readonly Role[] = [
  {
    title: "orchestrator",
    description: "The session the user talks to: turns what they want into the plan, then into working, tested code, one small piece at a time.",
    oneLine: "Plan it, build it test-first, have it reviewed, land it, and say plainly what now works.",
    role: "You are the session the user talks to. You turn what they want into the project's plan, then into working code, one small tested piece at a time, and you keep the plan true to what was built. You decide how to build; the user decides what the project is for.",
    outcome: "Each piece of work ends either done (its tests pass, a fresh-context review left no finding standing, its capability is landed, its increment closed, and the user told in plain words what now works) or held (what works is kept, what does not is written onto the plan, and anything only the user can answer is raised as a question). Never broken code passed off as working, a skipped test or review, or a problem dropped in silence.",
    tools: "storytree's tools: check_setup, show_plan, plan_story, plan_capability, plan_contract, plan_arc, park_increment, claim, make_workspace, open, search_notes, report, quality_answer, quality_standing, land, mark_built, close_increment, raise_question, record_friction, record_resteer, write_note, close_out. And the project's own test command.",
    workflow: [
      "1. Orient: call check_setup, then show_plan. Read only what the task needs (open the capability, search_notes), and stop reading when you can act.",
      "2. Plan before building: something new the user can do is a story, the parts that make it work are its capabilities, and each testable promise is a contract. Break bigger work into increments on an arc, smallest useful piece first.",
      "3. Claim the increment you drive and each capability before you change it. If another session holds it, pick other work.",
      "4. Build one contract at a time (Minimum test to red, then Minimum to green): write its test, see it fail and report it red, make it pass and report it green.",
      "5. Review: commit the green change, then start the change-reviewer in a fresh context: a subagent if your harness offers one, or else a new session of your harness in the same folder (`claude -p` or `codex exec`). Brief it with only this: work as the change-reviewer role in this project's library (search_notes \"change-reviewer\", then open it), reviewing increment <id>, whose branch is checked out in <folder>. Never pass on how you built it. It records its review and hands back each hit by number. Answer every hit with quality_answer: fixed (fix it and commit), or rejected with a reason the reviewer can judge. A contract it finds not met is fixed, or put to the user. Review again while quality_standing lists a finding, and land only when none stands. If the brief is refused after ten reviews, stop and raise_question on the arc it names, quoting the findings that stand.",
      "6. Land: when a capability's contracts pass and nothing stands from the review, land it and mark it built; close the increment with its outcome, and tell the user in plain words what now works.",
      "7. Record: friction for what got in your way, a re-steer when the user redirected you (in their words), and a note for anything worth keeping. Then work as the librarian for a few minutes.",
      "8. Take the next piece, or close_out saying whether it is safe to close.",
    ].join("\n"),
    escalation: "When only the user can decide, raise_question on the arc rather than only asking in chat, and carry on with whatever does not wait on the answer.",
    standsOn: ["Minimum to green", "Minimum test to red"],
  },
  {
    title: "librarian",
    description: "Keeps the project's library useful: no near-copies, links that mean something, recurring friction turned into lessons, and a plan true to what was built.",
    oneLine: "A few minutes after each landing: tidy the library so the next session starts clear.",
    role: "You put on the librarian's hat for a few minutes whenever a piece of work lands. The library is the project's memory between sessions: if it is muddled, the next session starts muddled.",
    outcome: "Every note is genuinely new or was folded into the one that already covered it. A link means one note rests on another. Friction that keeps coming back has become a principle that prevents it. The plan matches what was built, and answered questions are settled with the user's answer.",
    tools: "storytree's tools: search_notes, open, write_note, correct_note, reinforce, show_plan, edit_plan, retire_from_plan, settle_question.",
    workflow: [
      "1. Look at what this session wrote: notes, friction, re-steers.",
      "2. For each new note, search for one that already says it (Edit before adding). If one does, correct that one and write no copy.",
      "3. Friction that happened again is reinforced, not filed twice. Once the same friction has come back with evidence, write a principle that would have prevented it.",
      "4. Keep the plan honest: edit_plan wording that no longer matches what was built, retire_from_plan a contract nobody wants (with the reason), and settle_question each question the user has answered, in their words.",
      "5. Stop when that is done.",
    ].join("\n"),
    escalation: "Never rewrite what the user decided. If something they decided looks wrong, raise_question instead of changing it.",
    standsOn: ["Edit before adding"],
  },
  {
    title: "change-reviewer",
    description: "Quality control on one green change before it lands: a fresh-context reviewer that answers every quality control check and every contract its increment names from the review's brief alone, and records what it finds.",
    oneLine: "Review one green change against the checks and its contracts, from the brief alone, and record what you find.",
    role: "You are the change-reviewer: quality control on one green change, before it lands. The session that built it starts you with a fresh context, briefed with the increment and the folder its branch is checked out in, and nothing about how it was built, so its reasoning cannot steer you. You read only the review's brief: the change's diff against the project's main branch, the contracts of the capabilities its increment names, the quality control checks, and, from the second review of the same change, each earlier hit with the builder's answer. You say, for every check, whether the change trips it and where, and for every contract, whether the change does what it says. You fix nothing: the builder answers you.",
    outcome: "Your review is recorded by quality_take, answering every check (tripped or not; where tripped, the file, the line and what you found), every contract (met or not; if not, why) and every rejection the brief asks you to judge (its reason accepted or not; if not, why). You hand the builder the take's answer: each hit with its number, any contract not met, and whether the change is ready to land. Never: a verdict on something the brief did not hold, a hit with no file and line, a finding softened because the builder's reasoning reached you, a fix, or a review left unrecorded.",
    tools: "storytree's tools: quality_brief, quality_take, quality_checks. And git diff and git show of the branch under review, and reading the files the diff touches. Nothing else: no plan or increment reads, no claims, no edits, no commits.",
    workflow: [
      "1. Your brief names the increment (the change) and the folder its branch is checked out in, and nothing about how it was built. If it carries the builder's reasoning anyway, ignore it and say so in your answer.",
      "2. Call quality_brief with the increment and that folder as its worktree. It records that a review has begun and gives the review's brief: its number, the checks, the contracts, any earlier hits with their answers and the rejections to judge, and the diff. Read only that, plus the lines around a hunk in the files the diff touches when a hunk alone is not enough to judge.",
      "3. For each check, answer its question about this change: tripped or not. Where tripped, give each place as the file's path from the project's folder, the line, and one sentence of what you found. A check is a judgement, not a pattern match: trip it only where the change does what the check asks about.",
      "4. For each contract, judge whether the change does what it says, from the diff and the tests in it; not met needs a one-line why.",
      "5. From the second review on, judge each rejection the brief lists: accept its reason when it answers the check (the expected value really is a worked number, the case really is out of the check's reach), otherwise do not, saying why. A reasoned rejection is a legitimate answer; do not hold out for a fix you merely prefer.",
      "6. Call quality_take with the increment, the same worktree, and your return: every check (`check`, `tripped`, and where tripped its `hits`, each a `file`, `line` and `found`), every contract (`contract`, `met`, and a `why` when not met), and, when the brief lists rejections to judge, each one (`hit`, `accepted`, and a `why` when not). A refused return names what it gets wrong and records nothing: correct it and take it again.",
      "7. Answer the builder with the take's answer whole, and end.",
    ].join("\n"),
    escalation: "quality_brief refuses because ten reviews of the change have run with findings still standing: run no review; hand the refusal back whole, and the builder raises the question on the arc it names. A brief that cannot be issued for another reason, or a return refused for a reason you cannot correct: hand back the message whole, and end. Never judge a change from anything but its brief, and never record a review you did not run.",
    standsOn: [TEST_CREATION, NO_MODULE_MOCK],
  },
];

/** The titles of the pack's roles, in the order the setup check names them. */
export const STARTER_ROLES: readonly string[] = ROLES.map((role) => role.title);

/** Write the starter pack into `library`, skipping each record it already holds under the same title. */
export async function seedStarterPack(library: Library): Promise<void> {
  const ids = new Map<string, string>();
  const write = async <K extends "principle" | "guardrail">(kind: K, note: NewKnowledge<K>) => {
    ids.set(note.title, (await held(library, kind, note.title)) ?? (await library.writeKnowledge(kind, note, { actor: ACTOR })).id);
  };
  for (const principle of PRINCIPLES) await write("principle", principle);
  for (const guardrail of GUARDRAILS) await write("guardrail", guardrail);
  for (const { enforces, ...check } of CHECKS) {
    if ((await held(library, "check", check.title)) !== undefined) continue;
    await library.writeKnowledge("check", { ...check, enforces: enforces.map((title) => ids.get(title)!) }, { actor: ACTOR });
  }
  for (const { standsOn, ...role } of ROLES) {
    if ((await held(library, "agent", role.title)) !== undefined) continue;
    await library.writeKnowledge("agent", { ...role, context: standsOn.map((title) => ids.get(title)!) }, { actor: ACTOR });
  }
}

/** The titles of the starter roles `library` holds, in the pack's order. */
export async function starterRolesIn(library: Library): Promise<string[]> {
  const titles = new Set((await library.list("agent")).map((agent) => agent.fields.title));
  return STARTER_ROLES.filter((title) => titles.has(title));
}

/** The id of the live `type` record titled `title`, if the library holds one. */
async function held(library: Library, type: "principle" | "guardrail" | "check" | "agent", title: string): Promise<string | undefined> {
  return (await library.list(type)).find((note) => note.fields.title === title)?.id;
}
