/** Capability 2 · The forest on the site. */
import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";
import type { Chip, Decision, Explainer, Group, Mark, TourStep } from "./tour.js";

/** When the comparisons were checked against each tool's own documentation (definition_b0b80acc7330). */
export const researchDate = "3 October 2026";
export const groupTitles: Record<Group, string> = {
  opening: "Why storytree", map: "The map", knowledge: "Knowledge graph", ending: "The whole globe",
};
export const explainers: { id: Explainer; title: string }[] = (["map", "knowledge"] as const).map(id => ({ id, title: groupTitles[id] }));

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
  claims: adr(643, "Claims, the wait refusal and release on merge"),
  closeOut: adr(758, "A session leaves the list by a verified close-out"),
  arcs: adr(638, "The arc surface"),
  waits: adr(760, "Waiting work shows as waiting"),
  landed: adr(772, "Landed is a work outcome"),
  questions: adr(824, "The owner's decisions live in written questions"),
};
const principle = (n: 1 | 2 | 3 | 4): Chip => ({ kind: "principle", text: [
  "", "Signals must be real", "Show what matters now; hide the rest", "Your attention goes where you send it", "Nothing is out of reach",
][n]! });

const complete: GlobeSurfaces = { sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true };
const none = { roads: false, territories: false, fileCircles: false, knowledgeCore: false, sessionTints: false } as const;
const quiet: Partial<GlobeSurfaces> = { ...none, nameplates: false };
const land: Partial<GlobeSurfaces> = { ...none, nameplates: true };
const plain: Partial<GlobeSurfaces> = { ...land, territories: "plain" };
const files: Partial<GlobeSurfaces> = { ...plain, fileCircles: true };
const health: Partial<GlobeSurfaces> = { ...files, territories: "health" };
// The land plain, its names on, and the notes inside the globe beneath it.
const inside: Partial<GlobeSurfaces> = { ...land, knowledgeCore: true };

const story = (id: string): GlobeTarget => ({ kind: "story", story: id });
const forest = story("story_deee4230348c");
// Storytree's own recorded growth (own-snapshot.json): Act 2 arrives on it, grown from a point as its agents built it (ADR-0889 2.2b).
const own = { map: "own" as const, target: { kind: "core" } as GlobeTarget };
// The shop (shop-snapshot.json): the store the test laptop's Claude Code sessions rebuilt side by side with storytree, where the
// chapters teach (ADR-0890), walking only four of its stories: Signing in, Browsing, Cart and Checkout (ADR-0891, amended
// 2026-10-05).
const signingInId = "story_d263ef0f3f72", browsing = story("story_0c07d0047754");
// Signing in's first capability, and browsing's product page, the first of the three sessions' claims to land (02:29:25).
const shopServer = "capability_323895c5a414", productPage = "capability_f29c62742cce";
// The shop was rebuilt with storytree's guardrails (ADR-0911 D5): no part of its code is unallocated at any stage, so the tour
// shows no hatched ground.
const signingIn = story(signingInId);
// A view of the four teaching stories together, centred on Browsing so the preceding close-up cannot leave Checkout at the rim.
const whole = 1.32;
// The map chapter's two views: the four stories, and close on signing in.
const shop = { target: browsing, framing: whole, phone: { target: browsing, framing: 1.5, side: 0 } };
const near = { target: signingIn, framing: .8, phone: { target: signingIn, framing: 1.05, side: 0 } };
// The knowledge chapter's globe: the map chapter's, held where it ends (the 03:08:57 survey), with its notes beneath the land. Its
// records are read at 03:06, once the session building orders has read checkout's shelf (03:04) and claimed its parts (03:05).
const kept = { map: "shop" as const, growth: { seconds: 1, stage: "pr7-building", until: "pr7-building" }, sessionsAt: "2026-10-05T03:06:00.000Z" };
const checkout = story("story_66f80ffaaa4d");
const closeOnCheckout = { target: checkout, framing: .8, phone: { target: checkout, framing: 1.05, side: 0 } };
// Checkout's "Finish becomes a form post" (02:55), and the session building orders that read it (03:04).
const finishDecision = "decision_0822dda10ab2", ordersSession = "726ad13e-f730-45fb-9682-893eef2a5696";
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
// The harnesses storytree's first-run probe looks for (each its company's own published mark, evidence/map-harness/README.md).
// Another harness is one more entry here.
const harnesses: Mark[] = [{ name: "Claude Code", src: "/harness/claude-code.png" }, { name: "Codex", src: "/harness/codex.png" }];

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

  // The map (ADR-0891, amended 2026-10-11): seven steps in the owner's order. ★ the owner's words; the rest is DRAFT, approved as a
  // table and reworded to fit, as is every How and Why. The whole chapter plays forward in the shop's recorded time. The camera
  // moves twice, each as a step begins: into signing in as capabilities are named, and back out to the four stories for the
  // claims. Every claim is a flag in its capability's share (ADR-0968).
  { id: "map-empty", explainer: "map", map: "shop", growth: { seconds: 10, until: "plans" }, title: "The beginning.", lines: [
    // ★
    "Let's start from the beginning and build a shopping site, so you can see how storytree draws a map as your agents build.",
  ], how: "The shop starts as an empty globe. Its agents plan the work before they write any code, and each story they plan will be an island here.",
  why: "Watching a project grow from nothing shows you how to read the map of one that is already big.",
  decisions: [], surfaces: land, ...shop },
  // The bare globe step 1 leaves, with the harnesses storytree works with beneath the owner's line.
  { id: "map-harness", explainer: "map", map: "shop", growth: { seconds: 1, stage: "plans", until: "plans" }, title: "Works with your harness.", lines: [
    // ★
    "Storytree works with your existing coding harness.",
  ], how: "Storytree doesn't replace the agent you code with. When you set up a project it looks for Claude Code and Codex, and joins their sessions through hooks and an MCP server: the hooks tell storytree what each session reads and changes, and the MCP server gives the agent storytree's tools for the plan and the library.",
  why: "You keep the agents, prompts and habits you already have; storytree adds the map beside them.",
  decisions: [], surfaces: land, ...shop, marks: harnesses },
  // The record just before the first claim (01:53:08): the shop's first arc and its four parts, none held yet. The arcs list is
  // small while the tour plays, and its first arc is pointed out and named.
  { id: "map-arcs", explainer: "map", map: "shop", sessionsAt: "2026-10-05T01:53:00.000Z", growth: { seconds: 1, stage: "plans", until: "plans" },
    title: "Plans of work are arcs.", lines: [
    // ✎
    "Tell your agents what you want to build and they will set up a plan of work.",
  ], how: "Storytree calls a plan of work an arc: an end state and a list of increments, each a piece of the work. The shop's first arc had four parts. A session claims an increment before it starts, lands it through a pull request, and closes it.",
  why: "A plan that lives beside the work lets the next agent pick up the next piece without asking you.",
  decisions: [], surfaces: land, ...shop, panel: "arcs", labels: { 1: [{ point: "arc", text: "a plan of work: an arc" }] } },
  // Each island rises as it is named, in the order the agents started on them (first claims 01:53, 01:58, 02:28); the pathways
  // draw on with the second line, those to signing in first, then those to browsing.
  { id: "map-stories", explainer: "map", map: "shop", growth: { seconds: 16, stage: "plans", until: `land-${shopServer}`, beats: [{ line: 2, stage: "pathways" }] },
    title: "Stories and pathways.", lines: [
    "Each story in your project shows up as an island on the map: first signing in, then browsing, then the cart and checkout.",
    "The dependencies between stories are shown as pathways: browsing, the cart and checkout all need signing in.",
  ], how: "A story is something a customer can do, and its code lives in its own package. A pathway runs one way, from a story to the story it needs: the cart and checkout also need browsing. Storytree refuses a loop.",
  why: "Pathways show what a story needs and where a change can reach, so you and your agents can see which work can run in parallel.",
  decisions: [], surfaces: land, lineSurfaces: { 2: { ...land, roads: true } }, ...shop,
  // The pathway from the cart's page to signing in's page shell, near the cart on its own stretch of road. Each label shows only
  // as narrow as it reads clear of the islands' names (evidence/map-labels): a phone keeps the pathway's, down to 390px.
  labels: { 1: [{ target: signingIn, text: "a story", narrowest: 601 }],
    2: [{ target: { kind: "pathway", link: "capability_ed214990be99->capability_ae20917d7a32", along: .2 }, text: "the cart needs signing in", narrowest: 390 }] } },
  // Signing in's and browsing's code reached the map when their pull request merged (02:06); the cart and checkout have none yet,
  // so each of their planned capabilities has an equal share of the island.
  { id: "map-capabilities", explainer: "map", map: "shop", growth: { seconds: 7, stage: `land-${shopServer}`, until: "pr1" }, title: "Capabilities and your code.", lines: [
    "Each story is broken into capabilities, the pieces that make it work.",
    "Capabilities hold your code: each dot is a file.",
    "Select a story and a panel shows how its capabilities work together.",
  ], how: "Each capability's territory arrives in the order the agent built it, signing in's shop server first. A file's dot is sized by its lines and sits in the capability whose tests reach it. The cart and checkout have no code yet, so each of their planned capabilities has an equal share of the island, with no dots. The panel shows the story's capabilities and what depends on what.",
  why: "You can see where the code went and which promises it serves, without opening a file.",
  decisions: [], surfaces: { ...plain, roads: true }, lineSurfaces: { 2: { ...files, roads: true } }, ...near, panel: "story", panelFromLine: 3, panelRoom: true,
  // Signing in's largest file in the survey its code arrived with (02:06).
  labels: { 1: [{ target: { kind: "capability", capability: shopServer }, text: "a capability", narrowest: 601 }],
    2: [{ target: { kind: "file", story: signingInId, path: "src/server/server.js" }, read: "file", narrowest: 390 }] } },
  // The record: three sessions claimed browsing's, the cart's and checkout's capabilities between 02:28:12 and 02:28:27. The flags
  // drop with the first line; the arcs panel and then the sessions list read the record at 02:28:30.
  { id: "map-claims", explainer: "map", map: "shop", sessionsAt: "2026-10-05T02:28:30.000Z",
    growth: { seconds: 8, stage: "pr3-building", until: `lifted-${productPage}`, beats: [{ line: 2, stage: "together" }] },
    title: "Agents claim their work.", lines: [
    "Agents claim capabilities before they work on them, so each can see what the others are working on.",
    "The plan shows it too: parts 2, 3 and 4 of the arc, each held by its own session.",
    "Your agent sessions are listed here too.",
  ], how: "Before writing, an agent claims the increment it will build and each capability it will touch, and a second claim on the same work is turned away. Each claim is a flag in its session's colour, standing in its capability's share; on the cart and checkout, which have no code yet, the share is marked as a lot. Within fifteen seconds, three sessions claimed eight capabilities on browsing, the cart and checkout.",
  why: "Two agents editing the same thing is how work gets lost. A claim says who is on what before anyone writes, so an agent that can see what is taken picks other work instead.",
  compare: { lines: [
    "Cursor's Agents window runs agents in parallel, each in its own worktree, with diffs to review.",
    "LangSmith Studio visualises and debugs agent systems, with tracing and evaluation.",
    "Linear's initiatives connect projects to goals and progress updates.",
    "Storytree ties each session to the work it claimed on the map, and each increment to the session holding it.",
  ], sources: [cursorAgents, langsmith, linear, undefined] },
  decisions: [], surfaces: lit({ ...files, roads: true }), ...shop, lineViews: { 2: { panel: "arcs" }, 3: { panel: "sessions" } },
  // The first flag (02:28:12), named by its session, which had named itself at 02:27:06; on a phone it would cover browsing's name.
  labels: { 1: [{ target: { kind: "capability", capability: productPage }, read: "holder", narrowest: 601 }], 3: [{ point: "sessions" }] } },
  { id: "map-health", explainer: "map", map: "shop", growth: { seconds: 16, stage: `lifted-${productPage}`, until: "pr7-building" }, title: "Health.", lines: [
    // ✎
    "As your automated tests run in CI, storytree shows you which capabilities are healthy and which need your attention.",
    // DRAFT.
    "Yellow means nothing has proved it yet; green means its tests passed.",
  ], how: "As each capability lands, its flag lifts, and the cart's and checkout's code takes their shares' place. The shop's CI ran its tests, and storytree matched the results to each capability's promises. A colour counts only when something other than the agent checked it; saying 'done' doesn't count.",
  why: "You can see what has been proved and what still needs checking, without taking an agent's word for it.",
  compare: { lines: [
    "VS Code's Explorer browses files and folders; its Outline lists a file's symbols.",
    "Aider's repo map ranks your code's names and signatures to fit the model's budget.",
    "Storytree groups the code by what it lets someone do, with the plan beside it.",
  ], sources: [vscode, aider, undefined] },
  decisions: [], surfaces: lit({ ...health, roads: true }), ...shop,
  labels: { 1: [{ target: checkout, read: "health" }], 2: [{ target: checkout, read: "health" }] } },

  // The knowledge graph (ADR-0990, proposed 2026-10-11): three steps after the map chapter's model. ★ the owner's words; every
  // other line, How and Why is DRAFT, written by the session that built it for the owner to rewrite. It stays on the globe the map chapter leaves (the first
  // round's four stories at the 03:08:57 survey) and teaches on the shop's own record: checkout's Finish decision (02:55), read by
  // the session building orders (03:04) before it claimed checkout's parts (03:05). The camera moves once, into checkout.
  { id: "knowledge-inside", explainer: "knowledge", ...kept, title: "Decisions live inside the map.", lines: [
    // ★ The owner's words (ADR-0857 D3), kept word for word.
    "Storytree remembers things using a knowledge graph.",
    // DRAFT.
    "As your agents build, they also decide things: how a part should work, and why.",
    // DRAFT.
    "Storytree keeps each decision inside the globe, beneath the part of the map it's about.",
  ], how: "By the time the first round was green, the shop's agents had written {shopDecisions} decisions, most of them while planning, before any code. Each is a note in storytree's library, a knowledge graph: a note links to the notes it stands on, and the graph refuses loops, so every chain of reasons reads to its end. Principles, which steer judgement, are notes too. A note about no one part gathers at the core.",
  why: "Every new agent session starts on its first day. Keeping the decisions with the work means the next session doesn't relearn them, and you don't explain them again.",
  decisions: [], surfaces: lit({ ...health, roads: true }), lineSurfaces: { 3: inside }, ...shop },
  { id: "knowledge-shelf", explainer: "knowledge", ...kept, title: "Every story keeps a shelf.", lines: [
    // DRAFT.
    "Each story and capability keeps a shelf: the decisions that shaped it.",
    // DRAFT.
    "Checkout's shelf says why Finish works the way it does.",
  ], how: "A decision sits on the shelf of the story or capability it shaped. This one is on checkout's Placing the order: \"Finish becomes a form post; the cart is cleared on the complete page, not on the click.\" It was written at 02:55, as the shop's second round was planned. Checkout's first plan, at 01:50, had said \"Finish clears the cart before leaving\".",
  why: "Pasting everything into every prompt spends the agent's attention, and goes stale. A shelf keeps the few decisions that matter beside the work they shaped.",
  decisions: [], surfaces: inside, ...closeOnCheckout, panel: "note", note: finishDecision, panelFromLine: 2, panelRoom: true },
  { id: "knowledge-reads", explainer: "knowledge", ...kept, follow: ordersSession, title: "The next agent reads it first.", lines: [
    // DRAFT.
    "Before an agent changes a part, it reads that part's shelf.",
    // DRAFT.
    "The session building orders read checkout's shelf, and opened the Finish decision.",
    // DRAFT.
    "Only then did it claim checkout's parts.",
    // DRAFT.
    "Nobody had to paste it into a prompt.",
  ], how: "Storytree records every note a session opens, in order, and draws its path through the library in the session's colour. The orders session started at 03:02. At 03:04 it read the decisions on checkout's shelf and opened the Finish decision in full; at 03:05 it claimed the checkout capabilities its work would change. A read shows what was opened, not what the model understood.",
  why: "An agent's work is only as good as what it read before it acted. The path shows what the work stood on, and what it never opened.",
  compare: { lines: [
    "Cursor's rules load always, by file pattern, when the agent finds them relevant, or by hand.",
    "Graphiti keeps a graph of entities and facts over time, with where each came from.",
    "Storytree keeps decisions on the shelves of the work they shaped, and shows who read them.",
  ], sources: [cursorRules, graphiti, undefined] },
  decisions: [], surfaces: inside, lineSurfaces: { 3: lit(inside) }, target: checkout, framing: 1, phone: { target: checkout, framing: 1.3, side: 0 }, panel: "sessions" },

  { id: "everything", explainer: "ending", title: "Now read the whole globe.", lines: [
    "Everything is back: the plan, the code, its health, the knowledge and the sessions.",
    "It's the globe you started on. Now you can read it.",
  ], why: "Nothing storytree hides is out of reach: the Show everything switch brings every surface back at any step.",
  decisions: [decisions.busy, decisions.guide], chips: [principle(4)], surfaces: complete, target: forest, framing: 1.1, drift: true },
];
