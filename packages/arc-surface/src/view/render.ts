import type { BoardAgent } from "../agents/agents.js";
import { briefing, type QuestionReading } from "../briefing/briefing.js";
import type { Bar, BoardView, Lane } from "../board/board.js";
import { queueRun, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";

export const escape = (text: string) => text.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const agentText = (agent: BoardAgent) => `${agent.label} · window opened ${agent.startedAt}\n${agent.reason}\n${agent.activity}`;
const workText = (work: WorkName) => `${work.title}${work.arc ? ` (${work.arc.title})` : ""}`;
const waitText = (wait: NamedWait) => `Waiting for ${workText(wait)}: ${wait.reason}${wait.warning ? ` — ${wait.warning}` : ""}`;
function renderBar(bar: Bar): string {
  const title = [bar.title, `${bar.reading.state.replaceAll("-", " ")} · ${bar.reading.progress.replaceAll("-", " ")}`,
    ...(bar.reading.close ? [`Close: ${bar.reading.close}`] : []), ...bar.agents.map(agentText), ...bar.waits.map(waitText),
    ...bar.holdsUp.map((work) => `Holds up ${workText(work)}: ${work.reason}`)].join("\n");
  return `<span class="arc-bar arc-${bar.reading.color}" data-increment-id="${escape(bar.id)}" role="img" aria-label="${escape(title)}" title="${escape(title)}">${bar.agents.map((agent) => `<span class="arc-agent-mark" data-agent-session="${escape(agent.session)}" data-work-id="${escape(agent.increment ?? agent.capability)}" data-agent-label="${escape(agent.label)}" aria-label="${escape(agentText(agent))}">●</span>`).join("")}</span>`;
}
function renderLane(lane: Lane, selected: string | undefined): string {
  const holders = lane.agents.map((agent) => `${lane.bars.filter((bar) => bar.agents.includes(agent)).map((bar) => bar.title).join(", ")}: ${agentText(agent)}`).join("\n");
  const waits = [...lane.waits.map(waitText), ...lane.holdsUp.map((work) => `Holds up ${workText(work)}: ${work.reason}`)].join("\n");
  return `<section class="arc-lane${selected === lane.id ? " arc-selected" : ""}" data-arc-id="${escape(lane.id)}">
    <div class="arc-lane-head"><button type="button" class="arc-pick" data-arc-select="${escape(lane.id)}" aria-pressed="${selected === lane.id}">${escape(lane.title)}</button><span class="arc-chip arc-state-${lane.state}" title="${escape([holders, waits].filter(Boolean).join("\n"))}">${escape(lane.chip)}</span></div>
    <div class="arc-bars" aria-label="Increments">${lane.bars.map(renderBar).join("")}</div>
    <p class="arc-count">${escape(lane.count)}</p>${lane.waits.length ? `<p class="arc-wait-summary">${lane.waits.map((wait) => escape(waitText(wait))).join("<br>")}</p>` : ""}
  </section>`;
}
function renderQueue(queue: ArcQueue, lanes: ReadonlyMap<string, Lane>, selected: string | undefined): string {
  const lane = lanes.get(queue.arc.id)!;
  let html = renderLane(lane, selected);
  if (queue.queued.length) {
    const run = queueRun(queue);
    const chips = run.chips.map((chip) => `<button type="button" data-arc-select="${escape(chip.id)}" title="${escape(chip.reasons.join("\n"))}">${escape(chip.title)}${chip.hidden ? ` +${chip.hidden}` : ""}${chip.otherWaits ? ` +${chip.otherWaits} other wait${chip.otherWaits === 1 ? "" : "s"}` : ""}</button>`);
    html += `<details class="arc-queue" data-fold-key="queue:${escape(lane.id)}"><summary>Queued after this arc <span class="arc-queue-chips">${chips.join(run.shape === "chain" ? " → " : " · ")}</span></summary><div class="arc-nested">${queue.queued.map((child) => renderQueue(child, lanes, selected)).join("")}</div></details>`;
  }
  return html;
}
function renderQuestion(question: QuestionReading): string {
  return `${question.answer ? `<div class="arc-answer"><strong>Answer</strong><p>${escape(question.answer)}</p></div>` : ""}
    <details class="arc-question" data-fold-key="question:${escape(question.id)}"><summary>${escape(question.title)}<small>${question.words} words · ${question.hasDiagram ? "diagram stored" : "no diagram"}</small></summary>
    ${question.lead.map(({ label, text }) => `<h4>${label}</h4><p class="arc-prose">${escape(text)}</p>`).join("")}
    <h4>Diagram</h4><pre class="arc-diagram">${escape(question.diagram)}</pre>
    <h4>Options</h4>${question.options.map((option) => `<div class="arc-option"><p>${escape(option.summary)}</p>${option.for || option.against ? `<dl><dt>For</dt><dd>${escape(option.for)}</dd><dt>Against</dt><dd>${escape(option.against)}</dd></dl>` : ""}</div>`).join("")}
    ${question.recommendation ? `<h4>${question.recommendation.label}</h4><p class="arc-prose">${escape(question.recommendation.text)}</p>` : ""}
    ${question.folds.map(({ label, text, words }) => `<details class="arc-fold" data-fold-key="${escape(question.id)}:${label}"><summary>${label} · ${words} words</summary><p class="arc-prose">${escape(text)}</p></details>`).join("")}</details>`;
}

/** HTML is a reading: every stored title and field is escaped before entering the page. */
export function renderBoard(board: BoardView, picked?: string): string {
  const selected = board.lanes.find(({ id }) => id === picked) ?? board.lanes.find(({ id }) => id === board.selected);
  const detail = selected ? briefing(selected.view.arc.fields.intent, selected.view.questions) : undefined;
  return `<nav class="arc-scopes" aria-label="Arc lifecycle">${(["active", "parked", "closed"] as const).map((scope) => `<button type="button" data-arc-scope="${scope}" aria-pressed="${board.scope === scope}">${scope[0]!.toUpperCase() + scope.slice(1)}</button>`).join("")}</nav>
    <div class="arc-panes"><div class="arc-lanes" aria-label="Arcs">${board.lanes.length ? board.queues.map((queue) => renderQueue(queue, new Map(board.lanes.map((lane) => [lane.id, lane])), selected?.id)).join("") : `<p class="arc-empty">No ${board.scope} arcs.</p>`}</div>
    <aside class="arc-briefing" aria-label="Arc briefing">${selected && detail ? `<h3>${escape(selected.title)}</h3><p class="arc-prose arc-intent">${escape(detail.intent)}</p><h4>${detail.waitingLabel}</h4>${detail.waiting.map(renderQuestion).join("")}<p class="arc-blocked-note">${escape(detail.blockedNote)}</p>${detail.settled.length ? `<h4>Settled</h4>${detail.settled.map(renderQuestion).join("")}` : ""}` : "<p>Pick an arc to read its briefing.</p>"}</aside></div>`;
}
