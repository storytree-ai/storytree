/** Capability 2 · The forest on the site. */
import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";
import type { Chip, Decision, Explainer, Group, TourStep } from "./tour.js";

/** When the comparisons were checked against each tool's own documentation (definition_b0b80acc7330). */
export const researchDate = "3 October 2026";
export const groupTitles: Record<Group, string> = {
  opening: "Why storytree", map: "The map", agents: "Agents on the map", knowledge: "Knowledge graph", ending: "The whole globe",
};
export const explainers: { id: Explainer; title: string }[] = (["map", "agents", "knowledge"] as const).map(id => ({ id, title: groupTitles[id] }));

const adr = (number: number, title: string): Decision => ({ number, title });
const decisions = {
  busy: adr(857, "Open on the busy globe; five explainers, compared with other tools"),
  guide: adr(852, "One surface at a time, on the real globe"),
  islands: adr(804, "Code islands: land, territories and file circles"),
  packages: adr(819, "A package for each story"),
  rows: adr(839, "Islands sit in rows by dependency depth"),
  edges: adr(847, "Dependencies run one way"),
  pathways: adr(776, "Roads wind round islands and merge on the way"),
  allocation: adr(838, "Every line of code belongs to a capability"),
  tests: adr(623, "Minimal viable TDD: red, then green"),
  health: adr(744, "Health says what was checked"),
  maintain: adr(825, "Every card that isn't green says why, and who moves it"),
  core: adr(647, "The knowledge inside the planet, a graph that refuses loops"),
  loose: adr(658, "Loose notes gather at the core"),
  shelves: adr(627, "Every story and capability has a shelf of front covers"),
  librarian: adr(780, "Each landing keeps what the session learned"),
  claims: adr(643, "Claims, the wait refusal and release on merge"),
  closeOut: adr(758, "A session leaves the list by a verified close-out"),
  reads: adr(740, "Each session's reading path, in its colour"),
  window: adr(746, "A session's context window, from its transcript"),
  arcs: adr(638, "The arc surface"),
  waits: adr(760, "Waiting work shows as waiting"),
  landed: adr(772, "Landed is a work outcome"),
  questions: adr(824, "The owner's decisions live in written questions"),
};
const principle = (n: 1 | 2 | 3 | 4): Chip => ({ kind: "principle", text: [
  "", "Signals must be real", "Show what matters now; hide the rest", "Your attention goes where you send it", "Nothing is out of reach",
][n]! });
const partial = (text: string): Chip => ({ kind: "partial", text });

const complete: GlobeSurfaces = { sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true };
const none = { roads: false, territories: false, fileCircles: false, knowledgeCore: false, sessionTints: false } as const;
const quiet: Partial<GlobeSurfaces> = { ...none, nameplates: false };
const land: Partial<GlobeSurfaces> = { ...none, nameplates: true };
const roads: Partial<GlobeSurfaces> = { ...land, roads: true };
const plain: Partial<GlobeSurfaces> = { ...land, territories: "plain" };
const files: Partial<GlobeSurfaces> = { ...plain, fileCircles: true };
const health: Partial<GlobeSurfaces> = { ...files, territories: "health" };
const core: Partial<GlobeSurfaces> = { ...none, grounds: false, nameplates: false, knowledgeCore: true };

const story = (id: string): GlobeTarget => ({ kind: "story", story: id });
const capability = (id: string): GlobeTarget => ({ kind: "capability", capability: id });
const library = story("story_754e87e7d531"), forest = story("story_deee4230348c"), centre: GlobeTarget = { kind: "core" };
// Storytree's own recorded growth (own-snapshot.json): Act 2 arrives on it, grown from a point as its agents built it (ADR-0889 2.2b).
const own = { map: "own" as const, target: { kind: "core" } as GlobeTarget };
// The shop (shop-snapshot.json): the store the test laptop's Claude Code sessions rebuilt side by side with storytree, where the
// chapters teach (ADR-0890), walking only four of its stories: Signing in, Browsing, Cart and Checkout (ADR-0891, amended
// 2026-10-05).
const signingInId = "story_d263ef0f3f72", built = ["story_0c07d0047754", "story_2de9e8f4db21", "story_66f80ffaaa4d"];
const teaching = [signingInId, ...built];
const browsing = story(built[0]!), cart = story(built[1]!), checkout = story(built[2]!), ordersId = "story_8a4b7fb5d36c", orders = story(ordersId);
// The shop was rebuilt with storytree's guardrails (ADR-0911 D5): no part of its code is unallocated at any stage, so the tour
// shows no hatched ground. The code and colours steps keep framing signing in, the story built first.
const signingIn = story(signingInId);
const cartPage = capability("capability_ed214990be99");
// Two recorded moments in the shop's records: parts 2, 3 and 4 claimed by three sessions at once, and the session sent to
// part 7 while part 7 and part 8 were held, after it said so and before it closed out (03:42:34).
const together = "2026-10-05T02:33:00.000Z", standDown = "2026-10-05T03:40:00.000Z";
// The chapters' steps are the shop with its teaching stories lit and the rest dimmed. The drawing dims only where session
// tints are on; the shop at these moments has no live sessions but the ones a step shows, so they add nothing else.
const shopMap = { map: "shop" as const, focus: teaching };
// After its first four stories were built (pr4, 02:46) and before its second round began (03:02): where the map chapter
// teaches the parts, the code and the colours.
const firstRound = "2026-10-05T03:00:00.000Z";
const lit = (surfaces: Partial<GlobeSurfaces>): Partial<GlobeSurfaces> => ({ ...surfaces, sessionTints: true });
/** How long the arrival's time-lapse plays at 1×. */
export const arrivalSeconds = 15;
const vscode = { name: "VS Code docs", url: "https://code.visualstudio.com/docs/editing/getting-started/userinterface#_explorer-view" };
const aider = { name: "Aider docs", url: "https://aider.chat/docs/repomap.html" };
const cursorRules = { name: "Cursor docs", url: "https://cursor.com/docs/rules" };
const graphiti = { name: "Graphiti docs", url: "https://help.getzep.com/graphiti/getting-started/overview" };
const cursorAgents = { name: "Cursor docs", url: "https://cursor.com/docs/agent/agents-window" };
const langsmith = { name: "LangSmith docs", url: "https://docs.langchain.com/langsmith/studio" };
const linear = { name: "Linear docs", url: "https://linear.app/docs/initiatives" };
const compared = `Checked against each tool's own documentation on ${researchDate}. Follow a link to read it there.`;

/**
 * The tour, one thought per line (ADR-0879 D4). Each explainer opens on the owner's own line (ADR-0857 D3);
 * {name} placeholders are the saved reading's own counts, filled in when the page is built.
 */
export const steps: TourStep[] = [
  // The owner's words, final (2026-10-04): the feeling leads, and the guide's line bridges to the value statement.
  { id: "pain", explainer: "opening", kind: "beats", ...own, growth: "seed", title: "The problem", lines: [
    "Right now, building with AI feels overwhelming, exhausting and disconnected.",
    "Storytree is here to fix that.",
  ], why: "Your attention is the scarcest resource in AI-driven development, and coding agents spend it on noise. Reading every line makes you the bottleneck the agents were meant to remove; trusting every line finds the problems in production. There's no in-between.",
  decisions: [], surfaces: complete, framing: 1.1 },
  { id: "grow", explainer: "opening", kind: "beats", ...own, growth: { seconds: arrivalSeconds }, title: "Storytree, a living map", lines: [
    // The owner's words (2026-10-04), punctuation tidied.
    "This is storytree, a living map of your project, for both you and your agents.",
  ], chips: [{ kind: "recording", text: "Recorded {ownRecording} · timing compressed" }],
  decisions: [], surfaces: complete, framing: 1.1 },
  // The owner's words, final (ADR-0889 2.3): the value statement has its slide to itself.
  { id: "value", explainer: "opening", kind: "statement", ...own, title: "Storytree builds a map of your project and glues it to your code.", lines: [
    "The map grows as your agents work, and says what needs you and what doesn't.",
  ], decisions: [], surfaces: complete, framing: 1.1, drift: true },
  // The owner's words, final (ADR-0889 2.4): each pain (its note) with its fix beside it. The four principles are this step's depth.
  { id: "fixes", explainer: "opening", kind: "fixes", ...own, title: "What storytree fixes", lines: [
    "See your whole project as a map",
    "Agents see each other working on the map",
    "Every decision remembered, anchored to the map",
  ], notes: [
    "No idea what your agents built",
    "Agents colliding in a void of code",
    "Agents forgetting why it was built that way",
  ], why: "Storytree answers to four principles. Signals must be real: everything you see comes from the real code and the real work, and says where it came from. Show what matters now and hide the rest: nothing asks for your attention unless it needs it. Your attention goes where you send it: you choose what to look into, and how deep to go. Nothing is out of reach: whatever storytree hides, you can always bring back.",
  decisions: [], surfaces: complete, framing: 1.1, drift: true },

  // The map (ADR-0891, amended 2026-10-05): the shop's empty globe, then its stories grown in the order they were recorded
  // (option A), then the owner's ideas on its four stories. Lines quoted from the owner are his; every other line, and each
  // step's How and Why, is DRAFT, the agent's wording until the owner writes his own.
  { id: "map-empty", explainer: "map", map: "shop", growth: { seconds: 5, until: "planned" }, title: "Your project, shown as a collection of stories.", lines: [
    // The owner's words (2026-10-05).
    "Your project, shown as a collection of stories.",
    // DRAFT.
    "A story is something your software lets someone do.",
  ], how: "Before writing code, the shop's agents wrote its stories into storytree's plan. Each story's code lives in its own package, and storytree draws each package as an island.",
  why: "People think about what software does for them, not about folders. Grouping the code by the journey it serves lets you find your way by what matters to the person using it.",
  decisions: [], surfaces: lit(land), framing: 1.05 },
  // DRAFT (ADR-0891's words for M1): the four stories planned together at 01:53, each lit as the narration names it.
  { id: "map-planned", explainer: "map", map: "shop", growth: { seconds: 6, stage: "planned" }, title: "Let's build a shopping site.", lines: [
    "Let's build a shopping site.",
    "It starts with signing in, then browsing the products, the cart, and checkout.",
  ], names: [{ said: "signing in", story: signingInId }, { said: "browsing the products", story: built[0]! }, { said: "the cart", story: built[1]! }, { said: "checkout", story: built[2]! }],
  how: "The shop's agent planned all four stories in one go, at 01:53 on 5 October, before any code was written. An island appears the moment its story is planned.",
  why: "A plan you can see is a plan you can check: you know what the agents mean to build before they build it.",
  decisions: [], surfaces: lit(land), framing: .95 },
  // DRAFT (ADR-0891's words for M2): pr1, 02:06.
  { id: "map-first", explainer: "map", map: "shop", focus: [signingInId], growth: { seconds: 5, stage: "pr1-building", until: "pr4-building" }, title: "Signing in is built first.", lines: [
    "Signing in is built first.",
  ], how: "One agent took signing in, and its land filled in as its code landed. The coloured coast is that agent's session, working on the island.",
  why: "Watching the land fill in shows where the work actually went, story by story.",
  decisions: [], surfaces: lit(files), framing: .95 },
  // DRAFT (ADR-0891's words for M3): pr3 to pr5, 02:39 to 02:46.
  { id: "map-together", explainer: "map", map: "shop", focus: built, growth: { seconds: 6, stage: "pr4-building", until: "pr7-building" }, title: "Then the other three, all at once.", lines: [
    "Then the other three, all at once, by three agents working side by side.",
  ], how: "Browsing, the cart and checkout depend only on what was already built, so three agents built them at the same time, each on its own island.",
  why: "Stories that don't wait on each other can be built in parallel, and the map shows that they were.",
  decisions: [], surfaces: lit(files), framing: .95 },
  // DRAFT: the owner's ideas as story lines (his words where quoted).
  { id: "map-parts", explainer: "map", ...shopMap, recorded: firstRound, title: "Stories split into parts.", lines: [
    // The owner's words.
    "Stories are split into parts.",
    "Each part is one piece that makes its story work.",
    "The cart has two: its page and its menu.",
  ], how: "Storytree calls a part a capability. Each one carries promises a test can check, and an agent claims it, builds it and lands it on its own.",
  why: "A story is too big to check in one go. Parts are small enough to promise something about, and to hand to one agent at a time.",
  decisions: [], surfaces: lit(plain), target: cart, framing: .55, tags: [{ target: cartPage, text: "a part: Cart page" }] },
  { id: "map-code", explainer: "map", ...shopMap, recorded: firstRound, title: "Your code is the dots.", lines: [
    // The owner's words.
    "Your code is shown as dots in the parts.",
    "Each dot is a file, sized by its lines, in the part whose tests reach it.",
  ], how: "Storytree reads the code itself: each story's package, its files, and which part's tests reach each file.",
  why: "Drawing every file in the part it serves shows which promise each piece of code is there to keep.",
  decisions: [], surfaces: lit(files), target: signingIn, framing: .55 },
  { id: "map-health", explainer: "map", ...shopMap, recorded: firstRound, title: "Parts have colours.", lines: [
    // The owner's words.
    "Parts have colours.",
    "Green means its tests passed when the shop's own CI ran them, not because an agent said so.",
  ], how: "The shop's CI ran its tests, and storytree matched each result to the promise it checks.",
  why: "Agents say 'done' when it isn't. A colour counts only when something other than the agent checked it, and it always says where it came from.",
  decisions: [], surfaces: lit(health), target: signingIn, framing: .6 },
  { id: "map-grow", explainer: "map", ...shopMap, focus: [...teaching, ordersId], growth: { seconds: 10, stage: "pr7-building" }, title: "As it grows, stories are added.", lines: [
    // The owner's words.
    "As your project grows, more stories are added.",
    // DRAFT.
    "Orders came in the shop's second round, with a road to each story it builds on.",
  ], how: "One codebase, one package per story. A road runs from a story to each story it builds on, and storytree refuses a road that would close a loop, so the dependencies always run one way.",
  why: "A change to one story can break the stories that stand on it. The roads show where the ripples go before you make the change.",
  compare: { lines: [
    "VS Code's Explorer browses files and folders; its Outline lists a file's symbols.",
    "Aider's repo map ranks your code's names and signatures to fit the model's budget.",
    "Storytree groups the code by what it lets someone do, with the plan beside it.",
  ], sources: [vscode, aider, undefined] },
  decisions: [], surfaces: lit(roads), target: orders, framing: 1.0, tags: [{ target: orders, text: "a new story: Orders" }] },

  // Agents on the map (ADR-0893): the shop's own records at two recorded moments, 5 October 2026: parts 2, 3 and 4 built by three
  // sessions at once, then the session sent to part 7 while another held it. It opens on the sessions strip: the fixes are said
  // once, in the arrival (ADR-0890, amended 2026-10-05). The owner's lines are his; every other line, and each step's How and
  // Why, is DRAFT, the agent's wording until the owner writes his own.
  { id: "agents-sessions", explainer: "agents", ...shopMap, recorded: together, panel: "sessions", title: "Your sessions, listed.", lines: [
    "Storytree lists your conversations with AI here as active sessions.",
    "Each one is an agent at work, named for the part it is building.",
    "On 5 October, three of them were building the shop at once.",
  ], how: "A session starts when you open a conversation with a coding agent in your project. It leaves the list when it closes out, and storytree checks that against its branches and anything still running.",
  why: "With several agents at once, the first question is who is working right now. The list answers it from what the agents did, not from what they said.",
  decisions: [], surfaces: lit(land), framing: 1.05 },
  { id: "agents-arcs", explainer: "agents", ...shopMap, recorded: together, panel: "arcs", title: "Plans of work are arcs.", lines: [
    "It lists plans of work here. In storytree they are known as arcs.",
    "The shop's first arc had four parts, each an increment of work.",
    "Parts 2, 3 and 4 were built side by side.",
  ], how: "An arc has an end state and a list of increments. A session claims an increment before it starts, lands it through a pull request, and closes it.",
  why: "A plan that lives beside the work lets the next agent pick up the next piece without asking you.",
  decisions: [], surfaces: lit(land), framing: 1.05 },
  { id: "agents-claim", explainer: "agents", ...shopMap, recorded: together, panel: "arcs", title: "A claim shows in both places.", lines: [
    "A session can stake its claim on the map as well as on the arc it's working on.",
    "Part 3's session claimed the cart: its increment on the arc and its island on the map wear its colour.",
    "The name on the island is the session's name in the list.",
  ], how: "Before writing, an agent claims the increment it will build and each part it will touch. A second claim on the same work is turned away.",
  why: "Two agents editing the same thing is how work gets lost. A claim says who is on what before anyone writes.",
  // Aimed past the cart so the island sits below the arcs drawer, both in view at once.
  decisions: [], surfaces: lit(land), target: checkout, framing: .95, phone: { target: checkout, framing: .95, side: -107 }, tags: [{ target: cart, text: "Part 3: cart page and side menu" }] },
  { id: "agents-parallel", explainer: "agents", ...shopMap, recorded: together, panel: "sessions", title: "Who is on what, at a glance.", lines: [
    "This means your agents can tell who is working on what just by looking at the map.",
    "Browsing, the cart and checkout, each built by its own session, at the same time.",
  ], how: "Each claimed island wears its session's colour round its coast, and the list shows the same sessions in the same colours.",
  why: "An agent that can see what is taken picks other work instead of colliding with it.",
  // A laptop aims at Browsing, the lowest of the three, so all three names sit above the sessions list whichever step came
  // before; a phone keeps the overview, which turns no further than the claim step left it, drawn back and moved left so the
  // three stack between the sessions list and the card with their tags to their right.
  decisions: [], surfaces: lit(land), laptop: { target: browsing, framing: 1.2 }, phone: { framing: 1.4, side: -107 },
  tags: [{ target: browsing, text: "Part 2: product page, sorting, cart" }, { target: cart, text: "Part 3: cart page and side menu" }, { target: checkout, text: "Part 4: Checkout" }] },
  { id: "agents-standdown", explainer: "agents", ...shopMap, recorded: standDown, panel: "sessions", title: "An agent read the map and stood down.", lines: [
    "Later, a third session was sent to part 7 while another session held it.",
    "It read the plan, saw part 7 taken, and changed nothing.",
    "Its own words: “Part 7 (Search) is already being worked on by another session, so I've stopped there. I haven't made a workspace or changed any code.”",
  ], how: "The session read the arc and the claims on it, found both open parts held by live sessions, and claimed nothing. Asked to take part 8 over if it had stalled, it looked at that session's workspace, found it still writing, and left it alone.",
  why: "Agents that read the map don't pull work out from under each other. The record shows it happened, and why.",
  compare: { lines: [
    "Cursor's Agents window runs agents in parallel, each in its own worktree, with diffs to review.",
    "LangSmith Studio visualises and debugs agent systems, with tracing and evaluation.",
    "Linear's initiatives connect projects to goals and progress updates.",
    "Storytree ties each session to the work it claimed on the map, and each increment to the session holding it.",
  ], sources: [cursorAgents, langsmith, linear, undefined] },
  decisions: [], surfaces: lit(land), target: browsing, framing: .9, tags: [{ target: browsing, text: "part 7, held" }] },

  { id: "knowledge-inside", explainer: "knowledge", title: "What the project knows lives inside.", lines: [
    "Storytree remembers things using a knowledge graph.",
    "Inside this globe: {notes} notes, {decisions} of them decisions.",
    "Each sits beneath the story or capability it's about.",
  ], why: "Every new agent session starts on its first day. The library keeps the decisions and lessons, so the next session doesn't have to relearn them.",
  decisions: [decisions.core, decisions.loose], chips: [principle(1)], surfaces: { ...core, grounds: true }, target: centre, framing: 1, drift: true },
  { id: "knowledge-kinds", explainer: "knowledge", title: "Different notes do different jobs.", lines: [
    "Decisions record what was chosen, and why.",
    "Principles and guardrails steer judgement; definitions keep words exact.",
    "Notes link to the notes they stand on, and never loop.",
  ], why: "A future reader needs to know what kind of note they've found: a choice to respect, a rule to follow, or a way of working. Refusing loops keeps every chain of reasons readable.",
  decisions: [decisions.core, decisions.shelves], surfaces: core, target: centre, framing: .9, panel: "knowledge" },
  { id: "knowledge-shelves", explainer: "knowledge", title: "Every story keeps a shelf.", lines: [
    "Each story and capability has a shelf of front covers: the decisions that shaped it.",
    "An agent reads the spines first, then opens only what its task needs.",
    "Nothing has to be pasted into every prompt.",
  ], why: "Pasting everything in up front wastes the agent's memory, and it goes stale. A shelf puts the right few books beside the work.",
  decisions: [decisions.shelves, decisions.librarian], chips: [principle(3)], surfaces: { ...core, grounds: true, nameplates: true }, target: library, framing: .7 },
  { id: "knowledge-reads", explainer: "knowledge", title: "Follow what a session read.", lines: [
    "This is storytree's own activity, {recording}.",
    "Pick a session to follow its reads through the library, in order.",
    "It shows what the work stood on, and what it never opened.",
  ], why: "An agent's work is only as good as what it read before it acted. The path shows what the work stood on.",
  decisions: [decisions.reads, decisions.window], chips: [{ kind: "recording", text: "Recording, not live" }, partial("A read shows what was opened, not what the model understood.")],
  surfaces: { ...core, sessionTints: true }, target: centre, framing: .9, panel: "sessions" },
  { id: "knowledge-compare", explainer: "knowledge", kind: "compare", title: "Memory comes in many shapes. Storytree's sits with the work.", lines: [
    "Cursor's rules load always, by file pattern, when the agent finds them relevant, or by hand.",
    "Graphiti keeps a graph of entities and facts over time, with where each came from.",
    "Storytree keeps decisions on the shelves of the work they shaped.",
  ], sources: [cursorRules, graphiti, undefined], why: compared, decisions: [decisions.busy], surfaces: core, target: centre, framing: .9, drift: true },

  { id: "everything", explainer: "ending", title: "Now read the whole globe.", lines: [
    "Everything is back: the plan, the code, its health, the knowledge and the sessions.",
    "It's the globe you started on. Now you can read it.",
  ], why: "Nothing storytree hides is out of reach: the Show everything switch brings every surface back at any step.",
  decisions: [decisions.busy, decisions.guide], chips: [principle(4)], surfaces: complete, target: forest, framing: 1.1, drift: true },
];
