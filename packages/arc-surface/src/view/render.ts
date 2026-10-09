/** Capability 3 · Arc surface. */
import type { NoteWait } from "@storytree/library";
import type { BoardAgent } from "../agents/agents.js";
import { briefing, type QuestionReading } from "../briefing/briefing.js";
import type { Bar, BoardView, Lane, LaneNoteWait } from "../board/board.js";
import { arcSurfaces } from "../surfaces/surfaces.js";
import { queueRun, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";

export const escape = (text: string) => text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
/** The same full-width control at rest and above the open drawer. */
export function renderHandle(_project: string, open: boolean): string {
  const action = open ? "Close" : "Open";
  return `<button type="button" class="arc-handle" data-${open ? "close" : "open"}-arcs aria-label="${action} arc surface" aria-expanded="${open}" aria-controls="arc-drawer" title="${action} arcs"><span class="arc-handle-label">${escape(arcSurfaces[0].name)}</span><span class="arc-handle-caret" aria-hidden="true">${open ? "▴" : "▾"}</span></button>`;
}
const agentText = (agent: BoardAgent) => `${agent.label} · window opened ${agent.startedAt}\n${agent.reason}\n${agent.activity}`;
const workText = (work: WorkName) => `${work.title}${work.arc ? ` (${work.arc.title})` : ""}`;
const waitText = (wait: NamedWait) => `Waiting for ${workText(wait)}: ${wait.reason}${wait.warning ? ` — ${wait.warning}` : ""}`;
/** What a wait for the owner or an event says, still holding or its check-back passed (ADR-0938). */
const noteText = (wait: NoteWait) => !wait.holds ? `check-back passed ${wait.checkBack}: ${wait.note}`
  : wait.releaser === "owner" ? `waits for you: ${wait.note}`
  : `waits for an event: ${wait.note} (check back ${wait.checkBack})`;
const laneNoteText = (wait: LaneNoteWait) => `${wait.increment.title}: ${noteText(wait)}`;
function barText(bar: Bar): string {
  return [bar.title, `${bar.reading.state.replaceAll("-", " ")} · ${bar.reading.progress.replaceAll("-", " ")}`,
    ...(bar.reading.close ? [`Close: ${bar.reading.close}`] : []), ...(bar.blockedBy ? [`Blocked by ${workText(bar.blockedBy)}, which holds a capability it lists`] : []), ...bar.agents.map(agentText), ...bar.waits.map(waitText), ...bar.noteWaits.map(noteText),
    ...bar.questionsBehind.map((question) => `waiting on you: ${question}`), ...bar.holdsUp.map((work) => `Holds up ${workText(work)}: ${work.reason}`)].join("\n");
}
function renderBar(bar: Bar): string {
  const title = barText(bar);
  const passed = bar.reading.checkBackPassed ? ` arc-check-back" data-check-back-passed="true` : "";
  return `<span class="arc-bar arc-${bar.reading.color}${passed}" data-increment-id="${escape(bar.id)}" role="img" aria-label="${escape(title)}" title="${escape(title)}">${bar.agents.map((agent) => `<span class="arc-agent-mark" data-agent-session="${escape(agent.session)}" data-work-id="${escape(agent.increment ?? agent.capability)}" data-agent-label="${escape(agent.label)}" aria-label="${escape(agentText(agent))}">●</span>`).join("")}</span>`;
}
function laneText(lane: Lane): string {
  return [lane.count, ...lane.agents.map(agentText), ...lane.waits.map(waitText), ...lane.noteWaits.map(laneNoteText),
    ...lane.holdsUp.map((work) => `Holds up ${workText(work)}: ${work.reason}`)].join("\n");
}
/** A ready lane that also has idle claims keeps them beside its chip, muted; its hover names who holds what (ADR-0938 D3). */
function renderIdleMarker(lane: Lane): string {
  if (!lane.idle) return "";
  const held = (agent: BoardAgent) => lane.bars.find(({ id }) => id === agent.increment)?.title ?? agent.increment ?? agent.capability;
  const title = lane.idle.agents.map((agent) => `Holds ${held(agent)}\n${agentText(agent)}`).join("\n");
  return `<span class="arc-chip arc-idle-marker" title="${escape(title)}">${escape(lane.idle.chip)}</span>`;
}
/** A ready lane with open work held by a note wait says how many increments and the first note, beside its chip (ADR-0938). */
function renderNoteMarker(lane: Lane): string {
  if (lane.state !== "ready" || !lane.noteWaits.length) return "";
  const notes = [...new Set(lane.noteWaits.map(({ note }) => note))];
  const held = new Set(lane.noteWaits.map(({ increment }) => increment.id)).size;
  return `<span class="arc-chip arc-note-marker" title="${escape(lane.noteWaits.map(laneNoteText).join("\n"))}"><span class="arc-note-text">+${held} waiting for ${escape(notes[0]!)}</span>${notes.length > 1 ? `<span class="arc-note-more"> and ${notes.length - 1} more</span>` : ""}</span>`;
}
/** A queued lane names its first blocker on its own line, and how many others: work first, then notes (ADR-0760 D1, ADR-0938). */
function renderWaitsOn(lane: Lane): string {
  const waits = lane.state !== "queued" ? [] : [
    ...lane.waits.map((wait) => ({ text: `waits on ${wait.title}${wait.arc ? ` · ${wait.arc.title}` : ""}`, hover: waitText(wait) })),
    ...lane.noteWaits.map((wait) => ({ text: noteText(wait), hover: laneNoteText(wait) }))];
  const [first, ...rest] = waits;
  if (!first) return "";
  return `<span class="arc-waits-on" title="${escape(waits.map(({ hover }) => hover).join("\n"))}">${escape(first.text)}</span>${rest.length ? `<span class="arc-other-waits">+${rest.length} other wait${rest.length === 1 ? "" : "s"}</span>` : ""}`;
}
function renderQueue(queue: ArcQueue, lanes: ReadonlyMap<string, Lane>, selected: string | undefined, expanded: ReadonlySet<string>): string {
  const lane = lanes.get(queue.arc.id)!;
  const open = expanded.has(lane.id);
  const run = queueRun(queue);
  const chips = run.chips.map((chip, index) => {
    const behind = run.shape === "chain" && index > 0 ? run.chips[index - 1]!.title : lane.title;
    const queued = lanes.get(chip.id)!;
    const title = [queued.title, laneText(queued), ...queued.bars.map(barText)].join("\n");
    return `${index ? `<span aria-hidden="true">${run.shape === "chain" ? "→" : "·"}</span>` : ""}<button type="button" class="arc-queue-chip" data-arc-id="${escape(chip.id)}" data-arc-select="${escape(chip.id)}" aria-pressed="${selected === chip.id}" aria-label="${escape(`${chip.title} — queued behind ${behind}${chip.waitsOn.length ? `, waits on ${chip.waitsOn.join(", ")}` : ""}${chip.hidden ? `, holds up ${chip.hidden} more` : ""}`)}" title="${escape(title)}"><span class="arc-queue-title">${escape(chip.title)}</span>${chip.hidden ? `<span class="arc-queue-more">+${chip.hidden}</span>` : ""}</button>${chip.otherWaits ? `<span class="arc-other-waits">+${chip.otherWaits} other wait${chip.otherWaits === 1 ? "" : "s"}</span>` : ""}`;
  });
  const queueLabel = `${open ? "Hide" : "Show"} ${queue.queued.length} arc${queue.queued.length === 1 ? "" : "s"} queued behind ${lane.title}`;
  return `<section class="arc-row" data-arc-id="${escape(lane.id)}"><div class="arc-lane-line">
    <span class="arc-caret-slot">${queue.queued.length ? `<button type="button" class="arc-caret" data-arc-queue="${escape(lane.id)}" aria-expanded="${open}" aria-controls="arc-queue-${escape(lane.id)}" aria-label="${escape(queueLabel)}" title="${escape(queueLabel)}"><span aria-hidden="true">${open ? "▾" : "▸"}</span></button>` : ""}</span>
    <button type="button" class="arc-lane" data-arc-select="${escape(lane.id)}" aria-pressed="${selected === lane.id}">
      <span class="arc-lane-head"><span class="arc-chip arc-state-${lane.state}" title="${escape(laneText(lane))}">${escape(lane.chip)}</span>${renderIdleMarker(lane)}${renderNoteMarker(lane)}<span class="arc-title" title="${escape(lane.title)}">${escape(lane.title)}</span></span>
      <span class="arc-track"><span class="arc-bars" aria-label="Increments">${lane.bars.map(renderBar).join("")}</span><span class="arc-count">${escape(lane.count)}</span>${renderWaitsOn(lane)}</span>
    </button></div>${open && queue.queued.length ? `<div class="arc-queue" id="arc-queue-${escape(lane.id)}" data-queue-shape="${run.shape}"><span aria-hidden="true">→</span>${chips.join("")}</div>` : ""}</section>`;
}
function renderQuestionItem(question: QuestionReading): string {
  return `<div class="arc-question-item">${question.answer ? `<div class="arc-answer"><strong>Answer</strong><p>${escape(question.answer)}</p></div>` : ""}<div class="arc-question-title">${escape(question.title)}</div><div class="arc-question-cost"><small>${question.words} words · ${question.hasDiagram ? "diagram stored" : "no diagram"}</small><button type="button" data-question-open="${escape(question.id)}">Open ↗</button></div></div>`;
}
function renderQuestion(question: QuestionReading): string {
  return `${question.answer ? `<div class="arc-answer"><strong>Answer</strong><p>${escape(question.answer)}</p></div>` : ""}
    <article class="arc-question" data-question-id="${escape(question.id)}"><div class="arc-reading-head"><button type="button" data-question-back>← back to questions</button><small>${question.words} words</small></div><h3>${escape(question.title)}</h3>
    ${question.lead.map(({ label, text }) => `<h4>${label}</h4><p class="arc-prose">${escape(text)}</p>`).join("")}
    <h4>Diagram</h4><pre class="arc-diagram">${escape(question.diagram)}</pre>
    <h4>Options</h4>${question.options.map((option) => `<div class="arc-option"><p>${escape(option.summary)}</p>${option.for || option.against ? `<dl><dt>For</dt><dd>${escape(option.for)}</dd><dt>Against</dt><dd>${escape(option.against)}</dd></dl>` : ""}</div>`).join("")}
    ${question.recommendation ? `<h4>${question.recommendation.label}</h4><p class="arc-prose">${escape(question.recommendation.text)}</p>` : ""}
    ${question.folds.map(({ label, text, words }) => `<details class="arc-fold" data-fold-key="${escape(question.id)}:${label}"><summary>${label} · ${words} words</summary><p class="arc-prose">${escape(text)}</p></details>`).join("")}</article>`;
}

/** HTML is a reading: every stored title and field is escaped before entering the page. */
export function renderBoard(board: BoardView, picked?: string, openedQuestion?: string, expanded: ReadonlySet<string> = new Set()): string {
  const selected = board.lanes.find(({ id }) => id === picked) ?? board.lanes.find(({ id }) => id === board.selected);
  const detail = selected ? briefing(selected.view.arc.fields.intent, selected.view.questions, { parked: selected.view.state === "parked" }) : undefined;
  const question = [...(detail?.waiting ?? []), ...(detail?.settled ?? [])].find(({ id }) => id === openedQuestion);
  return `<nav class="arc-scopes" aria-label="Arc lifecycle">${(["active", "parked", "closed"] as const).map((scope) => `<button type="button" data-arc-scope="${scope}" aria-pressed="${board.scope === scope}">${scope[0]!.toUpperCase() + scope.slice(1)}</button>`).join("")}</nav>
    <div class="arc-panes"><div class="arc-lanes" aria-label="Arcs">${board.lanes.length ? board.queues.map((queue) => renderQueue(queue, new Map(board.lanes.map((lane) => [lane.id, lane])), selected?.id, expanded)).join("") : `<p class="arc-empty">No ${board.scope} arcs.</p>`}</div>
    <aside class="arc-briefing" aria-label="Arc briefing">${question ? renderQuestion(question) : selected && detail ? `<h3>${escape(selected.title)}</h3><p class="arc-prose arc-intent">${escape(detail.intent)}</p><h4>${detail.waitingLabel}</h4>${detail.waiting.map(renderQuestionItem).join("")}<p class="arc-blocked-note">${escape(detail.blockedNote)}</p>${detail.settled.length ? `<h4>Settled</h4>${detail.settled.map(renderQuestionItem).join("")}` : ""}` : "<p>Pick an arc to read its briefing.</p>"}</aside></div>`;
}
