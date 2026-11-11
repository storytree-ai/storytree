/** Capability 3 · Arc surface. */
import type { NoteWait } from "@storytree/library";
import { pennantOutline, quietColour, sessionColour } from "@storytree/session-management/claim-mark";
import type { BoardAgent } from "../agents/agents.js";
import { briefing, incrementRows, type IncrementRow, type QuestionReading } from "../briefing/briefing.js";
import { ownerCount, ownerWaits, type Bar, type BoardView, type Lane, type LaneNoteWait } from "../board/board.js";
import type { CiBar, CiLeg } from "../board/ci-bars.js";
import { queueRun, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";

export const escape = (text: string) => text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const agentText = (agent: BoardAgent) => [`${agent.label} · window opened ${agent.startedAt}`, ...(agent.reason ? [agent.reason] : []), agent.activity].join("\n");
const workText = (work: WorkName) => `${work.title}${work.arc ? ` (${work.arc.title})` : ""}`;
/** A name and its reason; the name alone when the reason is blank, as the website's snapshot keeps it. */
const because = (name: string, reason: string) => reason ? `${name}: ${reason}` : name;
const waitText = (wait: NamedWait) => `Waiting for ${because(workText(wait), wait.reason)}${wait.warning ? ` — ${wait.warning}` : ""}`;
/** What a wait for the owner or an event says, still holding or its check-back passed (ADR-0938). */
const noteText = (wait: NoteWait) => !wait.holds ? `check-back passed ${wait.checkBack}: ${wait.note}`
  : wait.releaser === "owner" ? `waits for you: ${wait.note}`
  : `waits for an event: ${wait.note} (check back ${wait.checkBack})`;
const laneNoteText = (wait: LaneNoteWait) => `${wait.increment.title}: ${noteText(wait)}`;
function barText(bar: Bar): string {
  return [bar.title, `${bar.reading.state.replaceAll("-", " ")} · ${bar.reading.progress.replaceAll("-", " ")}`,
    ...(bar.reading.close ? [`Close: ${bar.reading.close}`] : []), ...(bar.blockedBy ? [`Blocked by ${workText(bar.blockedBy)}, which holds a capability it lists`] : []), ...bar.agents.map(agentText), ...bar.waits.map(waitText), ...bar.noteWaits.map(noteText),
    ...bar.questionsBehind.map((question) => `waiting on you: ${question}`), ...bar.holdsUp.map((work) => `Holds up ${because(workText(work), work.reason)}`)].join("\n");
}
/** The globe's flag at this share of its drawn size, its outline and shadow in the globe's ink (ADR-0968). */
const FLAG_K = 0.55, INK = "#0d1114";
const px = (value: number) => Number(value.toFixed(2));
/**
 * A holder's flag planted on its increment's oval: the globe's pennant in the session's colour on a dark pole, its foot at
 * the oval's middle; furled and greyed while its holder is idle with its hooks running, as the globe judges it.
 */
function renderFlag(agent: BoardAgent): string {
  const q = agent.holder === "idle" && agent.hooksRunning ? 1 : 0;
  const outline = pennantOutline(FLAG_K, q).map(([x, y]) => `${px(x)},${px(-y)}`).join(" L");
  const top = px(-26 * FLAG_K);
  return `<svg class="arc-agent-mark" viewBox="-3 -15 14 17" width="14" height="17" aria-hidden="true" data-agent-session="${escape(agent.session)}" data-work-id="${escape(agent.increment ?? agent.capability)}" data-agent-label="${escape(agent.label)}">`
    + `<ellipse cx="0" cy="0" rx="${px(4.4 * FLAG_K)}" ry="${px(2 * FLAG_K)}" fill="#080b0e" fill-opacity="0.45"/>`
    + `<path class="arc-flag-pennant" d="M${outline}Z" fill="${quietColour(sessionColour(agent.session), q)}" stroke="${INK}" stroke-width="0.65" stroke-linejoin="round"/>`
    + `<line x1="0" y1="0" x2="0" y2="${top}" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}
function renderBar(bar: Bar): string {
  const title = barText(bar);
  const passed = bar.reading.checkBackPassed ? ` arc-check-back" data-check-back-passed="true` : "";
  return `<span class="arc-bar arc-${bar.reading.color}${passed}" data-increment-id="${escape(bar.id)}" role="img" aria-label="${escape(title)}" title="${escape(title)}">${bar.agents.map(renderFlag).join("")}</span>`;
}
/** The rows a strip may take, and the oval places each fold mark is drawn across, its gaps included (ADR-0980 D3 as narrowed). */
const STRIP_ROWS = 4, LANDED_PLACES = 3, MORE_PLACES = 2;
const foldMark = (kind: string, text: string, label: string, bars: readonly Bar[]) => {
  const named = [label, ...bars.map(({ title }) => title)].join("\n");
  return `<span class="arc-fold-mark arc-${kind}-mark" role="img" aria-label="${escape(named)}" title="${escape(named)}" data-folded-ids="${escape(bars.map(({ id }) => id).join(" "))}">${escape(text)}</span>`;
};
/**
 * An arc's strip, never taller than four rows of `perRow` ovals: one that fits is drawn whole; past that its landed ovals
 * fold into one "N landed" mark at its start, and open ovals still beyond the fourth row into a "+N" mark at its end.
 * Unmeasured, it is drawn whole.
 */
function renderStrip(bars: readonly Bar[], perRow: number | undefined): string {
  const places = perRow === undefined ? Infinity : STRIP_ROWS * Math.max(perRow, LANDED_PLACES);
  if (bars.length <= places) return bars.map(renderBar).join("");
  const landed = bars.filter(({ reading }) => reading.state === "landed"), rest = bars.filter(({ reading }) => reading.state !== "landed");
  const room = places - (landed.length ? LANDED_PLACES : 0);
  const shown = rest.length <= room ? rest : rest.slice(0, room - MORE_PLACES), hidden = rest.slice(shown.length);
  return (landed.length ? foldMark("landed", `${landed.length} landed`, `${landed.length} landed`, landed) : "")
    + shown.map(renderBar).join("") + (hidden.length ? foldMark("more", `+${hidden.length}`, `${hidden.length} more`, hidden) : "");
}
const LEG_NAMES: Record<CiLeg["name"], string> = { checks: "Checks", queue: "Merge queue" };
const TONES: Record<CiLeg["tone"], string> = { "on-time": "", long: " · running long", hung: " · well past: hung or flaky?" };
const mins = (minutes: number) => `${Math.floor(minutes)} min`;
/** What one leg says on its bar's hover: elapsed over expected while it runs (3.34). */
function legText(leg: CiLeg): string {
  const said = leg.phase === "waiting" ? (leg.name === "queue" ? "waiting its turn" : "waiting to run")
    : leg.phase === "done" ? "passed" : leg.phase === "ahead" ? "not yet"
    : leg.expected === undefined ? `${mins(leg.elapsed ?? 0)}, no factory median yet` : `${mins(leg.elapsed ?? 0)} of ${mins(leg.expected)} expected${TONES[leg.tone]}`;
  return `${LEG_NAMES[leg.name]}: ${said}`;
}
const SYSTEMS: Record<string, string> = { linux: "Linux", win32: "Windows", darwin: "macOS" };
/** How many of an estimate's packages its hover names before it counts the rest. */
const NAMED = 6;
/** What a bar's expected times are from (3.35): its own checks estimate, named as rough with its packages and system, else the factory median. */
function basisText(estimate: CiBar["estimate"]): string {
  if (estimate === undefined) return "Expected from the factory median";
  const names = estimate.packages.map((dir) => dir.split("/").at(-1)!);
  const named = names.length > NAMED ? `${names.slice(0, NAMED).join(", ")} and ${names.length - NAMED} more` : names.join(", ");
  const from = estimate.system === undefined ? "no timed package, setup alone"
    : estimate.full ? `every package on ${SYSTEMS[estimate.system] ?? estimate.system}`
    : `${names.length} package${names.length === 1 ? "" : "s"} on ${SYSTEMS[estimate.system] ?? estimate.system} (${named})`;
  return `Checks expected from ${from}: a rough estimate; merge queue from the factory median`;
}
/** A CI leg's drawn length, the gap between the two and their height, in the bar's own pixels. */
const CI_LEG = 90, CI_GAP = 4, CI_HEIGHT = 5;
/**
 * One leg as drawn: its track, its fill as long as its share and hatching while it waits to run. An SVG's attributes, never an
 * inline style, which the page's content security policy refuses.
 */
function renderCiLeg(leg: CiLeg, index: number): string {
  const x = index * (CI_LEG + CI_GAP);
  const fill = leg.phase === "running" || leg.phase === "done"
    ? `<rect class="arc-ci-fill" data-fill="${Math.round(leg.fill * 100)}" x="${x}" width="${px(CI_LEG * leg.fill)}" height="${CI_HEIGHT}" rx="2.5"/>` : "";
  const hatch = leg.phase === "waiting" ? `<path class="arc-ci-hatch" d="${Array.from({ length: CI_LEG / 5 }, (_, i) => `M${x + i * 5 + 0.5} ${CI_HEIGHT}L${x + i * 5 + 4.5} 0`).join("")}"/>` : "";
  return `<g class="arc-ci-leg arc-ci-${leg.name} arc-ci-${leg.phase} arc-ci-${leg.tone}"><rect class="arc-ci-track" x="${x}" width="${CI_LEG}" height="${CI_HEIGHT}" rx="2.5"/>${fill}${hatch}</g>`;
}
/** A pull request in CI's two-leg bar (3.34): its checks, then the merge queue, each filled by time over what it is expected to take (3.35). */
function renderCiBar(bar: CiBar): string {
  const title = [`Pull request #${bar.pr} in CI: ${bar.increment.title}`, ...bar.legs.map(legText), basisText(bar.estimate),
    `Last change seen ${bar.seenAgo} min ago`].join("\n");
  const width = 2 * CI_LEG + CI_GAP;
  return `<span class="arc-ci" data-ci-pr="${bar.pr}" data-ci-increment="${escape(bar.increment.id)}" role="img" aria-label="${escape(title)}" title="${escape(title)}"><span class="arc-ci-pr" aria-hidden="true">#${bar.pr}</span>`
    + `<svg viewBox="0 0 ${width} ${CI_HEIGHT}" width="${width}" height="${CI_HEIGHT}" aria-hidden="true">${bar.legs.map(renderCiLeg).join("")}</svg></span>`;
}
/** A lane's CI bars, one per pull request in CI, as its `.arc-ci-bars` holds them: drawn apart, the clock moves only these (3.34). */
export const renderCiBars = (lane: Lane): string => lane.ci.map(renderCiBar).join("");
function laneText(lane: Lane): string {
  return [lane.count, ...lane.agents.map(agentText), ...lane.waits.map(waitText), ...lane.noteWaits.map(laneNoteText),
    ...lane.holdsUp.map((work) => `Holds up ${because(workText(work), work.reason)}`)].join("\n");
}
/** A lane's chip hover: what it reads, and on a ready lane who holds what while idle (ADR-0938 D3). */
function chipText(lane: Lane): string {
  const held = (agent: BoardAgent) => lane.bars.find(({ id }) => id === agent.increment)?.title ?? agent.increment ?? agent.capability;
  return [laneText(lane), ...(lane.idle?.agents ?? []).map((agent) => `${lane.idle!.chip}: holds ${held(agent)}`)].join("\n");
}
const hourglass = `<svg class="arc-mark-icon" viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><path d="M1.5 1h7M1.5 11h7M2.5 1c0 3 2.5 3.6 2.5 5s-2.5 2-2.5 5M7.5 1c0 3-2.5 3.6-2.5 5s2.5 2 2.5 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
/** What a lane's open work waits on, counted once per thing: other work and events (hourglass), then the owner (question mark); the wording moves to each mark's hover and label (ADR-0980). */
function renderMarks(lane: Lane): string {
  const open = lane.bars.filter(({ reading }) => reading.state !== "landed" && reading.state !== "not-completed");
  const works = new Map(open.flatMap((bar) => bar.waits).map((wait) => [wait.id, wait]));
  const notes = (owner: boolean) => lane.noteWaits.filter(({ releaser }) => (releaser === "owner") === owner);
  const events = notes(false), { questions, owners } = ownerWaits(lane);
  const mark = (kind: string, icon: string, count: number, lines: string[]) => count ? `<span class="arc-mark arc-mark-${kind}" role="img" aria-label="${escape(lines.join("\n"))}" title="${escape(lines.join("\n"))}">${icon}<span class="arc-mark-count">${count}</span></span>` : "";
  const marks = mark("waits", hourglass, works.size + new Set(events.map(({ note }) => note)).size, [...[...works.values()].map(waitText), ...events.map(laneNoteText)])
    + mark("owner", `<span class="arc-mark-icon" aria-hidden="true">?</span>`, ownerCount(lane), [...questions.map(({ fields }) => `waiting on you: ${fields.title}`), ...owners.map(laneNoteText)]);
  return marks ? `<span class="arc-marks">${marks}</span>` : "";
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/**
 * What an arc's row opens under it (3.21, 5.1): its intent folded behind one line with the copy-title button beside it, then its
 * questions, each unfolding its reading in place, then its increments with the landed folded. Fold keys start with `key`.
 */
function renderExpansion(lane: Lane, key: string, named?: string): string {
  const detail = briefing(lane.view.arc.fields.intent, lane.view.questions, { parked: lane.view.state === "parked" });
  const rows = incrementRows(lane);
  const unfolded = rows.filter(({ landed }) => !landed), landed = rows.filter(({ landed }) => landed);
  return `<div class="arc-under-head"><details class="arc-fold arc-intent-fold" data-fold-key="${escape(`${key}:intent`)}"><summary>Intent</summary><p class="arc-prose arc-intent">${escape(detail.intent)}</p></details>`
    + `<button type="button" class="arc-copy" data-copy-arc-title="${escape(lane.id)}" aria-label="${escape(`Copy the title of ${lane.title}`)}" title="Copy title">${copyIcon}</button></div>`
    + `${detail.questions.length ? `${detail.parkedNote ? `<p class="arc-parked-note">${escape(detail.parkedNote)}</p>` : ""}<div class="arc-table arc-rail-questions">${detail.questions.map((question) => renderQuestionRow(key, question)).join("")}</div>` : ""}`
    + `${rows.length ? `<div class="arc-table arc-rail-increments">${unfolded.map((row) => renderIncrementRow(key, row, row.id === named ? lane.title : undefined)).join("")}${landed.length ? `<details class="arc-fold arc-landed-fold" data-fold-key="${escape(`${key}:landed`)}"><summary>${landed.length} landed</summary>${landed.map((row) => renderIncrementRow(key, row, row.id === named ? lane.title : undefined)).join("")}</details>` : ""}</div>` : ""}`;
}
/** An arc's row and what its caret, or its click, opens under it (3.21, ADR-1222): its expansion, then its queued arcs, the selected one's expansion under them (4.1). */
function renderQueue(queue: ArcQueue, lanes: ReadonlyMap<string, Lane>, opened: string | undefined, expanded: ReadonlySet<string>, perRow: number | undefined, ciApart: boolean, named: string | undefined): string {
  const lane = lanes.get(queue.arc.id)!;
  const open = expanded.has(lane.id);
  const run = queueRun(queue);
  const chips = run.chips.map((chip, index) => {
    const behind = run.shape === "chain" && index > 0 ? run.chips[index - 1]!.title : lane.title;
    const queued = lanes.get(chip.id)!;
    const title = [queued.title, laneText(queued), ...queued.bars.map(barText)].join("\n");
    return `${index ? `<span aria-hidden="true">${run.shape === "chain" ? "→" : "·"}</span>` : ""}<button type="button" class="arc-queue-chip" data-arc-id="${escape(chip.id)}" data-arc-select="${escape(chip.id)}" aria-pressed="${opened === chip.id}" aria-label="${escape(`${chip.title} — queued behind ${behind}${chip.waitsOn.length ? `, waits on ${chip.waitsOn.join(", ")}` : ""}${chip.hidden ? `, holds up ${chip.hidden} more` : ""}`)}" title="${escape(title)}"><span class="arc-queue-title">${escape(chip.title)}</span>${chip.hidden ? `<span class="arc-queue-more">+${chip.hidden}</span>` : ""}</button>${chip.otherWaits ? `<span class="arc-other-waits">+${chip.otherWaits} other wait${chip.otherWaits === 1 ? "" : "s"}</span>` : ""}`;
  });
  const chosen = run.chips.some(({ id }) => id === opened) ? lanes.get(opened!) : undefined;
  const holds = ["the intent", ...(lane.view.questions.length ? [plural(lane.view.questions.length, "question")] : []), ...(incrementRows(lane).length ? [plural(incrementRows(lane).length, "increment")] : []), ...(queue.queued.length ? [plural(queue.queued.length, "queued arc")] : [])];
  const caretLabel = `${open ? "Hide" : "Show"} ${holds.join(", ")} under ${lane.title}`;
  const under = renderExpansion(lane, `rail:${lane.id}`, named)
    + `${queue.queued.length ? `<div class="arc-queue" data-queue-shape="${run.shape}"><span aria-hidden="true">→</span>${chips.join("")}</div>` : ""}`
    + `${chosen ? `<div class="arc-queued-under" role="group" aria-label="${escape(chosen.title)}">${renderExpansion(chosen, `rail:${chosen.id}`, named)}</div>` : ""}`;
  return `<section class="arc-row" data-arc-id="${escape(lane.id)}"><div class="arc-lane-line">
    <span class="arc-caret-slot"><button type="button" class="arc-caret" data-arc-queue="${escape(lane.id)}" aria-expanded="${open}" aria-controls="arc-under-${escape(lane.id)}" aria-label="${escape(caretLabel)}" title="${escape(caretLabel)}"><span aria-hidden="true">${open ? "▾" : "▸"}</span></button></span>
    <button type="button" class="arc-lane" data-arc-select="${escape(lane.id)}" aria-pressed="${opened === lane.id}" aria-expanded="${open}">
      <span class="arc-lane-head"><span class="arc-chip arc-state-${lane.state}" title="${escape(chipText(lane))}">${escape(lane.chip)}</span>${lane.priority === undefined ? "" : `<span class="arc-chip arc-priority" title="Priority ${lane.priority}">P${lane.priority}</span>`}<span class="arc-title" title="${escape(lane.title)}">${escape(lane.title)}</span>${renderMarks(lane)}</span>
      <span class="arc-track${lane.bars.some(({ agents }) => agents.length) ? " arc-flagged" : ""}"><span class="arc-bars" role="group" aria-label="${escape(`Increments: ${lane.count}`)}">${renderStrip(lane.bars, perRow)}</span></span>${lane.ci.length ? `<span class="arc-ci-bars" data-ci-lane="${escape(lane.id)}">${ciApart ? "" : renderCiBars(lane)}</span>` : ""}
    </button></div>${open ? `<div class="arc-under" id="arc-under-${escape(lane.id)}">${under}</div>` : ""}</section>`;
}
/** One question, one row: its title and its status, unfolding in place to its reading (5.2, ADR-0980 D5). */
function renderQuestionRow(key: string, question: QuestionReading): string {
  return `<details class="arc-question-row" data-rail-question="${escape(question.id)}" data-fold-key="${escape(`${key}:question:${question.id}`)}"><summary><span class="arc-row-title" title="${escape(question.title)}">${escape(question.title)}</span><span class="arc-status-chip arc-status-${question.status}">${question.status}</span></summary>${renderQuestion(key, question)}</details>`;
}
const detailList = (label: string, lines: readonly string[]) => lines.length ? `<dt>${label}</dt>${lines.map((line) => `<dd>${escape(line)}</dd>`).join("")}` : "";
/** One increment, one row that opens in place to its objective and waits, never its planning body; given `arcTitle`, it names its arc first (3.39). */
function renderIncrementRow(arc: string, row: IncrementRow, arcTitle?: string): string {
  const { detail } = row;
  return `<details class="arc-increment" data-fold-key="${escape(`${arc}:increment:${row.id}`)}"><summary><span class="arc-swatch arc-${row.color}" aria-hidden="true"></span><span class="arc-increment-title" title="${escape(row.title)}">${escape(row.title)}</span><span class="arc-increment-cell">${row.chips.map(({ kind, text }) => `<span class="arc-status-chip arc-wait-${kind}">${escape(text)}</span>`).join("")}</span></summary>
    <dl class="arc-increment-detail">${detailList("Arc", arcTitle ? [arcTitle] : [])}${detailList("Objective", detail.objective ? [detail.objective] : [])}${detailList("Waits on", detail.waits)}${detailList("Behind your questions", detail.questionsBehind)}${detailList("Holds up", detail.holdsUp)}${detailList("Held by", detail.heldBy)}${detailList("Closed", detail.close ? [detail.close] : [])}</dl></details>`;
}
/** Two overlapping sheets: the expansion's copy-title control (3.20). */
export const copyIcon = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6" fill="none" stroke="currentColor"/></svg>`;
/** A question's full reading, unfolded under its row: its answer first when settled (5.3), then statement first (5.2). */
function renderQuestion(key: string, question: QuestionReading): string {
  return `<article class="arc-question" data-question-id="${escape(question.id)}">${question.answer ? `<div class="arc-answer"><strong>Answer</strong><p>${escape(question.answer)}</p></div>` : ""}${question.words ? `<small class="arc-words">${question.words} words</small>` : ""}
    ${question.lead.map(({ label, text }) => `<h4>${label}</h4><p class="arc-prose">${escape(text)}</p>`).join("")}
    ${question.diagram ? `<h4>Diagram</h4><pre class="arc-diagram">${escape(question.diagram)}</pre>` : ""}
    ${question.options.length ? "<h4>Options</h4>" : ""}${question.options.map((option) => `<div class="arc-option"><p>${escape(option.summary)}</p>${option.for || option.against ? `<dl><dt>For</dt><dd>${escape(option.for)}</dd><dt>Against</dt><dd>${escape(option.against)}</dd></dl>` : ""}</div>`).join("")}
    ${question.recommendation ? `<h4>${question.recommendation.label}</h4><p class="arc-prose">${escape(question.recommendation.text)}</p>` : ""}
    ${question.folds.map(({ label, text, words }) => `<details class="arc-fold" data-fold-key="${escape(`${key}:question:${question.id}:${label}`)}"><summary>${label} · ${words} words</summary><p class="arc-prose">${escape(text)}</p></details>`).join("")}</article>`;
}

const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "7 days"]] as const;
/** The Closed tab's range bar (3.12), as the sessions History tab's: its presets, then a From–to of days. */
function renderClosedRange(closed: NonNullable<BoardView["closed"]>): string {
  const pressed = (preset: string) => "preset" in closed.range && closed.range.preset === preset;
  return `<div class="arc-closed-range" role="group" aria-label="Arcs closed in">${PRESETS.map(([preset, name]) => `<button type="button" data-closed-range="${preset}" aria-pressed="${pressed(preset)}">${name}</button>`).join("")}`
    + `<label>From <input type="date" data-closed-from value="${escape(closed.from)}" max="${escape(closed.to)}"></label><label>to <input type="date" data-closed-to value="${escape(closed.to)}" min="${escape(closed.from)}"></label></div>`;
}

/**
 * HTML is a reading: every stored title and field is escaped before entering the page. The arc selected by its row's click is
 * pressed, and the arcs in `expanded` show what is under their rows. `perRow` is how many ovals one row of a strip holds, as the page measured it; unmeasured, strips are drawn whole.
 * With `ciApart`, each lane's CI bars are left out of their holder, for `renderCiBars` to fill on their own (3.34). The increment
 * `named`, opened from outside the rail, names its arc in its row (3.39).
 */
export function renderBoard(board: BoardView, opened?: string, expanded: ReadonlySet<string> = new Set(), perRow?: number, ciApart = false, named?: string): string {
  const lanes = new Map(board.lanes.map((lane) => [lane.id, lane]));
  return `<nav class="arc-scopes" aria-label="Arc lifecycle">${(["active", "parked", "closed"] as const).map((scope) => `<button type="button" data-arc-scope="${scope}" aria-pressed="${board.scope === scope}">${scope[0]!.toUpperCase() + scope.slice(1)}</button>`).join("")}</nav>
    ${board.closed ? renderClosedRange(board.closed) : ""}
    <div class="arc-lanes" aria-label="Arcs">${board.lanes.length ? board.queues.map((queue) => renderQueue(queue, lanes, lanes.has(opened ?? "") ? opened : undefined, expanded, perRow, ciApart, named)).join("")
      : board.closed?.reading ? `<p class="arc-empty" role="status">Reading closed arcs…</p>` : `<p class="arc-empty">No ${board.closed ? "arcs closed in this range" : `${board.scope} arcs`}.</p>`}</div>`;
}
