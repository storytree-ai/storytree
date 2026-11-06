/**
 * Capability 4 · Drill-down: the map's legend, in the story panel's foot (ADR-1236, as narrowed by ADR-1253; the mock's
 * tools/panel.tsx `mock-legend`). Each entry says in words what one kind of mark on the selected island means, beside a small
 * drawing of it in the colours the island draws it in, and names the marks it describes (`draws`, each mark's name up to its
 * first colon), so nothing the island draws goes unexplained and nothing listed is missing from it (4.39). The sea's marks,
 * drawn by the planet (capability 4 · The planet), are `at: "sea"`.
 */
import { SEA_LANE } from "@storytree/forest-world/geometry";
import { GROUND, LIT, PORTAL, POST, QUIET_BORDER, ROAD } from "./island-roads.js";
import { OPEN_WORK } from "./open-work.js";
import { GLYPHS, SYMBOL_INK, type Kind } from "./settlement-symbols.js";
import { MAPPED_FILL, PARKED_FILL, UNCHARTED_FILL, UNCHARTED_HATCH, WORD_FILL } from "./territory-land.js";

/** One line of the legend: its words, its drawing (SVG), the marks it names, and the fill it shows, for a territory's. */
export type LegendEntry = { readonly words: string; readonly mark: string; readonly draws: readonly string[]; readonly fill?: string; readonly at?: "sea" };

/** What each kind of settlement is called (the mock's KIND_NAMES). */
const KIND_WORDS: Readonly<Record<Kind, string>> = { store: "store", service: "service", queue: "queue", index: "index", link: "connection", log: "record" };

/** A sample session's colour, for the marks drawn in whichever session's colour they belong to. */
const SESSION = "#56b4e9";

const svg = (box: string, body: string) => `<svg class="legend-mark" viewBox="${box}" aria-hidden="true">${body}</svg>`;
const swatch = (colour: string, opacity = 1, over = "") => svg("0 0 26 14", `<rect x="1" y="1" width="24" height="12" rx="2" fill="${colour}" fill-opacity="${opacity}" />${over}`);
const band = (colour: string, width: number) => `<path d="M1 7H25" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" />`;
const post = (x: number, y: number, size = 3.6) => `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${POST.paper}" stroke="${POST.ink}" stroke-width="1" />`;
const path = (points: readonly (readonly [number, number])[], closed: boolean) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;

/** A settlement kind's symbol, as the island draws it: ink outlines over paper. */
function symbol(kind: Kind): string {
  const { parts, lines } = GLYPHS[kind];
  const ink = `stroke="${SYMBOL_INK.ink}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"`;
  return svg("-14 -14 28 28", [...parts.map((p) => `<path d="${path(p, true)}" fill="${SYMBOL_INK.paper}" ${ink} />`), ...lines.map((p) => `<path d="${path(p, false)}" fill="none" ${ink} />`)].join(""));
}

/** The legend, top to bottom: the land, then the roads on it, then what stands on them, then the marks of work, then the sea. */
export const MAP_LEGEND: readonly LegendEntry[] = [
  { words: "healthy: storytree saw its contracts pass", mark: swatch(WORD_FILL.healthy.colour, WORD_FILL.healthy.opacity), draws: ["territory"], fill: WORD_FILL.healthy.colour },
  { words: "unhealthy: a contract of it is failing", mark: swatch(WORD_FILL.unhealthy.colour, WORD_FILL.unhealthy.opacity), draws: ["territory"], fill: WORD_FILL.unhealthy.colour },
  { words: "proposed or untested: not proven yet", mark: swatch(WORD_FILL.untested.colour, WORD_FILL.untested.opacity), draws: ["territory"], fill: WORD_FILL.untested.colour },
  { words: "parked: shelved on purpose", mark: swatch(PARKED_FILL.colour, PARKED_FILL.opacity), draws: ["territory"], fill: PARKED_FILL.colour },
  { words: "mapped: here before storytree, assumed to be working", mark: swatch(MAPPED_FILL.colour, MAPPED_FILL.opacity), draws: ["territory"], fill: MAPPED_FILL.colour },
  {
    words: "unclaimed: code no capability holds yet",
    mark: swatch(UNCHARTED_FILL.colour, UNCHARTED_FILL.opacity, `<path d="M3 13L13 3M9 13L19 3M15 13L25 3" stroke="${UNCHARTED_HATCH.colour}" stroke-opacity="${UNCHARTED_HATCH.opacity}" />`),
    draws: ["territory", "territory-hatch"], fill: UNCHARTED_FILL.colour,
  },
  { words: "border between two territories", mark: svg("0 0 26 14", `<path d="M13 1V13" stroke="${QUIET_BORDER.colour}" stroke-opacity="${QUIET_BORDER.opacity * 2}" />`), draws: ["territory-borders"] },
  { words: "open land, where the roads come ashore; the island's coast and sides", mark: swatch(GROUND), draws: ["island-ground", "island-coast", "island-side"] },
  {
    words: "plateau: each territory stands above the open land, its walls shaded by the light, a bevel inside its border",
    mark: svg("0 0 26 14", `<rect x="1" y="5" width="24" height="8" fill="#000" fill-opacity="0.3" /><rect x="1" y="1" width="20" height="8" fill="${WORD_FILL.healthy.colour}" stroke="#fff" stroke-opacity="0.45" />`),
    draws: ["relief-walls", "relief-shadows", "relief-rims"],
  },
  { words: "ramp: where a road climbs from the open land onto a plateau", mark: svg("0 0 26 14", `<path d="M1 12H9L17 4H25" fill="none" stroke="${ROAD.colour}" stroke-width="2.4" />`), draws: ["relief-ramps", "relief-ramp-cheeks"] },
  {
    words: "road: links share it while they go the same way, wider where it carries more (1, 2 to 3, 4 to 7, 8 or more); click it for what it carries",
    mark: svg("0 0 26 14", `<path d="M1 3H25" stroke="${ROAD.colour}" stroke-width="1" /><path d="M1 6.5H25" stroke="${ROAD.colour}" stroke-width="1.6" /><path d="M1 11H25" stroke="${ROAD.colour}" stroke-width="2.6" />`),
    draws: ["road", "road-junction"],
  },
  {
    words: "gate: one between each two linked capabilities, where the road enters the one depended on, a post either side; links whose gates stand together share one; click it to ring it and pick the pair it joins",
    mark: svg("0 -2 26 18", `<path d="M13 -2V1M13 12V16" stroke="${QUIET_BORDER.colour}" />${band(ROAD.colour, 2)}${post(11.2, 1)}${post(11.2, 9.4)}`),
    draws: ["gate-post", "gate-face", "gate-shadow"],
  },
  {
    words: "tunnel: a road that must cross a third territory goes under it, an arched portal at each end; click a portal for the links it carries",
    mark: svg("0 0 26 14", `${band(ROAD.colour, 2).replace("M1 7H25", "M1 12H9")}<path d="M8 13V8A5 5 0 0 1 18 8V13Z" fill="${PORTAL.mouth}" stroke="${PORTAL.stone}" stroke-width="1.6" />`),
    draws: ["tunnel-portal", "tunnel-mouth"],
  },
  {
    words: "settlement, where a territory's roads meet, drawn as what it is, larger where more roads meet:",
    mark: (Object.keys(KIND_WORDS) as Kind[]).map((kind) => `<span class="legend-kind" data-kind="${kind}">${symbol(kind)}${KIND_WORDS[kind]}</span>`).join(""),
    draws: ["settlement-casing", "settlement-paper", "settlement-ink", "settlement-lines"],
  },
  { words: "a picked gate, ringed in gold", mark: svg("0 0 26 14", `${post(8.2, 5.2)}${post(14.2, 5.2)}<circle cx="13" cy="7" r="6" fill="none" stroke="${LIT.gold}" stroke-width="1.4" />`), draws: ["gate-ring"] },
  { words: "a picked link's whole way, lit in gold", mark: svg("0 0 26 14", `${band(LIT.edge, 4)}${band(LIT.gold, 2.6)}`), draws: ["road-lit-edge", "road-lit-gold", "road-lit-edge-end", "road-lit-gold-end"] },
  {
    words: "open work: an arc selected rings each capability its open increments name, and the island from far, and dims the rest",
    mark: swatch("#0b0f14", 0.5, `<circle cx="13" cy="7" r="4.6" fill="none" stroke="${OPEN_WORK}" stroke-width="1.4" />`),
    draws: ["open-work-ring", "open-work-island", "open-work-dim"],
  },
  { words: "a session's reads, in its colour, fainter once out of its window", mark: swatch(WORD_FILL.healthy.colour, WORD_FILL.healthy.opacity, `<rect x="1" y="1" width="24" height="12" rx="2" fill="${SESSION}" fill-opacity="0.36" />`), draws: ["territory-lit"] },
  {
    words: "claim: a running session's flag, in its colour, on what it is changing; a dashed lot on an island with no code yet",
    mark: svg("0 0 26 14", `<ellipse cx="9" cy="12" rx="5" ry="1.6" fill="#080b0e" fill-opacity="0.45" /><path d="M9 12V1" stroke="#0d1114" stroke-width="1.4" /><path d="M9.5 1.5L19 4.5L9.5 7.5Z" fill="${SESSION}" stroke="#0d1114" stroke-width="0.8" />`),
    draws: ["claim-ring", "flag-shadow", "flag-pennant", "flag-outline", "flag-pole", "claim-lot"],
  },
  {
    words: "shipping lane: calls to or from another story, wider where lanes merge; it ends at a port",
    mark: svg("0 0 26 14", `<path d="M1 7H19" stroke="${SEA_LANE}" stroke-width="2.2" />${post(19.5, 4, 5)}`),
    draws: ["lane", "port-house", "port-tower", "port-shadow"], at: "sea",
  },
];

/** The legend as the story panel's foot. Every word is the legend's own, never the library's. */
export function renderMapLegend(): string {
  return `
    <footer class="panel-legend" aria-label="What the map draws">
      <ul>${MAP_LEGEND.map(({ words, mark, draws }) => draws.includes("settlement-paper")
        ? `<li class="legend-kinds">${words}${mark}</li>` : `<li>${mark}<span>${words}</span></li>`).join("")}</ul>
    </footer>`;
}
