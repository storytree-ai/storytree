import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";
import type { Chip, Decision, Explainer, Group, TourStep } from "./tour.js";

/** When the comparisons were checked against each tool's own documentation (definition_b0b80acc7330). */
export const researchDate = "3 October 2026";
export const groupTitles: Record<Group, string> = {
  opening: "Why storytree", stories: "Story nodes", capabilities: "Capability nodes", knowledge: "Knowledge graph",
  sessions: "Sessions", arcs: "Arcs", ending: "The whole globe",
};
export const explainers: { id: Explainer; title: string }[] = (["stories", "capabilities", "knowledge", "sessions", "arcs"] as const).map(id => ({ id, title: groupTitles[id] }));

const adr = (number: number, title: string): Decision => ({ number, title });
const decisions = {
  problem: adr(853, "Storytree's problem and its four principles"),
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
const website = story("story_769e230c466d"), agentLink = story("story_609c3b171b3f"), world = story("story_ca702fee28cb");
const library = story("story_754e87e7d531"), forest = story("story_deee4230348c"), centre: GlobeTarget = { kind: "core" };
const onTheSite = capability("capability_18562ff0841c"), cloud = capability("capability_a954e1eb16f6");
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
  { id: "problem", explainer: "opening", kind: "beats", title: "Why storytree", lines: [
    "Your attention is the scarcest resource in AI-driven development, and coding agents spend it on noise.",
    "They write more than anyone can read, and engineers and vibe coders alike can't tell which part needs them.",
    "So you either read every line, and become the bottleneck the agents were meant to remove, or you blindly trust the model and find the problems in production.",
    "There's no in-between.",
  ], why: "Storytree's own statement of the problem it answers. The busy globe behind it is storytree's own project, every surface on at once: more than anyone can read.",
  decisions: [decisions.problem, decisions.busy], surfaces: complete, target: forest, framing: 1.1, drift: true },
  { id: "principles", explainer: "opening", kind: "principles", title: "Storytree answers to four principles.", lines: [
    "Signals must be real.", "Show what matters now; hide the rest.", "Your attention goes where you send it.", "Nothing is out of reach.",
  ], notes: [
    "Everything you see comes from the real code and the real work, and says where it came from.",
    "Nothing asks for your attention unless it needs it.",
    "You choose what to look into, and how deep to go.",
    "Whatever storytree hides, you can always bring back.",
  ], why: "Every storytree surface answers to these four. Each step of this tour shows one of them at work, and the controls below keep the third and fourth in your hands.",
  decisions: [decisions.problem], surfaces: complete, lineSurfaces: { 2: quiet }, target: forest, framing: 1.1, drift: true },

  { id: "stories-island", explainer: "stories", title: "Each island is a story.", lines: [
    "Storytree breaks up your codebase into stories.",
    "A story is something your software lets someone do.",
    "This one is the website you're reading now.",
  ], why: "People think about what software does for them, not about folders. A story groups the code by the journey it serves, so you find your way by what matters to the person using it.",
  decisions: [decisions.islands, decisions.packages], chips: [principle(1)], surfaces: land, target: website, framing: .62,
  tags: [{ target: website, text: "a story: The website" }] },
  { id: "stories-globe", explainer: "stories", title: "One project, {stories} stories.", lines: [
    "Storytree's own project has {stories} of them, from the library to the website.",
    "An island's size follows the code inside it.",
    "The longer a story's chain of dependencies, the further north it sits.",
  ], why: "Size and place carry meaning, so the globe tells you something before you read a word: big islands hold a lot of code, and northern ones stand on many others.",
  decisions: [decisions.rows, decisions.islands], chips: [principle(2)], surfaces: land, target: forest, framing: 1.1, drift: true },
  { id: "stories-roads", explainer: "stories", title: "Roads show what depends on what.", lines: [
    "A road joins two stories when one builds on the other.",
    "Pick a story and its roads light up: blue to what it builds on, violet to what builds on it.",
    "Change one island, and the roads show who feels it.",
  ], why: "A change to one story can break the stories that stand on it. The roads show where the ripples go before you make the change, and they only run one way: storytree refuses a loop.",
  decisions: [decisions.edges, decisions.pathways], chips: [principle(3)], surfaces: roads, select: "story_609c3b171b3f", target: agentLink, framing: .8 },
  { id: "stories-compare", explainer: "stories", kind: "compare", title: "Other tools map files. Storytree maps what your software does.", lines: [
    "VS Code's Explorer browses files and folders; its Outline lists a file's symbols.",
    "Aider's repo map ranks your code's names and signatures to fit the model's budget.",
    "Storytree groups the code by what it lets someone do, with the plan beside it.",
  ], sources: [vscode, aider, undefined], why: compared, decisions: [decisions.busy], surfaces: land, target: forest, framing: 1.1, drift: true },

  { id: "capabilities-territories", explainer: "capabilities", title: "Each story splits into capabilities.", lines: [
    "Stories are broken up into capabilities.",
    "A capability is one part that makes the story work, and it gets its own territory.",
    "Its share of the island follows its share of the code.",
  ], why: "A story is too big to check in one go. Capabilities cut it into parts small enough to promise something about, and the land shows how much code each part holds.",
  decisions: [decisions.islands, decisions.allocation], chips: [principle(2)], surfaces: plain, target: onTheSite, framing: .5,
  tags: [{ target: onTheSite, text: "a capability: The forest on the site" }] },
  { id: "capabilities-contracts", explainer: "capabilities", title: "Every capability makes promises.", lines: [
    "Each capability carries contracts: promises a test can check.",
    "The agent shows each test failing first, then passing.",
    "Storytree's own project holds {contracts} of them.",
  ], why: "'Done' means nothing if the agent decides what done is. So the promise comes first, then a test that fails without the work and passes with it.",
  decisions: [decisions.tests, decisions.health], chips: [partial("In your project, red then green is the agent's report: nothing re-runs it.")],
  surfaces: plain, target: onTheSite, framing: .5, panel: "story" },
  { id: "capabilities-files", explainer: "capabilities", title: "Every file is a circle.", lines: [
    "Each circle is one code file, sized by its lines.",
    "A file sits on the capability whose tests reach it.",
    "Hatched ground is code no capability claims yet.",
  ], why: "Code that belongs to no promise is code nobody is watching. Drawing every file on the capability it serves shows what is covered, and what has slipped through. This island is the drawing engine itself.",
  decisions: [decisions.allocation, decisions.islands], chips: [principle(1)], surfaces: files, target: world, framing: .62,
  tags: [{ target: world, text: "The world: the engine drawing this globe" }] },
  { id: "capabilities-health", explainer: "capabilities", title: "Health says who said so.", lines: [
    "Green is healthy, yellow untested, red failing.",
    "In storytree's own project, CI runs the tests on every merge and records what it saw.",
    "A card that isn't green says why, and who can move it.",
  ], why: "Agents say 'done' when it isn't. So every health mark says where it came from, and an agent's word never passes as proof. The yellow card open here waits on the owner: only he can connect the cloud.",
  decisions: [decisions.health, decisions.maintain], chips: [partial("In your project: what your agent reported, labelled as the agent's.")],
  surfaces: health, target: cloud, framing: .58, panel: "story", tags: [{ target: cloud, text: "untested: waits on the owner" }] },
  { id: "capabilities-compare", explainer: "capabilities", kind: "compare", title: "Quality tools measure code. Storytree tracks its promises.", lines: [
    "SonarQube's quality gates pass or fail code on conditions like coverage and detected issues.",
    "CodeScene finds hotspots from your history and code health; storytree has no such view yet.",
    "Storytree ties each piece of code to the promise it keeps, and says who vouched for it.",
  ], sources: [sonar, codescene, undefined], why: compared, decisions: [decisions.busy], surfaces: health, target: forest, framing: 1.1, drift: true },

  { id: "knowledge-inside", explainer: "knowledge", title: "What the project knows lives inside.", lines: [
    "Storytree remembers things using a knowledge graph.",
    "Inside this globe: {notes} notes, {decisions} of them decisions.",
    "Each sits beneath the story or capability it's about.",
  ], why: "Every new agent session starts on its first day. The library keeps the decisions and lessons, so the next session doesn't have to relearn them.",
  decisions: [decisions.core, decisions.loose], chips: [principle(1)], surfaces: { ...core, grounds: true }, target: centre, framing: 1, drift: true },
  { id: "knowledge-kinds", explainer: "knowledge", title: "Different notes do different jobs.", lines: [
    "Decisions record what was chosen, and why.",
    "Principles and guardrails steer judgement; definitions keep words exact.",
    "Patterns and processes say how the work gets done.",
  ], why: "A future reader needs to know what kind of note they've found: a choice to respect, a rule to follow, or a way of working.",
  decisions: [decisions.core, decisions.shelves], surfaces: core, target: centre, framing: .9, panel: "knowledge" },
  { id: "knowledge-shelves", explainer: "knowledge", title: "Every story keeps a shelf.", lines: [
    "Each story and capability has a shelf of front covers: the decisions that shaped it.",
    "An agent reads the spines first, then opens only what its task needs.",
    "Nothing has to be pasted into every prompt.",
  ], why: "Pasting everything in up front wastes the agent's memory, and it goes stale. A shelf puts the right few books beside the work.",
  decisions: [decisions.shelves, decisions.librarian], chips: [principle(3)], surfaces: { ...core, grounds: true, nameplates: true }, target: library, framing: .7 },
  { id: "knowledge-links", explainer: "knowledge", title: "Notes link, and never loop.", lines: [
    "Notes link to the notes they stand on.",
    "The graph refuses loops, so every chain of reasons ends.",
    "A replaced decision stays, linked to what replaced it.",
  ], why: "Reasons that go round in circles explain nothing. Refusing loops keeps every chain readable, and keeping replaced decisions shows what was tried before.",
  decisions: [decisions.core, decisions.loose], chips: [principle(4)], surfaces: core, target: centre, framing: .78, tags: [{ target: centre, text: "notes no shelf reaches gather here" }] },
  { id: "knowledge-compare", explainer: "knowledge", kind: "compare", title: "Memory comes in many shapes. Storytree's sits with the work.", lines: [
    "Cursor's rules load always, by file pattern, when the agent finds them relevant, or by hand.",
    "Graphiti keeps a graph of entities and facts over time, with where each came from.",
    "Storytree keeps decisions on the shelves of the work they shaped.",
  ], sources: [cursorRules, graphiti, undefined], why: compared, decisions: [decisions.busy], surfaces: core, target: centre, framing: .9, drift: true },

  { id: "sessions-recording", explainer: "sessions", title: "Agents at work, recorded.", lines: [
    "Storytree visualises agents working through sessions.",
    "This is storytree's own activity, {recording}.",
    "Each session has a colour, and tints the stories it's working on.",
  ], why: "With a dozen sessions, nobody knows who changed what. One shared record of who is on what replaces the guessing.",
  decisions: [decisions.closeOut, decisions.guide], chips: [{ kind: "recording", text: "Recording, not live" }], surfaces: tinted, target: forest, framing: 1.1, drift: true, panel: "sessions" },
  { id: "sessions-claims", explainer: "sessions", title: "A session claims its work first.", lines: [
    "Before an agent writes, it claims the work it will do.",
    "A second claim on the same work is turned away.",
    "A session leaves the list only when its close-out checks out.",
  ], why: "Two agents editing the same thing is how work gets lost. A claim says who is on what before anyone writes, and the close-out is checked against the session's branches and running work.",
  decisions: [decisions.claims, decisions.closeOut], chips: [partial("Claims run on trust: an agent that never asks shows up afterwards, as unplanned work.")],
  surfaces: tinted, target: forest, framing: 1.1, drift: true, panel: "sessions" },
  { id: "sessions-reads", explainer: "sessions", title: "Follow what a session read.", lines: [
    "Pick a session to follow its reads through the library, in order.",
    "It shows what the work stood on, and what it never opened.",
  ], why: "An agent's work is only as good as what it read before it acted. The path shows what the work stood on.",
  decisions: [decisions.reads, decisions.window], chips: [partial("A read shows what was opened, not what the model understood.")],
  surfaces: { ...core, sessionTints: true }, target: centre, framing: .9, panel: "sessions" },
  { id: "sessions-compare", explainer: "sessions", kind: "compare", title: "Harnesses run agents. Storytree shows the work they share.", lines: [
    "Cursor's Agents window runs agents in parallel, each in its own worktree, with diffs to review.",
    "LangSmith Studio visualises and debugs agent systems, with tracing and evaluation.",
    "Storytree ties each session to the work it claimed, what it read and how it closed.",
  ], sources: [cursorAgents, langsmith, undefined], why: compared, decisions: [decisions.busy], surfaces: tinted, target: forest, framing: 1.1, drift: true },

  { id: "arcs-plan", explainer: "arcs", title: "Bigger work is an arc.", lines: [
    "In storytree, work is planned using arcs.",
    "An arc says what it's for and what done looks like, then breaks into increments.",
    "Green bars have landed; yellow ones are waiting.",
  ], why: "A journey needs an end state to hold it together, and pieces small enough to finish. Waiting work shows as waiting, never as progress.",
  decisions: [decisions.arcs, decisions.waits, decisions.landed], chips: [principle(2)], surfaces: roads, target: forest, framing: 1.1, drift: true, panel: "arcs" },
  { id: "arcs-questions", explainer: "arcs", title: "Only your calls wait on you.", lines: [
    "Remember twelve agents waiting on you?",
    "Here, agents make the everyday calls themselves.",
    "Only what's truly yours to decide waits, written up with its stakes and options.",
  ], why: "Approving every step is exhausting. Agents decide what is reversible and theirs to decide, and write a question for the rest, holding only the work that needs your answer.",
  decisions: [decisions.questions, decisions.waits], chips: [principle(2)], surfaces: roads, target: forest, framing: 1.1, drift: true, panel: "arcs" },
  { id: "arcs-compare", explainer: "arcs", kind: "compare", title: "Planners track goals. Storytree tracks the work your agents do.", lines: [
    "Linear's initiatives connect projects to goals and progress updates.",
    "GitHub Projects lays issues and pull requests out as tables, boards and roadmaps.",
    "Storytree ties each increment to the claims, landings and questions holding it.",
  ], sources: [linear, github, undefined], why: compared, decisions: [decisions.busy], surfaces: roads, target: forest, framing: 1.1, drift: true },

  { id: "everything", explainer: "ending", title: "Now read the whole globe.", lines: [
    "Everything is back: the plan, the code, its health, the knowledge and the sessions.",
    "It's the globe you started on. Now you can read it.",
  ], why: "Nothing storytree hides is out of reach: the Show everything switch brings every surface back at any step.",
  decisions: [decisions.busy, decisions.guide], chips: [principle(4)], surfaces: complete, target: forest, framing: 1.1, drift: true },
];
