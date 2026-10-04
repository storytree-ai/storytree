import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";
import type { Chip, Decision, Explainer, Group, TourStep } from "./tour.js";

/** When the comparisons were checked against each tool's own documentation (definition_b0b80acc7330). */
export const researchDate = "3 October 2026";
export const groupTitles: Record<Group, string> = {
  opening: "Why storytree", map: "The map", knowledge: "Knowledge graph", sessions: "Sessions", arcs: "Arcs", ending: "The whole globe",
};
export const explainers: { id: Explainer; title: string }[] = (["map", "knowledge", "sessions", "arcs"] as const).map(id => ({ id, title: groupTitles[id] }));

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
const tinted: Partial<GlobeSurfaces> = { ...land, roads: true, sessionTints: true };

const story = (id: string): GlobeTarget => ({ kind: "story", story: id });
const capability = (id: string): GlobeTarget => ({ kind: "capability", capability: id });
const library = story("story_754e87e7d531"), forest = story("story_deee4230348c"), centre: GlobeTarget = { kind: "core" };
// Conduit's stories (conduit-snapshot.json): the RealWorld site Codex built with storytree on the test laptop.
const discover = story("story_a4dbabc54188");
const ci = story("story_0f2877a9d736"), backendProfiles = story("story_9e44fb81bdb7"), discuss = story("story_885ea80b96a5");
const conduit = { map: "conduit" as const };
// Storytree's own recorded growth (own-snapshot.json): Act 2 arrives on it, grown from a point as its agents built it (ADR-0889 2.2b).
const own = { map: "own" as const, target: { kind: "core" } as GlobeTarget };
// The shop (shop-snapshot.json): the store the test laptop's Claude Code sessions rebuilt side by side with storytree, where the
// chapters teach (ADR-0890), walking only three of its stories: Browsing, The cart and Checkout.
const teaching = ["story_9d312bf7fc51", "story_c3e9a28aef14", "story_a2276e03429a"];
const browsing = story(teaching[0]!), cart = story(teaching[1]!), checkout = story(teaching[2]!), ordersId = "story_de7821cbec70", orders = story(ordersId);
const cartPage = capability("capability_fb0f52101882");
// The map chapter's steps are the shop, whole, with its three teaching stories lit and the rest dimmed. The drawing dims
// only where session tints are on; the shop's whole globe has no live sessions, so they add nothing else.
const shopMap = { map: "shop" as const, focus: teaching };
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
const github = { name: "GitHub docs", url: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects" };
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

    // DRAFT (ADR-0889 2.2b): the agent's wording for the cut to the shop, standing in until the owner writes his own.
  { id: "start-small", explainer: "opening", kind: "beats", map: "shop", focus: teaching, title: "Let's start small", lines: [
    "That's a big one. Let's start small.",
    "An online shop that coding agents built with storytree.",
    "Three of its stories: browse the products, review the cart, check out.",
  ], decisions: [], surfaces: complete, target: cart, framing: 1.05 },

  // The map (ADR-0891): the owner's five steps on the shop's three teaching stories. Lines quoted from the owner are his;
  // every other line, and each step's How and Why, is DRAFT, the agent's wording until the owner writes his own.
  { id: "map-stories", explainer: "map", ...shopMap, title: "Each island is a story.", lines: [
    "Storytree breaks up your codebase into stories.",
    "A story is something your software lets someone do.",
    "Here: browse the products, review the cart, check out.",
  ], how: "Before writing code, the shop's agents wrote its stories into storytree's plan. Each story's code lives in its own package, and storytree draws each package as an island.",
  why: "People think about what software does for them, not about folders. Grouping the code by the journey it serves lets you find your way by what matters to the person using it.",
  decisions: [], surfaces: lit(land), target: cart, framing: .9, tags: [{ target: cart, text: "a story: The cart" }] },
  { id: "map-parts", explainer: "map", ...shopMap, title: "Stories split into parts.", lines: [
    "Stories are split into parts.",
    "Each part is one piece that makes the story work.",
    "The cart has two: the cart page and the menu.",
  ], how: "Storytree calls a part a capability. Each one carries promises a test can check, and an agent claims it, builds it and lands it on its own.",
  why: "A story is too big to check in one go. Parts are small enough to promise something about, and to hand to one agent at a time.",
  decisions: [], surfaces: lit(plain), target: cart, framing: .55, tags: [{ target: cartPage, text: "a part: Cart page" }] },
  { id: "map-code", explainer: "map", ...shopMap, title: "Your code is the dots.", lines: [
    "Your code is shown as dots in the parts.",
    "Each dot is one code file, sized by its lines.",
    "A file sits in the part whose tests reach it.",
  ], how: "Storytree reads the code itself: each story's package, its files, and which part's tests reach each file. Code no part's tests reach is drawn hatched: nobody is watching it yet.",
  why: "Code that belongs to no promise is code nobody is checking. Drawing every file in the part it serves shows what is covered, and what has slipped through.",
  decisions: [], surfaces: lit(files), target: checkout, framing: .55 },
  { id: "map-health", explainer: "map", ...shopMap, title: "Parts have colours.", lines: [
    "Parts have colours.",
    "Green is a part whose tests pass; red would be one whose tests fail.",
    "The shop's colours come from its own CI runs, not from its agents' word.",
  ], how: "The shop's CI ran its tests, and storytree matched each result to the promise it checks. On Browsing, the dark, hatched ground is code no part's tests reach yet: three of its seven parts have no tests run.",
  why: "Agents say 'done' when it isn't. A colour counts only when something other than the agent checked it, and it always says where it came from.",
  decisions: [], surfaces: lit(health), target: browsing, framing: .6, tags: [{ target: browsing, text: "hatched: code no test reaches yet" }] },
  { id: "map-grow", explainer: "map", ...shopMap, focus: [...teaching, ordersId], growth: { seconds: 10, stage: "pr6-building" }, title: "As it grows, stories are added.", lines: [
    "As your project grows, more stories are added.",
    "Each story is built as its own self-contained part, with a road to the stories it depends on.",
    "Orders came with the shop's second round of work, its roads running into checkout, the cart and the products.",
  ], how: "One codebase, one package per story. A road runs from a story to each story it builds on, and storytree refuses a road that would close a loop, so the dependencies always run one way.",
  why: "A change to one story can break the stories that stand on it. The roads show where the ripples go before you make the change.",
  compare: { lines: [
    "VS Code's Explorer browses files and folders; its Outline lists a file's symbols.",
    "Aider's repo map ranks your code's names and signatures to fit the model's budget.",
    "Storytree groups the code by what it lets someone do, with the plan beside it.",
  ], sources: [vscode, aider, undefined] },
  decisions: [], surfaces: lit(roads), target: orders, framing: 1.0, tags: [{ target: orders, text: "a new story: Orders" }] },

  { id: "sessions-claim", explainer: "sessions", ...conduit, stage: "part1-building", title: "One session, one part.", lines: [
    "Storytree visualises agents working through sessions.",
    "Each part of Conduit was built by a fresh Codex session, told only to carry on with the next part.",
    "While a session works, the island it claimed wears its colour.",
  ], why: "With a dozen sessions, nobody knows who changed what. One shared record of who is on what replaces the guessing. A claim says who is on what before anyone writes.",
  decisions: [decisions.claims, decisions.guide], chips: [{ kind: "recording", text: "Recorded, 1 October 2026" }], surfaces: tinted, target: discover, framing: .55,
  tags: [{ target: discover, text: "claimed: “Build part 1 home feed”" }] },
  { id: "sessions-landing", explainer: "sessions", ...conduit, stage: "part1", lineStages: { 2: "part3-building", 3: "frontend" }, title: "Work lands one part at a time.", lines: [
    "1 October, 21:32 UTC: part 1 landed, and its session's colour left the island.",
    "Each new session found its place from the plan alone, with no chat history.",
    "By 00:31 the next morning, all five parts had landed.",
  ], why: "An agent's memory ends with its session. The plan, the claims and the landings live in the library, so the next session starts where the last one stopped.",
  decisions: [decisions.closeOut, decisions.landed], chips: [principle(1)], surfaces: tinted, target: discuss, framing: .72 },
  { id: "sessions-close", explainer: "sessions", ...conduit, stage: "backend1-building", title: "A session claims first, and closes out last.", lines: [
    "Before an agent writes, it claims the work it will do.",
    "A second claim on the same work is turned away.",
    "A session leaves the list only when its close-out checks out.",
  ], why: "Two agents editing the same thing is how work gets lost. The close-out is checked against the session's branches and running work. Here, one backend session holds a capability on each of two islands, both in its colour.",
  decisions: [decisions.claims, decisions.closeOut], chips: [partial("Claims run on trust: an agent that never asks shows up afterwards, as unplanned work.")],
  surfaces: tinted, target: backendProfiles, framing: 1.05 },
  { id: "sessions-compare", explainer: "sessions", ...conduit, stage: "frontend", kind: "compare", title: "Harnesses run agents. Storytree shows the work they share.", lines: [
    "Cursor's Agents window runs agents in parallel, each in its own worktree, with diffs to review.",
    "LangSmith Studio visualises and debugs agent systems, with tracing and evaluation.",
    "Storytree ties each session to the work it claimed, what it read and how it closed.",
  ], sources: [cursorAgents, langsmith, undefined], why: compared, decisions: [decisions.busy], surfaces: tinted, target: discuss, framing: .72 },

  { id: "arcs-plan", explainer: "arcs", ...conduit, stage: "frontend", lineStages: { 3: "ci" }, title: "Bigger work is an arc.", lines: [
    "In Storytree work is planned using arcs.",
    "Conduit's first arc was its frontend: five parts, and a fix each time the official suite found a failure.",
    "Then a new story: every pull request runs the official suite.",
  ], why: "A journey needs an end state to hold it together, and pieces small enough to finish. Each piece is an increment: claimed, landed and closed in turn.",
  decisions: [decisions.arcs, decisions.landed], chips: [principle(2)], surfaces: roads, target: ci, framing: .95,
  tags: [{ target: ci, text: "a new story: Review changes with official CI" }] },
  { id: "arcs-grow", explainer: "arcs", ...conduit, stage: "backend-planned", title: "A new arc grows the globe.", lines: [
    "Conduit's second arc gave it its own backend.",
    "The agent planned six new stories, and the roads rewired.",
    "Pick a backend story: the frontend builds on it.",
  ], why: "Planning comes before code. The new stories and their roads were in the library before the backend had a line of code, so every session after knew where its work fitted.",
  decisions: [decisions.arcs, decisions.edges], chips: [principle(3)], surfaces: roads, select: "story_607f121daf0b", target: backendProfiles, framing: 1.05 },
  { id: "arcs-landed", explainer: "arcs", ...conduit, stage: "backend2-building", lineStages: { 2: "backend4-building", 3: "complete" }, title: "Increments land, one pull request at a time.", lines: [
    "Each backend part landed as its own pull request.",
    "While a part is claimed, its islands wear its session's colour.",
    "On 2 October, Conduit grew from five islands to twelve.",
  ], why: "Waiting work shows as waiting, never as progress: a planned part stays a seedling, and the arc closes when its last increment lands.",
  decisions: [decisions.waits, decisions.landed], chips: [principle(1)], surfaces: roads, target: backendProfiles, framing: 1.05 },
  { id: "arcs-compare", explainer: "arcs", ...conduit, stage: "complete", kind: "compare", title: "Planners track goals. Storytree tracks the work your agents do.", lines: [
    "Linear's initiatives connect projects to goals and progress updates.",
    "GitHub Projects lays issues and pull requests out as tables, boards and roadmaps.",
    "Storytree ties each increment to the claims, landings and questions holding it.",
  ], sources: [linear, github, undefined], why: compared, decisions: [decisions.busy], surfaces: roads, target: backendProfiles, framing: 1.05, drift: true },

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
