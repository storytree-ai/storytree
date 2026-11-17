/**
 * Capability 4 · Drill-down. The panel's microscope as drawn (ADR-1350 D2, narrowing ADR-1285): the one thing the panel
 * is rooted on, its children laid out as territories on a round land that fills the panel, by the layout an opened
 * capability's parts take on the map (nested-territories.ts), their roads between them, and its gates on the land's edge,
 * each named by the neighbour its road leads to and joined to the children it reaches. A story's capabilities are coloured
 * by their own words; a capability's parts, as deep as they go, keep its colour (question_211620bd75de), their borders
 * drawn. Choosing a capability re-roots the panel on it through the globe's own selection; choosing a part re-roots the
 * microscope on that part, with a breadcrumb back up. Only the level shown is laid out, once for the same level.
 */
import type { Microscope, ScopeLevel } from "@storytree/forest";
import { nestedLayoutSteps, type NestedLayout } from "../territories/nested-territories.js";
import { finished, type Coast, type Point } from "../territories/territories.js";
import { capabilityPlates, globeName } from "./nameplates.js";
import { PARKED_FILL, WORD_FILL } from "./territory-land.js";

/** The round land's radius, in the drawing's own units. */
export const SCOPE_RADIUS = 100;
const SIDES = 64;
const LAND: Coast = [Array.from({ length: SIDES }, (_, k) => ({ x: SCOPE_RADIUS * Math.cos((2 * Math.PI * k) / SIDES), z: SCOPE_RADIUS * Math.sin((2 * Math.PI * k) / SIDES) }))];

/** Where gate `k` of `n` stands on the land's edge: evenly round it, the first at the top. */
export function gateAt(k: number, n: number, radius = SCOPE_RADIUS): Point {
  const angle = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(1, n);
  return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
}

/** Each level's layout, by what it was laid out for, so a level shown again is not laid out again. */
const laidOut = new Map<string, NestedLayout | undefined>();
const keyOf = (level: ScopeLevel) => JSON.stringify([level.children.map(({ id, lines }) => [id, lines]), level.roads, level.gates.map(({ reaches }) => reaches)]);

/** Whether `level` is laid out already, or has nothing to lay out. */
export const laidOutYet = (level: ScopeLevel): boolean => level.children.length === 0 || laidOut.has(keyOf(level));

/** `level`'s children laid out on the round land, their lanes coming ashore at its gates, a step at a time (3.87); undefined with none to lay out. */
export function* scopeLayoutSteps(level: ScopeLevel): Generator<void, NestedLayout | undefined, void> {
  if (level.children.length === 0) return undefined;
  const key = keyOf(level);
  if (laidOut.has(key)) return laidOut.get(key);
  const docks = level.gates.map(({ reaches }, k) => ({ local: gateAt(k, level.gates.length), links: reaches.map((child) => `gate:${k}->${child}`) }));
  // Its own copy of the land each time: the layout keeps what it laid out by the land it was given.
  const layout = yield* nestedLayoutSteps(LAND.map((ring) => ring.map((p) => ({ ...p }))), level.children.map(({ id, title, lines }) => ({ capability: id, title, lines })), level.roads, docks);
  laidOut.set(key, layout);
  return layout;
}

/** {@link scopeLayoutSteps}, all at once. */
export const scopeLayout = (level: ScopeLevel): NestedLayout | undefined => finished(scopeLayoutSteps(level));

/** A child's place on the drawing: its name's spot, on its own land. */
function anchors(layout: NestedLayout): Map<string, Point> {
  return new Map(capabilityPlates(layout.map).map(({ capability, x, z }) => [capability, { x: x + layout.centre.x, z: z + layout.centre.z }]));
}

const fixed = (n: number) => (Math.round(n * 10) / 10).toString();
const at = (p: Point) => `${fixed(p.x)} ${fixed(p.z)}`;

/** What a child of `level` asks for when chosen: a capability re-roots the panel (the globe's selection), a part the microscope. */
function chooses(level: ScopeLevel, child: ScopeLevel["children"][number]): string {
  if (child.opens === undefined) return "";
  return level.path.length === 1 ? ` data-pick-capability="${attribute(child.id)}" role="button" tabindex="0"` : ` data-scope-to="${attribute(child.opens)}" role="button" tabindex="0"`;
}

/** How long a gate's name may run on the drawing; a longer one is cut, whole on hover. */
const GATE_NAME = 24;
const cut = (name: string) => (name.length <= GATE_NAME ? name : `${name.slice(0, GATE_NAME - 1).trimEnd()}…`);

/** The drawing of `level`: its land, children, roads and gates, as SVG; with `later`, a level not yet laid out is its bare land, marked to be laid out. */
export function scopeDrawing(level: ScopeLevel, later = false): string {
  if (later && !laidOutYet(level)) return `<svg class="scope-land" viewBox="${-(SCOPE_RADIUS + 90)} ${-(SCOPE_RADIUS + 16)} ${2 * (SCOPE_RADIUS + 90)} ${2 * (SCOPE_RADIUS + 16)}" role="img" aria-label="${attribute(level.titles.at(-1)!)}" aria-busy="true" data-scope-pending><circle class="scope-coast" r="${SCOPE_RADIUS + 1.5}"/></svg>`;
  const layout = scopeLayout(level);
  const own = level.parked === true ? PARKED_FILL : WORD_FILL[level.word ?? "untested"];
  const fillOf = (child: ScopeLevel["children"][number]) => level.path.length > 1 ? own : child.parked === true ? PARKED_FILL : WORD_FILL[child.word ?? "untested"];
  const places = layout === undefined ? new Map<string, Point>() : anchors(layout);
  const territories = layout === undefined ? `<circle class="scope-territory" r="${SCOPE_RADIUS}" fill="${own.colour}" fill-opacity="${own.opacity}"/>` : level.children.map((child) => {
    const t = layout.map.territories.findIndex(({ capability }) => capability === child.id);
    const cells = layout.map.cells.filter(({ territory }) => territory === t).map(({ polygon }) => `M${polygon.map((p) => at({ x: p.x + layout.centre.x, z: p.z + layout.centre.z })).join("L")}Z`).join("");
    // Drawn whole and see-through together, so the cells' seams do not show.
    const { colour } = fillOf(child);
    return `<path class="scope-territory${child.opens === undefined ? "" : " opens"}" data-scope-child="${attribute(child.id)}"${chooses(level, child)} d="${cells}" fill="${colour}" stroke="${colour}" stroke-width="0.6"><title>${text(child.title)}</title></path>`;
  }).join("");
  const borders = layout === undefined ? "" : `<path class="scope-borders" d="${layout.map.borders.filter(({ between: [a, b] }) => a !== b).map(({ from, to }) => `M${at({ x: from.x + layout.centre.x, z: from.z + layout.centre.z })}L${at({ x: to.x + layout.centre.x, z: to.z + layout.centre.z })}`).join("")}"/>`;
  const roads = level.roads.flatMap(({ from, to }) => {
    const [a, b] = [places.get(from), places.get(to)];
    return a === undefined || b === undefined ? [] : [`M${at(a)}L${at(b)}`];
  });
  const gates = level.gates.map(({ name, reaches }, k) => {
    const post = gateAt(k, level.gates.length), label = gateAt(k, level.gates.length, SCOPE_RADIUS + 6);
    for (const child of reaches) { const to = places.get(child); if (to !== undefined) roads.push(`M${at(post)}L${at(to)}`); }
    const anchor = Math.abs(label.x) < 8 ? "middle" : label.x > 0 ? "start" : "end";
    const angle = (Math.atan2(post.z, post.x) * 180) / Math.PI;
    return `<g class="scope-gate" data-scope-gate="${attribute(name)}" data-scope-post="${at(post)}"><rect x="-2.6" y="-1.4" width="5.2" height="2.8" transform="translate(${at(post)}) rotate(${fixed(angle)})"/><text x="${fixed(label.x)}" y="${fixed(label.z + (label.z > 0 ? 4 : label.z < -SCOPE_RADIUS + 20 ? -1 : 2))}" text-anchor="${anchor}">${text(cut(globeName(name)))}<title>${text(name)}</title></text></g>`;
  }).join("");
  const junctions = [...places].filter(([id]) => level.roads.some(({ from, to }) => from === id || to === id) || level.gates.some(({ reaches }) => reaches.includes(id)))
    .map(([id, p]) => `<circle class="scope-junction" data-scope-junction="${attribute(id)}" cx="${fixed(p.x)}" cy="${fixed(p.z)}" r="2.4"/>`).join("");
  const names = namesShown(level.children, places).map(({ child, at: p }) => `<text class="scope-name${child.opens === undefined ? "" : " opens"}" data-scope-name="${attribute(child.id)}" x="${fixed(p.x)}" y="${fixed(p.z + 8)}" text-anchor="middle">${text(globeName(child.title))}</text>`).join("");
  const box = SCOPE_RADIUS + 90;
  // A level with many roads draws them fine, so the land still reads beneath them.
  const busy = roads.length > 40 ? " busy" : "";
  return `<svg class="scope-land" viewBox="${-box} ${-(SCOPE_RADIUS + 16)} ${2 * box} ${2 * (SCOPE_RADIUS + 16)}" role="img" aria-label="${attribute(level.titles.at(-1)!)}">
    <circle class="scope-coast" r="${SCOPE_RADIUS + 1.5}"/><g class="scope-territories">${territories}</g>${borders}<path class="scope-roads${busy}" d="${roads.join("")}"/>${junctions}${gates}${names}</svg>`;
}

/** A name's box on the drawing: about this wide a bold letter and this tall a line with its stroke, in the drawing's units at the names' size. */
const LETTER = 4.4, LINE = 10;

/**
 * The children whose names the drawing writes: the largest first, each left out where it would cross a name already
 * written, as the map's names give way (3.4); one left out is still named on hover and in the panel's list.
 */
export function namesShown<C extends { readonly id: string; readonly title: string; readonly lines: number }>(children: readonly C[], places: ReadonlyMap<string, Point>): { child: C; at: Point }[] {
  const written: { child: C; at: Point; half: number }[] = [];
  for (const child of [...children].sort((a, b) => b.lines - a.lines)) {
    const at = places.get(child.id);
    if (at === undefined) continue;
    const half = (globeName(child.title).length * LETTER) / 2;
    if (written.some((other) => Math.abs(other.at.x - at.x) < other.half + half && Math.abs(other.at.z - at.z) < LINE)) continue;
    written.push({ child, at, half });
  }
  return children.flatMap((child) => written.filter((each) => each.child === child).map(({ at }) => ({ child, at })));
}

/** The level `level` shows: itself, or, while it is one part and nothing else, that part's. */
function shown(scope: Microscope, level: ScopeLevel | undefined): ScopeLevel | undefined {
  const only = level?.children;
  return level === undefined || level.path.length === 1 || only?.length !== 1 || only[0]!.opens === undefined ? level : shown(scope, scope.levels[only[0]!.opens]);
}

/**
 * The breadcrumb up from `level`: the story picks the story alone, a capability or part above re-roots the microscope on
 * it; one that would show this level again is named, not offered.
 */
function trail(scope: Microscope, level: ScopeLevel): string {
  if (level.path.length === 1) return "";
  return `<nav class="scope-trail" aria-label="Where the microscope is">${level.path.map((id, k) => {
    const name = text(level.titles[k]!);
    if (k === level.path.length - 1) return `<span class="scope-here" aria-current="location">${name}</span>`;
    if (k > 0 && shown(scope, scope.levels[id]) === level) return `<span class="scope-through">${name}</span>`;
    return k === 0 ? `<button type="button" class="scope-up" data-pick-story>${name}</button>` : `<button type="button" class="scope-up" data-scope-to="${attribute(id)}">${name}</button>`;
  }).join(`<span class="scope-step" aria-hidden="true">›</span>`)}</nav>`;
}

/**
 * The microscope's section in the panel, rooted on `root` (a level of `scope`), its `base` the story or capability the panel
 * shows. A level that is one part and nothing else shows that part's level, so every drill shows two or more things.
 */
export function scopeSection(scope: Microscope, base: string, root: string = base, later = false): string {
  const level = shown(scope, scope.levels[root] ?? scope.levels[base]);
  if (level === undefined) return "";
  // The microscope's levels travel with the panel's HTML, as an attribute written as text, so a part chosen is drawn from it.
  return `<section class="panel-microscope" aria-label="Microscope" data-scope-story="${attribute(scope.story)}" data-scope-base="${attribute(base)}" data-scope-root="${attribute(level.id)}" data-scope-levels="${attribute(JSON.stringify(scope))}">
    ${trail(scope, level)}${scopeDrawing(level, later)}</section>`;
}

/** The microscope's drills as the user works them: the part each story's microscope was last rooted on under the panel's base, kept across the panel's redraws until the base changes. */
export interface PanelScope {
  /** After the panel's HTML is drawn into `panel`: root its microscope where the user left it, and answer its parts (once per element). */
  draw(panel: HTMLElement): void;
}

export function panelScope(): PanelScope {
  const kept = new Map<string, { base: string; root: string }>();
  const wired = new WeakSet<HTMLElement>();
  /** The levels being laid out now, so a redraw meanwhile starts no second layout of one. */
  const laying = new Set<string>();
  const read = (section: HTMLElement): Microscope | undefined => {
    try { return JSON.parse(section.dataset.scopeLevels ?? "") as Microscope; } catch { return undefined; }
  };
  /** Re-root the panel's microscope on `root`, when it lies under the panel's base; a level not yet laid out is laid out in steps after it is shown. */
  const root = (panel: HTMLElement, to: string): void => {
    const section = panel.querySelector<HTMLElement>(".panel-microscope");
    const scope = section === null ? undefined : read(section);
    const base = section?.dataset.scopeBase;
    const level = scope === undefined ? undefined : shown(scope, scope.levels[to]);
    if (section === null || scope === undefined || base === undefined || level === undefined || !level.path.includes(base)) return;
    kept.set(scope.story, { base, root: to });
    const current = () => panel.querySelector<HTMLElement>(".panel-microscope");
    const pending = () => current()?.querySelector("[data-scope-pending]") != null;
    if (section.dataset.scopeRoot !== level.id) section.outerHTML = scopeSection(scope, base, level.id, true);
    if (!pending() || laying.has(level.id)) return;
    laying.add(level.id);
    const steps = scopeLayoutSteps(level);
    const view = panel.ownerDocument.defaultView;
    const step = (): void => {
      // A few milliseconds of layout to a task, so the panel stays answerable while a large level is laid out; given up once another is shown.
      if (current()?.dataset.scopeRoot !== level.id || !pending()) { laying.delete(level.id); return; }
      const until = performance.now() + 8;
      while (performance.now() < until) if (steps.next().done === true) { laying.delete(level.id); current()!.outerHTML = scopeSection(scope, base, level.id, true); return; }
      view?.setTimeout(step, 0);
    };
    view?.setTimeout(step, 0);
  };
  const choose = (panel: HTMLElement, event: Event): void => {
    const to = (event.target as Element | null)?.closest?.<HTMLElement | SVGElement>("[data-scope-to]");
    const id = to?.getAttribute("data-scope-to");
    if (to === null || to === undefined || id === null || id === undefined || !panel.contains(to)) return;
    event.stopPropagation();
    root(panel, id);
  };
  return {
    draw(panel) {
      const section = panel.querySelector<HTMLElement>(".panel-microscope");
      const story = section?.dataset.scopeStory;
      const was = story === undefined ? undefined : kept.get(story);
      const base = section?.dataset.scopeBase;
      if (base !== undefined) root(panel, was !== undefined && was.base === base ? was.root : base);
      if (wired.has(panel)) return;
      wired.add(panel);
      panel.addEventListener("click", (event) => choose(panel, event));
      panel.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && (event.target as Element | null)?.closest?.("[data-scope-to], .panel-microscope [data-pick-capability]") != null) {
          event.preventDefault();
          (event.target as HTMLElement).dispatchEvent(new (panel.ownerDocument.defaultView!.MouseEvent)("click", { bubbles: true }));
        }
      });
    },
  };
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(value: string): string {
  return text(value).replace(/"/g, "&quot;");
}
