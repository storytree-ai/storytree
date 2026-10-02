/**
 * The desktop app's view of a project: the library's projectTree(), as the page shows it.
 *
 * Each story heads its section with its title, description and rolled-up health. Its capabilities
 * follow in build order, each a row with its two health columns side by side, "Agent reported"
 * and "Storytree verified", that expands to list its contracts, each with its own two columns and
 * what its entries say (who, when, and the note). Every state is a badge: passing, failing, or not
 * checked.
 *
 * Everything here is a pure function of the tree, so it is tested without Electron or a library;
 * renderer.ts only puts the HTML it returns into the document.
 */
import type {
  AnnotatedCapability,
  AnnotatedContract,
  AnnotatedStory,
  AnnotatedTree,
  HealthColumn,
  HealthState,
  NodeHealth,
} from "@storytree/library";

export type ColumnName = "reported" | "verified";

/** One health column of one node, as a badge. */
export interface CellView {
  column: ColumnName;
  /** "Agent reported" or "Storytree verified". */
  label: string;
  state: HealthState;
  /** The badge's words: "passing", "failing" or "not checked". */
  badge: string;
  /** What the entry says, on a contract's column once it has one: who wrote it, when, and its note. */
  detail?: string;
}

/** A node's two columns, side by side: reported, then verified. */
export type HealthView = [reported: CellView, verified: CellView];

export interface ContractView {
  id: string;
  title: string;
  description?: string;
  health: HealthView;
}

export interface CapabilityView {
  id: string;
  title: string;
  description?: string;
  /** The titles of the capabilities it depends on. */
  dependsOn: string[];
  health: HealthView;
  contracts: ContractView[];
}

/** How many of a story's contracts are in each state, in one column. */
export interface Tally {
  passing: number;
  failing: number;
  notChecked: number;
}

export interface StoryView {
  id: string;
  title: string;
  description?: string;
  health: HealthView;
  contractCount: number;
  tally: Record<ColumnName, Tally>;
  /** In build order. */
  capabilities: CapabilityView[];
}

export interface ProjectView {
  project: string;
  stories: StoryView[];
}

/** The two columns, in the order they are shown. */
const COLUMNS: readonly { column: ColumnName; label: string }[] = [
  { column: "reported", label: "Agent reported" },
  { column: "verified", label: "Storytree verified" },
];

const BADGES: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };
const MARKS: Readonly<Record<HealthState, string>> = { passing: "✓", failing: "✕", "not-checked": "○" };

/**
 * Capabilities in build order: each after every capability it depends on, and otherwise in the
 * order given (the order they were added). A dependency that is not among them is ignored, and
 * a loop, which the library refuses to store, leaves what it holds in the order given.
 */
export function inBuildOrder<T extends { readonly id: string; readonly dependsOn: readonly string[] }>(capabilities: readonly T[]): T[] {
  const present = new Set(capabilities.map(({ id }) => id));
  const placed = new Set<string>();
  const ordered: T[] = [];
  const waiting = [...capabilities];
  for (;;) {
    const ready = waiting.findIndex(({ dependsOn }) => dependsOn.every((id) => !present.has(id) || placed.has(id)));
    if (ready < 0) break;
    const [next] = waiting.splice(ready, 1);
    if (next === undefined) break;
    ordered.push(next);
    placed.add(next.id);
  }
  return [...ordered, ...waiting];
}

/** A project's tree as the page shows it. */
export function projectView(project: string, tree: AnnotatedTree): ProjectView {
  return { project, stories: tree.stories.map(storyView) };
}

/** The page's main content for a project: each story with its capabilities, or a line saying there are none. */
export function renderProject(project: string, tree: AnnotatedTree): string {
  const view = projectView(project, tree);
  if (view.stories.length === 0) {
    return `<div class="empty"><p>${escape(project)} has no stories yet.</p></div>`;
  }
  return view.stories.map(renderStory).join("\n");
}

export { renderNoProjects } from "@storytree/app/view";

// --- the view model ---------------------------------------------------------------------------

function storyView(story: AnnotatedStory): StoryView {
  const titles = new Map(story.capabilities.map(({ id, title }) => [id, title]));
  const contracts = story.capabilities.flatMap(({ contracts: own }) => own);
  return {
    id: story.id,
    title: story.title,
    ...optional("description", story.description),
    health: healthView(story.health),
    contractCount: contracts.length,
    tally: { reported: tally(contracts, "reported"), verified: tally(contracts, "verified") },
    capabilities: inBuildOrder(story.capabilities).map((capability) => capabilityView(capability, titles)),
  };
}

function capabilityView(capability: AnnotatedCapability, titles: ReadonlyMap<string, string>): CapabilityView {
  return {
    id: capability.id,
    title: capability.title,
    ...optional("description", capability.description),
    dependsOn: capability.dependsOn.map((id) => titles.get(id) ?? id),
    health: healthView(capability.health),
    contracts: capability.contracts.map(contractView),
  };
}

function contractView(contract: AnnotatedContract): ContractView {
  return {
    id: contract.id,
    title: contract.title,
    ...optional("description", contract.description),
    health: healthView(contract.health),
  };
}

function healthView(health: NodeHealth): HealthView {
  const [reported, verified] = COLUMNS.map(({ column, label }) => cellView(column, label, health[column]));
  if (reported === undefined || verified === undefined) throw new Error("a node's health has two columns");
  return [reported, verified];
}

function cellView(column: ColumnName, label: string, entry: HealthColumn): CellView {
  const detail = [entry.by, entry.at === undefined ? undefined : when(entry.at), entry.note]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" · ");
  return { column, label, state: entry.state, badge: BADGES[entry.state], ...optional("detail", detail) };
}

function tally(contracts: readonly AnnotatedContract[], column: ColumnName): Tally {
  const states = contracts.map(({ health }) => health[column].state);
  return {
    passing: states.filter((state) => state === "passing").length,
    failing: states.filter((state) => state === "failing").length,
    notChecked: states.filter((state) => state === "not-checked").length,
  };
}

/** An entry's time, to the minute, in UTC: `2026-09-26 06:40 UTC`. */
function when(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: string };
}

// --- HTML -------------------------------------------------------------------------------------

function renderStory(story: StoryView): string {
  const columns = story.health
    .map(
      (cell) =>
        `<div class="story-column"><dt>${escape(cell.label)}</dt>` +
        `<dd>${badge(cell)} <span class="tally">${tallyText(story.tally[cell.column])}</span></dd></div>`,
    )
    .join("");
  return [
    `<section class="story" data-story-id="${escape(story.id)}">`,
    `<header class="story-head">`,
    `<h1 class="story-title">${inline(story.title)}</h1>`,
    story.description === undefined ? "" : `<p class="story-description">${inline(story.description)}</p>`,
    `<dl class="story-health">${columns}</dl>`,
    `<p class="story-counts">${count(story.capabilities.length, "capability", "capabilities")} · ` +
      `${count(story.contractCount, "contract", "contracts")}</p>`,
    `</header>`,
    `<div class="capabilities">`,
    `<div class="row row-head"><span class="row-title">Capabilities, in build order</span>` +
      COLUMNS.map(({ column, label }) => `<span class="column-head" data-column="${column}">${escape(label)}</span>`).join("") +
      `</div>`,
    ...story.capabilities.map(renderCapability),
    `</div>`,
    `</section>`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderCapability(capability: CapabilityView): string {
  const contracts =
    capability.contracts.length === 0
      ? `<p class="no-contracts">No contracts yet.</p>`
      : `<ol class="contracts">${capability.contracts.map(renderContract).join("")}</ol>`;
  return [
    `<details class="capability" data-capability-id="${escape(capability.id)}">`,
    `<summary class="row"><span class="row-title">${inline(capability.title)}</span>${capability.health.map(renderCell).join("")}</summary>`,
    `<div class="capability-body">`,
    capability.description === undefined ? "" : `<p class="description">${inline(capability.description)}</p>`,
    capability.dependsOn.length === 0 ? "" : `<p class="depends">Depends on ${capability.dependsOn.map(inline).join(", ")}</p>`,
    contracts,
    `</div>`,
    `</details>`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderContract(contract: ContractView): string {
  const description = contract.description === undefined ? "" : `<span class="description">${inline(contract.description)}</span>`;
  return (
    `<li class="contract row" data-contract-id="${escape(contract.id)}">` +
    `<span class="row-title">${inline(contract.title)}${description}</span>` +
    contract.health.map(renderCell).join("") +
    `</li>`
  );
}

function renderCell(cell: CellView): string {
  const detail = cell.detail === undefined ? "" : `<span class="detail">${escape(cell.detail)}</span>`;
  return `<span class="cell" data-column="${cell.column}" title="${escape(`${cell.label}: ${cell.badge}`)}">${badge(cell)}${detail}</span>`;
}

function badge(cell: CellView): string {
  return `<span class="badge badge-${cell.state}"><span class="mark" aria-hidden="true">${MARKS[cell.state]}</span>${escape(cell.badge)}</span>`;
}

function tallyText({ passing, failing, notChecked }: Tally): string {
  return `${passing} passing, ${failing} failing, ${notChecked} not checked`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Text as HTML, with `code` spans shown as code and **bold** as bold. */
function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
