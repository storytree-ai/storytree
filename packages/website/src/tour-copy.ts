import type { Explainer, TourStep } from "./tour.js";

export const researchDate = "2026-10-03";
export const explainers: { id: Explainer; title: string }[] = [
  { id: "stories", title: "Story nodes" }, { id: "capabilities", title: "Capability nodes" },
  { id: "knowledge", title: "Knowledge graph" }, { id: "sessions", title: "Sessions" }, { id: "arcs", title: "Arcs" },
];
const decisions = {
  attention: { number: 853, title: "Attention is scarce", reason: "Signals must be real; you decide where your attention goes." },
  guide: { number: 852, title: "One surface at a time", reason: "The guide reuses the app’s globe controls and keeps a way past every explanation." },
  tour: { number: 857, title: "Five explainers, then free play", reason: "Start with the whole globe, explain its parts, and leave the visitor free to explore." },
  boundary: { number: 819, title: "A package for each story", reason: "Code ownership follows the behaviour a story promises." },
  islands: { number: 804, title: "Code islands", reason: "Land, territories and file circles connect the plan to measured code." },
  allocation: { number: 838, title: "Trace code to its capability", reason: "Tests and measured execution evidence assign code; unclaimed code stays visible." },
  rows: { number: 839, title: "Rows by dependency depth", reason: "A story’s position shows how far its chain of dependencies reaches." },
  edges: { number: 847, title: "Package edges have a direction", reason: "The machine checks dependency loops and keeps stories from leaning on the frame." },
  tests: { number: 623, title: "Minimal viable TDD", reason: "A small test should fail for the missing behaviour, then pass when it exists." },
  health: { number: 744, title: "Health says what was checked", reason: "Proposed, untested, healthy and unhealthy describe different evidence states." },
  reasons: { number: 825, title: "Health you can maintain", reason: "A capability should say why it is not green and who can move it." },
  shelves: { number: 627, title: "A shelf for each capability", reason: "Agents read the spines first, then open only the knowledge their task needs." },
  graph: { number: 647, title: "Knowledge inside the planet", reason: "A graph of project knowledge rejects loops; history is retained when decisions change." },
  loose: { number: 658, title: "Loose notes at the core", reason: "Knowledge unreachable from any story or capability shelf still has a place, at the centre." },
  librarian: { number: 780, title: "Graduate learning; curate when needed", reason: "Each landing preserves durable learning; changes to decisions trigger curation." },
  reads: { number: 740, title: "Session reading paths", reason: "Recorded reads draw a path in the session’s colour, making its context inspectable." },
  window: { number: 746, title: "The session’s context window", reason: "Transcript evidence distinguishes what is in a window from older reads. Missing evidence stays missing." },
  nudge: { number: 739, title: "Context guidance for Claude Code", reason: "A context reading can prompt a session to wrap up. Harness support is explicit, not assumed." },
  close: { number: 758, title: "Verify the close-out", reason: "A session’s safe-to-close claim is checked against its branches and running work." },
  arcs: { number: 638, title: "The arc surface", reason: "Intent and an end state hold a journey together while increments make the work manageable." },
  waits: { number: 760, title: "Make waits visible", reason: "An increment waiting on other work appears with that dependency, instead of looking ready." },
  landed: { number: 772, title: "Landed is a work outcome", reason: "A green increment bar records a landing; it does not certify every behaviour of the product." },
  owner: { number: 824, title: "Owner decisions live in questions", reason: "The owner’s open questions have a durable place on the arc." },
};
type Reason = keyof typeof decisions;
const why = (...keys: Reason[]) => keys.map(key => decisions[key]);
const all = { sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true } as const;
const land = { ...all, knowledgeCore: false, sessionTints: false, territories: false, fileCircles: false } as const;
const core = { ...all, sea: false, grounds: false, roads: false, nameplates: false, territories: false, fileCircles: false, sessionTints: false } as const;
const forest = { kind: "story", story: "story_deee4230348c" } as const;
const library = { kind: "story", story: "story_754e87e7d531" } as const;
const territory = { kind: "capability", capability: "capability_8ffc78a4bad2" } as const;
const centre = { kind: "core" } as const;
const make = (id: string, explainer: TourStep["explainer"], title: string, lines: string[], reasons: Reason[], view: Partial<TourStep> = {}): TourStep => ({
  id, explainer, title, lines, why: why(...reasons), surfaces: all, target: forest, framing: 1.35, ...view,
});

export const steps: TourStep[] = [
  make("problem", "opening", "Your attention has a limit.", [
    "Your attention is the scarcest resource in AI-driven development, and coding agents spend it on noise.",
    "They write more than anyone can read, and engineers and vibe coders alike can't tell which part needs them.",
    "So you either read every line, and become the bottleneck the agents were meant to remove, or you blindly trust the model and find the problems in production.",
    "There's no in-between.",
  ], ["attention", "tour"]),
  make("principles", "opening", "Four principles for the view.", [
    "Signals must be real.", "Show what matters now; hide the rest.", "Your attention goes where you send it.", "Nothing is out of reach.",
  ], ["attention", "guide"]),

  make("stories-islands", "stories", "One island, one story.", [
    "storytree breaks up your codebase into stories", "A story describes something the software does. Each island is one story.", "You are looking at Storytree’s own saved project, not a generated example.",
  ], ["boundary", "islands"], { surfaces: land, target: forest }),
  make("stories-rows", "stories", "A place in the dependency chain.", [
    "The islands sit in rows by dependency depth.", "Deeper chains sit further north. Position helps explain what a story builds on.",
  ], ["rows", "edges"], { surfaces: land, target: library, framing: 1.5 }),
  make("stories-roads", "stories", "Roads run one way.", [
    "Roads connect stories through their recorded dependencies.", "A dependency has a direction: one piece of behaviour relies on another.", "An import dependency is not the same as two files often changing together.",
  ], ["edges", "islands"], { surfaces: land, target: forest }),
  make("stories-growth", "stories", "Land follows code.", [
    "An island grows with the code measured in its package.", "Small islands keep enough room to see; larger ones make room for their files.", "This is a saved reading. The land is not growing live on this page.",
  ], ["islands", "allocation"], { surfaces: { ...land, fileCircles: true }, framing: .72 }),
  make("stories-comparison", "stories", "Another way to find your way.", [
    "Storytree starts from the behaviour and its owners.", "File navigation and a coding agent’s context map answer different questions. No speed advantage is claimed here.",
  ], ["boundary", "shelves"], { surfaces: land, comparisons: [
    { name: "VS Code Explorer", claim: "Browses files and folders, with symbol navigation in Outline. Storytree adds a story-and-capability view of the project.", url: "https://code.visualstudio.com/docs/editing/getting-started/userinterface#_explorer-view" },
    { name: "Aider", claim: "Ranks a repository map of identifiers and signatures within a token budget. Storytree’s shelves carry curated project knowledge linked to the work.", url: "https://aider.chat/docs/repomap.html" },
  ] }),

  make("capabilities-territories", "capabilities", "The work within a story.", [
    "Stories are broken up into capabilities", "Each capability occupies a territory on its island.", "Its share of the land follows the code allocated to it.",
  ], ["islands", "allocation"], { surfaces: { ...land, territories: "plain" }, target: territory, framing: .7 }),
  make("capabilities-contracts", "capabilities", "A promise a test can check.", [
    "A capability has contracts: named promises about behaviour.", "The agent is instructed to show the smallest test failing, then make it pass.", "Passing a test does not establish that the test was a good one. This discipline still depends on the work being done honestly.",
  ], ["tests", "health"], { surfaces: { ...land, territories: "plain" }, panel: "stories", target: territory, framing: .7 }),
  make("capabilities-files", "capabilities", "The code behind a promise.", [
    "Each circle is a surveyed code file. Its size follows its lines of code.", "Tests trace files to capabilities; measured execution can provide evidence where tracing cannot reach.", "A file’s place records that evidence, not an agent’s guess about which folder looks right.",
  ], ["allocation", "islands"], { surfaces: { ...land, territories: "plain", fileCircles: true }, target: territory, framing: .7 }),
  make("capabilities-unclaimed", "capabilities", "The gaps stay visible.", [
    "Code without allocation evidence has an Unclaimed territory.", "Storytree’s saved project still has unclaimed code. The allocation work is in progress.", "A visible gap is more useful than a claim of completeness the evidence cannot support.",
  ], ["allocation", "attention"], { surfaces: { ...land, territories: "plain", fileCircles: true }, framing: .7 }),
  make("capabilities-health", "capabilities", "Health, and who said so.", [
    "Green means healthy, red unhealthy; yellow marks proposed or untested capabilities.", "Read the evidence label: an agent’s report and an independent test result are different signals.", "Storytree checks its own project’s tests on main. It does not yet run every connected project’s tests itself.", "The capability card says why it is not green, and who can move it.",
  ], ["health", "reasons", "tests"], { surfaces: { ...land, territories: "health", fileCircles: true }, panel: "stories", target: territory, framing: .7 }),
  make("capabilities-comparison", "capabilities", "Different evidence, different questions.", [
    "Storytree connects named behaviour, code ownership and the available health evidence.", "It does not currently supply a maintenance-hotspot or historical change-coupling investigation view.",
  ], ["allocation", "health"], { comparisons: [
    { name: "SonarQube quality gates", claim: "Evaluate configured conditions on analysis metrics such as coverage and detected issues. Those measurements complement behavioural contracts.", url: "https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates" },
    { name: "CodeScene hotspots", claim: "Combine development activity and code-health information to guide maintenance investigation. That is a surface Storytree does not provide today.", url: "https://codescene.io/docs/guides/technical/hotspots.html" },
    { name: "CodeScene change coupling", claim: "Finds files that change together in repository history. Storytree’s dependency roads describe a different relationship.", url: "https://codescene.io/docs/guides/technical/change-coupling.html" },
  ] }),

  make("knowledge-inside", "knowledge", "Knowledge beneath the islands.", [
    "Storytree remembers things using a knowledgegraph", "Hundreds of project notes sit inside this saved globe.", "They include the decisions and working knowledge behind what gets built.",
  ], ["graph", "loose"], { surfaces: core, target: centre }),
  make("knowledge-kinds", "knowledge", "Different notes do different jobs.", [
    "Decisions record a choice and its reason. Principles and guardrails guide judgement.", "Patterns and processes describe approaches and ceremonies; definitions keep terms precise.", "Agent roles describe responsibilities. Each kind gives a future reader a useful starting point.",
  ], ["graph", "shelves"], { surfaces: core, target: centre, panel: "knowledge" }),
  make("knowledge-shelves", "knowledge", "Read the spines first.", [
    "Each story and capability has a shelf of front covers.", "The shelf puts relevant knowledge beside the behaviour it supports.", "An agent opens the books it needs for the current task.",
  ], ["shelves", "librarian"], { surfaces: { ...core, grounds: true, nameplates: true }, target: library }),
  make("knowledge-links", "knowledge", "Links without loops.", [
    "Notes link to other notes. The knowledge graph rejects loops.", "Notes no story or capability shelf reaches gather at the centre.", "Choose a note to read its saved title and kind. This public snapshot does not include full note bodies.",
  ], ["graph", "loose"], { surfaces: core, target: centre, panel: "knowledge" }),
  make("knowledge-history", "knowledge", "A changed decision leaves a history.", [
    "Earlier decisions remain recorded when the project changes direction.", "The graph can calculate ghosts of earlier states; this globe does not expose a ghost-inspection view.", "What you can open here is the saved note’s title and kind.",
  ], ["graph", "librarian"], { surfaces: core, target: centre, panel: "knowledge" }),
  make("knowledge-pull", "knowledge", "Pull what the work needs.", [
    "Agents pull relevant knowledge as they work, rather than receiving the whole library in every prompt.", "The librarian pass preserves durable lessons and checks changed decisions for stale guidance.", "These are working practices with recorded evidence, not a guarantee that an agent will never forget.",
  ], ["shelves", "librarian"], { surfaces: core, target: centre }),
  make("knowledge-comparison", "knowledge", "Memory already has many forms.", [
    "Storytree’s emphasis is curated project knowledge linked to the plan and its capability shelves.", "It does not claim to have invented selective context or graph memory.",
  ], ["shelves", "librarian"], { surfaces: core, target: centre, comparisons: [
    { name: "Cursor rules", claim: "Can apply always, by file pattern, by agent relevance or manually. Selective context already exists in coding harnesses.", url: "https://cursor.com/docs/rules" },
    { name: "Graphiti", claim: "Provides a temporal entity-and-fact graph with provenance and hybrid retrieval. Storytree’s library organises project decisions around the work.", url: "https://help.getzep.com/graphiti/getting-started/overview" },
  ] }),

  make("sessions-recording", "sessions", "See the sessions doing the work.", [
    "Storytree visualises agents working through sessions", "This is a recording from 2 October 2026, 00:00–04:15 UTC.", "The names, claims and note reads come from recorded activity. They are not live visitors or invented agents.",
  ], ["reads", "guide"], { panel: "sessions" }),
  make("sessions-claims", "sessions", "A colour for the session.", [
    "A recorded claim connects a session to the work it owns.", "Session colours connect the list to its activity on the globe.", "A claim is ownership of work; it does not certify that the work is finished or healthy.",
  ], ["close", "islands"], { panel: "sessions" }),
  make("sessions-unplanned", "sessions", "Work can show before it is planned.", [
    "Observed sessions can appear even without a planned increment.", "The list distinguishes activity, ownership and the evidence available about the session.", "A verified close-out checks the session’s branch and running work before it leaves the list.",
  ], ["close", "owner"], { panel: "sessions" }),
  make("sessions-context", "sessions", "Context has a limit too.", [
    "Claude Code has a partial context reading and wrap-up nudge; Codex does not have that same path.", "The saved recording has no transcript-derived context totals. Missing readings remain absent here.", "A nudge is guidance for the agent, not proof it will stop at the right time.",
  ], ["nudge", "window"], { panel: "sessions" }),
  make("sessions-reads", "sessions", "Follow what a session read.", [
    "Select a recorded session to follow its note reads in order.", "Those reads connect its work to the knowledge inside the globe.", "A recorded read shows what was opened. It does not prove what the model understood or still remembers.",
  ], ["reads", "window"], { surfaces: { ...core, sessionTints: true }, target: centre, panel: "sessions" }),
  make("sessions-comparison", "sessions", "Alongside the coding harness.", [
    "Storytree relates observed sessions to project claims, reads and close-outs.", "It works beside the harness; this recording is not a remote control for those agents.",
  ], ["reads", "close"], { comparisons: [
    { name: "Cursor Agents Window", claim: "Manages parallel agents, isolated worktrees and diff or pull-request review. Storytree adds the project’s recorded work and knowledge relationships.", url: "https://cursor.com/docs/agent/agents-window" },
    { name: "LangSmith Studio", claim: "Visualises and debugs systems using the Agent Server API protocol, alongside tracing and evaluation. Its compatibility and execution focus differ from this project view.", url: "https://docs.langchain.com/langsmith/studio" },
  ] }),

  make("arcs-intent", "arcs", "A direction for the work.", [
    "In Storytree work is planned using arcs", "An arc records an intent and the end state it is trying to reach.", "Open one to see the work that belongs to that journey.",
  ], ["arcs", "owner"], { panel: "arcs" }),
  make("arcs-increments", "arcs", "One finishable increment at a time.", [
    "An arc breaks into increments that can reach a clear outcome.", "Their bars distinguish work still open, landed work and failed outcomes.", "A green landing is not the same claim as verified product health.",
  ], ["arcs", "landed"], { panel: "arcs" }),
  make("arcs-waits", "arcs", "What is waiting, and why.", [
    "Some work waits on another increment. Some needs an answer only the owner can give.", "The arc keeps those dependencies and questions with the work they hold.", "Waiting is visible; it is not silently counted as progress.",
  ], ["waits", "owner"], { panel: "arcs" }),
  make("arcs-owner", "arcs", "The owner keeps the decisions.", [
    "Agents can carry a bounded increment through its checks and landing.", "Owner-level decisions become written questions with their stakes and options.", "The owner’s answer stays recorded with the work it unblocks.",
  ], ["owner", "landed"], { panel: "arcs" }),
  make("arcs-comparison", "arcs", "Plans connected to execution.", [
    "Storytree makes increments, claims, waits and owner questions explicit beside the project.", "Existing planning tools remain useful; their goals and health signals are not interchangeable with test evidence.",
  ], ["arcs", "waits", "landed"], { panel: "arcs", comparisons: [
    { name: "Linear initiatives", claim: "Connect projects to strategic goals and progress updates. Storytree’s arcs connect a journey to agent work and the questions holding it.", url: "https://linear.app/docs/initiatives" },
    { name: "GitHub Projects", claim: "Offers configurable tables, boards, roadmaps and automation linked to issues and pull requests. Storytree adds its own explicit claim and owner-question model.", url: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects" },
  ] }),
];
