import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";
import type { Chip, Decision, Explainer, Group, TourStep } from "./tour.js";

/** When the comparisons were checked against each tool's own documentation (definition_b0b80acc7330). */
export const researchDate = "3 October 2026";
export const groupTitles: Record<Group, string> = {
  opening: "Why storytree", stories: "Story nodes", capabilities: "Capability nodes", knowledge: "Knowledge graph",
  sessions: "Sessions", arcs: "Arcs", scale: "At full scale", ending: "The whole globe",
};
export const explainers: { id: Explainer; title: string }[] = (["stories", "capabilities", "knowledge", "sessions", "arcs"] as const).map(id => ({ id, title: groupTitles[id] }));

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
const world = story("story_ca702fee28cb");
const library = story("story_754e87e7d531"), forest = story("story_deee4230348c"), centre: GlobeTarget = { kind: "core" };
const onTheSite = capability("capability_18562ff0841c"), cloud = capability("capability_a954e1eb16f6");
// Conduit's stories (conduit-snapshot.json): the RealWorld site Codex built with storytree on the test laptop.
const discover = story("story_a4dbabc54188");
const ci = story("story_0f2877a9d736"), backendProfiles = story("story_9e44fb81bdb7"), discuss = story("story_885ea80b96a5");
const conduit = { map: "conduit" as const };
// Storytree's own recorded growth (own-snapshot.json): Act 2 arrives on it, grown from a point as its agents built it (ADR-0889 2.2b).
const own = { map: "own" as const, target: { kind: "core" } as GlobeTarget };
// The shop (shop-snapshot.json): the store the test laptop's Claude Code built with storytree, where the chapters teach (ADR-0890),
// walking only three of its stories. Read from its saved snapshot, so the rebuilt shop is a data swap.
const teaching = ["story_0c36494ccf30", "story_29b9f7826e86", "story_24ca85400abc"];
const cart = story(teaching[1]!);
/** How long the arrival's time-lapse plays at 1×. */
export const arrivalSeconds = 15;
const conduitDecision = adr(879, "Concepts grow on Conduit, a smaller real project");
const realworld = { name: "Conduit's build, judged", url: "https://github.com/storytree-ai/storytree/blob/main/packages/app-setup/evidence/first-build/conduit.md" };
const vscode = { name: "VS Code docs", url: "https://code.visualstudio.com/docs/editing/getting-started/userinterface#_explorer-view" };
const aider = { name: "Aider docs", url: "https://aider.chat/docs/repomap.html" };
const sonar = { name: "SonarQube docs", url: "https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates" };
const codescene = { name: "CodeScene docs", url: "https://codescene.io/docs/guides/technical/hotspots.html" };
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
  // DRAFT (ADR-0889 2.1): the agent's wording for the pain, standing in until the owner writes his own.
  { id: "pain", explainer: "opening", kind: "beats", ...own, growth: "seed", title: "The problem", lines: [
    "Your agents write more code than anyone can read.",
    "You can't tell which part of it needs you.",
    "So you read every line, or you trust every line.",
  ], why: "Your attention is the scarcest resource in AI-driven development, and coding agents spend it on noise. Reading every line makes you the bottleneck the agents were meant to remove; trusting every line finds the problems in production. There's no in-between.",
  decisions: [], surfaces: complete, framing: 1.1 },
  { id: "grow", explainer: "opening", kind: "beats", ...own, growth: { seconds: arrivalSeconds }, title: "Storytree, built with storytree", lines: [
    // DRAFT (ADR-0889 2.2b): the agent's naming, standing in until the owner writes his own.
    "This is storytree, built with storytree.",
    "{ownDays} days of its agents' work: every island, road and note, replayed from its own records.",
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

{ id: "stories-grow", explainer: "stories", ...conduit, stage: "empty", lineStages: { 3: "stories" }, title: "Watch a real project grow.", lines: [
    "Storytree breaks up your codebase into stories.",
    "This is Conduit, a blogging site that Codex built with storytree on a test laptop, 1 to 2 October 2026.",
    "Before writing any code, its agent wrote five stories: one for each thing a reader can do.",
  ], why: "Storytree's own globe is a lot to take in. Conduit is small, finished and real: its globe here is replayed from its own saved library, stage by stage, as its agent built it. Nothing is drawn by hand.",
  decisions: [conduitDecision, decisions.islands], chips: [{ kind: "recording", text: "Recorded, 1–2 October 2026" }], surfaces: land, target: discuss, framing: .72 },
  { id: "stories-island", explainer: "stories", ...conduit, stage: "stories", title: "Each island is a story.", lines: [
    "A story is something your software lets someone do.",
    "Discover articles. Manage my account. Read and publish articles.",
    "Discuss an article. Connect with authors.",
  ], why: "People think about what software does for them, not about folders. A story groups the code by the journey it serves, so you find your way by what matters to the person using it.",
  decisions: [decisions.islands, decisions.packages], chips: [principle(1)], surfaces: land, target: discover, framing: .55,
  tags: [{ target: discover, text: "a story: Discover articles" }] },
  { id: "stories-roads", explainer: "stories", ...conduit, stage: "planned", title: "Roads show what depends on what.", lines: [
    "Next, the agent said which part builds on which.",
    "Pick a story and its roads light up: blue to what it builds on, violet to what builds on it.",
    "Change one island, and the roads show who feels it.",
  ], why: "A change to one story can break the stories that stand on it. The roads show where the ripples go before you make the change, and they only run one way: storytree refuses a loop.",
  decisions: [decisions.edges, decisions.pathways], chips: [principle(3)], surfaces: roads, select: "story_acab0558201e", target: discuss, framing: .72 },
  { id: "stories-compare", explainer: "stories", ...conduit, stage: "planned", kind: "compare", title: "Other tools map files. Storytree maps what your software does.", lines: [
    "VS Code's Explorer browses files and folders; its Outline lists a file's symbols.",
    "Aider's repo map ranks your code's names and signatures to fit the model's budget.",
    "Storytree groups the code by what it lets someone do, with the plan beside it.",
  ], sources: [vscode, aider, undefined], why: compared, decisions: [decisions.busy], surfaces: roads, target: discuss, framing: .72 },

  { id: "capabilities-trees", explainer: "capabilities", ...conduit, stage: "planned", lineStages: { 3: "part1" }, title: "Each story splits into capabilities.", lines: [
    "Stories are broken up into capabilities.",
    "A capability is one part that makes the story work.",
    "Conduit's agent gave each story one capability, with one contract, and landed them in order.",
  ], why: "A story is too big to check in one go. Capabilities cut it into parts small enough to promise something about, and each one can be claimed, built and landed on its own.",
  decisions: [decisions.islands, decisions.allocation], chips: [principle(2)], surfaces: land, target: discover, framing: .55,
  tags: [{ target: discover, text: "part 1 landed, 1 October 21:32 UTC" }] },
  { id: "capabilities-contracts", explainer: "capabilities", ...conduit, stage: "part1", title: "Every capability makes promises.", lines: [
    "Each capability carries contracts: promises a test can check.",
    "Conduit's agent wrote its first test before any code, and reported it failing: “index.html must exist”.",
    "Then it built the page, and reported the test passing.",
  ], why: "'Done' means nothing if the agent decides what done is. So the promise comes first, then a test that fails without the work and passes with it. The words quoted are the agent's own note in Conduit's library.",
  decisions: [decisions.tests, decisions.health], chips: [partial("Red then green here is the agent's report: nothing re-ran it.")], surfaces: land, target: discover, framing: .55 },
  { id: "capabilities-health", explainer: "capabilities", ...conduit, stage: "frontend", title: "Health says who said so.", lines: [
    "Every Conduit contract reads passing, because its agent said its tests pass.",
    "Storytree labels that as the agent's word: nothing in storytree re-ran them.",
    "The proof came from outside: the official RealWorld test suite passed all 139 of its checks.",
  ], sources: [undefined, undefined, realworld],
  why: "Agents say 'done' when it isn't. So every health mark says where it came from, and an agent's word never passes as proof. On storytree's own project, CI re-runs the tests: you'll see that at full scale.",
  decisions: [decisions.health, decisions.maintain], chips: [partial("Conduit's health is what its agent reported.")], surfaces: land, target: discuss, framing: .72 },
  { id: "capabilities-compare", explainer: "capabilities", ...conduit, stage: "frontend", kind: "compare", title: "Quality tools measure code. Storytree tracks its promises.", lines: [
    "SonarQube's quality gates pass or fail code on conditions like coverage and detected issues.",
    "CodeScene finds hotspots from your history and code health; storytree has no such view yet.",
    "Storytree ties each piece of code to the promise it keeps, and says who vouched for it.",
  ], sources: [sonar, codescene, undefined], why: compared, decisions: [decisions.busy], surfaces: land, target: discuss, framing: .72 },

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

  { id: "scale-territories", explainer: "scale", title: "Back on storytree's globe, the code is drawn.", lines: [
    "Conduit's code isn't laid out one package per story, so storytree drew no land for it.",
    "Storytree's own code is: each capability gets its own territory.",
    "Its share of the island follows its share of the code.",
  ], why: "Same ideas, bigger project: {stories} stories, {capabilities} capabilities, {contracts} contracts. When each story's code sits in its own package, storytree can survey it and draw the land.",
  decisions: [decisions.islands, decisions.allocation, decisions.packages], chips: [principle(2)], surfaces: plain, target: onTheSite, framing: .5,
  tags: [{ target: onTheSite, text: "a capability: The forest on the site" }] },
  { id: "scale-files", explainer: "scale", title: "Every file is a circle.", lines: [
    "Each circle is one code file, sized by its lines.",
    "A file sits on the capability whose tests reach it.",
    "Hatched ground is code no capability claims yet.",
  ], why: "Code that belongs to no promise is code nobody is watching. Drawing every file on the capability it serves shows what is covered, and what has slipped through. This island is the drawing engine itself.",
  decisions: [decisions.allocation, decisions.islands], chips: [principle(1)], surfaces: files, target: world, framing: .62,
  tags: [{ target: world, text: "The world: the engine drawing this globe" }] },
  { id: "scale-health", explainer: "scale", title: "Here, CI checks the health.", lines: [
    "Green is healthy, yellow untested, red failing.",
    "In storytree's own project, CI runs the tests on every merge and records what it saw.",
    "A card that isn't green says why, and who can move it.",
  ], why: "An agent's word never passes as proof. Here the verified column is CI's. The yellow card open here waits on the owner: only he can connect the cloud.",
  decisions: [decisions.health, decisions.maintain], chips: [principle(1)],
  surfaces: health, target: cloud, framing: .58, panel: "story", tags: [{ target: cloud, text: "untested: waits on the owner" }] },
  { id: "scale-questions", explainer: "scale", title: "Only your calls wait on you.", lines: [
    "Remember twelve agents waiting on you?",
    "Here, agents make the everyday calls themselves.",
    "Only what's truly yours to decide waits, written up with its stakes and options.",
  ], why: "Approving every step is exhausting. Agents decide what is reversible and theirs to decide, and write a question for the rest, holding only the work that needs your answer.",
  decisions: [decisions.questions, decisions.waits], chips: [principle(2)], surfaces: roads, target: forest, framing: 1.1, drift: true, panel: "arcs" },

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
