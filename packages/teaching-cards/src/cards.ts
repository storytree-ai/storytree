/**
 * Capability 1 · Teaching cards. What each kind of thing on the user's map means, said once the first
 * time it appears (ADR-1048 D1): a title and a line at once, and what, why, how and the decisions behind
 * it for More (ADR-0841 D2's depth on demand). Rewritten from the website tour's concept copy
 * (packages/website/src/tour-copy.ts) so it reads true on the user's own project, not the tour's shop.
 */

/**
 * The kinds a card teaches, in the order cards show when several appear at once. The factory and its parts (a role, a
 * note, a check) show only on the user's factory (ADR-1048 D3).
 */
export const KINDS = ["empty", "factory", "role", "note", "check", "arc", "story", "capability", "claim", "health", "decision", "question"] as const;
export type Kind = typeof KINDS[number];

/** A decision behind a card, by its number in storytree's decision log and its title. */
export interface CardDecision { number: number; title: string }

export interface Card {
  kind: Kind;
  title: string;
  /** Shown at once. */
  line: string;
  /** Shown with More. */
  what: string;
  why: string;
  how: string;
  decisions: CardDecision[];
}

const adr = (number: number, title: string): CardDecision => ({ number, title });

const CARDS: Record<Kind, Omit<Card, "kind">> = {
  empty: {
    title: "Your map starts empty.",
    line: "It fills as your agent builds: ask your agent for what you want to make, and watch it appear here.",
    what: "This globe is a map of your project. Each thing your agent plans or builds shows up on it, and the first time each kind appears, a card like this one says what it is.",
    why: "Watching a project grow from nothing shows you how to read the map of one that is already big.",
    how: "Your agent plans the work before it writes code. As it does, storytree records the plan in your project's library and draws it here; nothing on the map is drawn by hand.",
    decisions: [adr(1048, "A new user learns on their own product")],
  },
  factory: {
    title: "This is your factory.",
    line: "It is your own version of storytree: the way your products are built, kept in one place for you to shape.",
    what: "Your factory holds the system your products build with: its roles, notes and checks. Roles say how your agents work, notes are the rules and habits they stand on, and checks review each change.",
    why: "What your agents learn about building well should help every product you make, not stay in the one where it was learned.",
    how: "An edit in your factory reaches every product that builds with it. A product's own edit stays its own: its version of a role, note or check wins there, and the factory's edit never overwrites it. The top bar takes you back to your product.",
    decisions: [adr(1040, "A user's factory: their own version of storytree"), adr(1041, "The factory is a project of its own, recorded by each product"), adr(1048, "Switching to the factory from the top bar teaches it")],
  },
  role: {
    title: "A role.",
    line: "A role says how one of your agents works: what it is for, what it does, and what it never does.",
    what: "A role is an agent's standing brief, such as the session that builds the work or the reviewer that checks it. Your factory keeps them, and every product's agents read them.",
    why: "An agent that starts each session knowing its job does it the same way every time, without you explaining it again.",
    how: "Each session reads its role when it starts. Change the role here, and the next session in every product works the new way.",
    decisions: [adr(1040, "A user's factory: their own version of storytree")],
  },
  note: {
    title: "A note your agents stand on.",
    line: "A note is a rule, a pattern or a habit your agents follow, written down once for every product.",
    what: "Notes are principles, patterns, processes and guardrails: what your agents have learned about building well, each with why it holds and how to apply it.",
    why: "A lesson learned on one product is worth keeping for the next. Written here, it outlives the session that learned it.",
    how: "Agents find a note when its subject comes up and follow it. Each product reads its factory's notes as its own, unless it keeps its own version.",
    decisions: [adr(1040, "A user's factory: their own version of storytree")],
  },
  check: {
    title: "A check.",
    line: "A check is a question a reviewer asks of every change before it lands.",
    what: "A check names one thing a good change gets right, such as a test that fails when its behaviour is removed. A reviewer answers every check on every change.",
    why: "A change your agent calls done is only a claim. A check asked by a fresh reviewer is how you know.",
    how: "Before a change lands, a reviewer reads its checks and records what it found. A finding is fixed, or answered with a reason, before the change goes on.",
    decisions: [adr(956, "A change-reviewer runs quality control on every change"), adr(1040, "A user's factory: their own version of storytree")],
  },
  arc: {
    title: "The plan comes first.",
    line: "Your agent has set up a plan of work: an end state and the pieces of work that reach it.",
    what: "A plan, called an arc, says what done looks like and lists the pieces of work, called increments, that get there.",
    why: "A plan that lives beside the work lets the next agent pick up the next piece without asking you.",
    how: "A session claims a piece of work before it starts, lands it through a pull request, and closes it. Pieces that wait on others show as waiting.",
    decisions: [adr(638, "The arc surface"), adr(760, "Waiting work shows as waiting"), adr(772, "Landed is a work outcome")],
  },
  story: {
    title: "This is a story.",
    line: "Your project is made from stories: each is something someone can do with it, and shows here as an island.",
    what: "A story is one journey a user of your project can take, such as signing in or checking out. Its code lives in its own package.",
    why: "Grouping code by what it lets someone do shows you where a change belongs, and what it can reach.",
    how: "The pathways between islands are dependencies: each runs one way, from a story to the story it needs, and storytree refuses a loop. Select an island to see its parts.",
    decisions: [adr(819, "A package for each story"), adr(839, "Islands sit in rows by dependency depth"), adr(847, "Dependencies run one way")],
  },
  capability: {
    title: "A part of a story.",
    line: "Each story is broken into the parts that make it work. Each part is a territory on its island.",
    what: "A part, called a capability, is one piece of how a story works. It makes promises, called contracts, that its tests check.",
    why: "You can see where the code went and which promises it serves, without opening a file.",
    how: "Once a part has code, each dot in its territory is a file, sized by its lines, in the part whose tests reach it. A part with no code yet has an equal share of the island.",
    decisions: [adr(804, "Code islands: land, territories and file circles"), adr(838, "Every line of code belongs to a capability")],
  },
  claim: {
    title: "An agent claimed this.",
    line: "Agents claim the parts they will work on before they start, so each can see what the others are on.",
    what: "A claim is a flag in its session's colour, standing in the part a session is changing.",
    why: "Two agents editing the same thing is how work gets lost. A claim says who is on what before anyone writes.",
    how: "A second claim on the same work is turned away, so the agent picks other work instead. Claims end when the work lands, or when the session lets them go.",
    decisions: [adr(643, "Claims, the wait refusal and release on merge"), adr(758, "A session leaves the list by a verified close-out")],
  },
  health: {
    title: "Health.",
    line: "Once a part is built, its colour says whether something has checked it: yellow is not proved yet, green is passing.",
    what: "A part's health is rolled up from its promises' test results; red means a test that names it is failing.",
    why: "You can see what has been proved and what still needs checking, without taking an agent's word for it.",
    how: "As your tests run, storytree matches each result to the promise it checks. A colour counts only when something other than the agent checked it; saying 'done' doesn't count.",
    decisions: [adr(623, "Minimal viable TDD: red, then green"), adr(744, "Health says what was checked"), adr(825, "Every card that isn't green says why, and who moves it")],
  },
  decision: {
    title: "A decision, kept with the work.",
    line: "As your agents build, they decide how things should work, and why. Storytree keeps each decision inside the globe.",
    what: "A decision is a note in your project's library. It sits on the shelf of the story or part it shaped; one about no one part gathers at the core.",
    why: "Every new agent session starts on its first day. Keeping decisions with the work means the next session doesn't relearn them, and you don't explain them again.",
    how: "Before an agent changes a part, it reads that part's shelf. Storytree records each note a session opens, so you can see what the work stood on.",
    decisions: [adr(627, "Every story and capability has a shelf of front covers"), adr(631, "Decisions about the whole project sit on no shelf")],
  },
  question: {
    title: "A question is waiting on you.",
    line: "Your agent has a decision only you can make, and has written it down for you to answer.",
    what: "A question says what is at stake, the options with both sides of each, and any recommendation. The work it holds waits until you answer.",
    why: "Owner-level calls are yours. Written down, a question can be answered when you're ready, and the answer stays with the work.",
    how: "Open the plan to read it and answer in your own words. Your answer is recorded as a decision, and the work it held is free to go on.",
    decisions: [adr(824, "The owner's decisions live in written questions")],
  },
};

export function cardOf(kind: Kind): Card {
  return { kind, ...CARDS[kind] };
}
