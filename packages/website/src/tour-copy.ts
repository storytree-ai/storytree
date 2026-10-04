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
// chapters teach (ADR-0890), walking only three of its stories: Browsing, The cart and Checkout.
const teaching = ["story_9d312bf7fc51", "story_c3e9a28aef14", "story_a2276e03429a"];
const browsing = story(teaching[0]!), cart = story(teaching[1]!), checkout = story(teaching[2]!), ordersId = "story_de7821cbec70", orders = story(ordersId);
const cartPage = capability("capability_fb0f52101882");
// Two recorded moments in the shop's records: parts 2, 3 and 4 claimed by three sessions at once, and the session sent to
// part 7 while part 7 and part 8 were held, before it stood down (08:03:17).
const together = "2026-10-04T06:50:00.000Z", standDown = "2026-10-04T08:03:00.000Z";
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

  // Agents on the map (ADR-0893): the shop's own records at two recorded moments, 4 October 2026: parts 2, 3 and 4 built by three
  // sessions at once, then the session sent to part 7 while another held it. The owner's lines are his; every other line, and
  // each step's How and Why, is DRAFT, the agent's wording until the owner writes his own.
  { id: "agents-fix", explainer: "agents", kind: "fixes", ...shopMap, recorded: together, title: "What storytree fixes", lines: [
    "Agents see each other working on the map",
  ], notes: [
    "Agents colliding in a void of code",
  ], why: "In the first act a dozen agents worked blind: nobody could tell who was on what. Storytree puts every session's work on the same map, so each agent can see the others before it starts.",
  decisions: [], surfaces: lit(land), framing: 1.05 },
  { id: "agents-sessions", explainer: "agents", ...shopMap, recorded: together, panel: "sessions", title: "Your sessions, listed.", lines: [
    "Storytree lists your conversations with AI here as active sessions.",
    "Each one is an agent at work, named for the part it is building.",
    "On 4 October, three of them were building the shop at once.",
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
  decisions: [], surfaces: lit(land), target: checkout, framing: .95, tags: [{ target: cart, text: "Part 3: cart page and menu" }] },
  { id: "agents-parallel", explainer: "agents", ...shopMap, recorded: together, panel: "sessions", title: "Who is on what, at a glance.", lines: [
    "This means your agents can tell who is working on what just by looking at the map.",
    "Browsing, the cart and checkout, each built by its own session, at the same time.",
  ], how: "Each claimed island wears its session's colour round its coast, and the list shows the same sessions in the same colours.",
  why: "An agent that can see what is taken picks other work instead of colliding with it.",
  decisions: [], surfaces: lit(land), framing: 1.05,
  tags: [{ target: browsing, text: "Part 2: Browsing" }, { target: cart, text: "Part 3: cart page and menu" }, { target: checkout, text: "Part 4: Checkout" }] },
  { id: "agents-standdown", explainer: "agents", ...shopMap, recorded: standDown, panel: "sessions", title: "An agent read the map and stood down.", lines: [
    "Later, a third session was sent to part 7 while another session held it.",
    "It read the plan, saw part 7 taken, and changed nothing.",
    "Its own words: “Changed nothing: part 7 is held by live session c3831547 and part 8 by 83723b4f, and every other increment is closed.”",
  ], how: "The session read the arc and the claims on it, found both open parts held by live sessions, and closed out without claiming anything. Asked later to take part 8 over if it had stalled, it found that session still live and declined.",
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
