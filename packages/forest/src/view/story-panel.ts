/**
 * Capability 4 · Drill-down. The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It shows exactly what is selected, each thing once (ADR-1295, ADR-1297): a story picked alone is its title, its whole
 * description and its capabilities by name, each opening that capability; a capability picked is its title, its story
 * named small above it, its whole description and its contracts, each with its own state. Its open work, a contract's
 * detail and the story's extra checks wait in a fold behind a handle saying what is inside and how much, which a single
 * click opens (ADR-1287; ./panel-folds.ts works them). The island draws the capability tree and the territories carry
 * health, so the panel draws neither (ADR-1285). Every word from the library is written as text, never as HTML.
 */
import type { AcceptanceState, CapabilityLine, CheckReading, ContractLine, StoryPanel, WhyLine } from "@storytree/forest";
import type { HealthSource, HealthState } from "@storytree/library";

/**
 * The panel's HTML: `selected`, the capability picked, when it is one of the story's, else the story alone; no capability
 * is ever picked for the user (ADR-1297). Every fold is drawn closed, with nothing to open them all (ADR-1292); the page's
 * folds open the kinds the user keeps open. With the capability details switched off (ADR-0750) it is the story alone,
 * without its capabilities' names. A `gate` picked on the map, the pair of capabilities it joins, shows the edges between
 * them (ADR-1282 D1), each in one state line (ADR-1284 D4); `open` holds the contracts the arc opened in the Arcs tab
 * links in its open work.
 */
// Its head, on show exactly while the panel is, names the panel as the Story panel's canvas (Surface feedback).
export function renderStoryPanel(panel: StoryPanel, selected: string | undefined, { details = true, gate, open }: { details?: boolean; gate?: readonly [string, string] | undefined; open?: readonly string[] | undefined } = {}): string {
  if (gate !== undefined) return `${head(panel.title)}${gateLinks(panel, gate, open)}`;
  const shown = details ? panel.capabilities.find(({ id }) => id === selected) : undefined;
  if (shown !== undefined) return `${head(shown.title, panel.title)}${capability(shown)}`;
  return `${head(panel.title)}
    ${description(panel.description, "panel-sentences")}
    ${panel.mapped === undefined ? "" : mapped(panel.mapped)}
    ${needsYou(panel.capabilities)}
    ${details ? names(panel.capabilities) : ""}
    ${panel.checks === undefined || panel.checks.length === 0 ? "" : extraChecks(panel.checks)}`;
}

/** The panel's head: what is selected, and for a capability its story, named small above it, which opens the story alone. */
function head(title: string, story?: string): string {
  return `
    <header class="panel-head" data-surface-id="story-panel" data-surface-layer="panel">
      <div class="panel-titles">${story === undefined ? "" : `<button type="button" class="panel-story-name" data-pick-story>${text(story)}</button>`}<h2>${text(title)}</h2></div>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>`;
}

/** A whole description, each paragraph its own, with no fold (ADR-1297). */
function description(words: string, kind: string): string {
  const paragraphs = words.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph !== "");
  return `<div class="${kind}">${paragraphs.map((paragraph) => `<p>${text(paragraph)}</p>`).join("")}</div>`;
}

/** A story's capabilities by name, in build order, each a button that opens that capability (ADR-1297); with none, nothing. */
function names(capabilities: readonly CapabilityLine[]): string {
  if (capabilities.length === 0) return "";
  return `<ul class="panel-capabilities" aria-label="Capabilities">${capabilities
    .map(({ id, title }) => `<li><button type="button" class="panel-pick" data-pick-capability="${attribute(id)}">${text(title)}</button></li>`)
    .join("")}</ul>`;
}

/** One block of detail behind its handle, closed until the user opens it (ADR-1284 D1); `handle` is already text. */
function fold(kind: string, handle: string, inside: string): string {
  return `<div class="panel-fold" data-fold="${kind}"><button type="button" class="panel-handle" aria-expanded="false">${handle}</button><div class="panel-fold-body" hidden>${inside}</div></div>`;
}

/**
 * A picked gate: the edges joining its two capabilities, whichever depends on which, each saying so, then what passes
 * between them in its own words when someone wrote them (Fable's F3.1), and then its state in one line: its own contracts behind "Contracts · n", each opening as a capability's does, never either capability's
 * (ADR-1282 D1), and "open work on this link" when the opened arc's open work links one of them, the reason the gate is
 * ringed; one with none says so, with no handle (ADR-1284 D4). After the handle, how many of them storytree last saw
 * failing, when any are.
 */
function gateLinks(panel: StoryPanel, [one, other]: readonly [string, string], open: readonly string[] | undefined): string {
  const links = (panel.edges ?? []).filter(({ from, to }) => (from === one && to === other) || (from === other && to === one));
  return `
    <section class="panel-gate" aria-label="Gate">
      ${links.length === 0 ? `<p class="panel-muted">No link joins these two capabilities directly.</p>` : links
        .map(({ fromTitle, toTitle, description, contracts }) => `
          <h3>${text(fromTitle)} depends on ${text(toTitle)}.</h3>
          ${description === undefined ? "" : `<p class="panel-link-description">${text(description)}</p>`}
          ${contracts.length === 0
            ? `<p class="panel-muted">No contracts on this link yet.</p>`
            : `<div class="panel-link-state">${fold("contracts", `Contracts · ${contracts.length}`, contractList(contracts))}${failing(contracts)}${contracts.some(({ id }) => open?.includes(id) === true) ? `<span class="panel-link-open">open work on this link</span>` : ""}</div>`}`)
        .join("")}
    </section>`;
}

/** How many of a link's contracts wear a red gear, in its state line; with none, nothing. */
function failing(contracts: readonly ContractLine[]): string {
  const count = contracts.filter(({ gear }) => gear?.state === "failing").length;
  return count === 0 ? "" : `<span class="panel-link-failing">${count} failing</span>`;
}

/** What a mapped story is (ADR-0993 D3), in place of a health it does not carry, with its counts once surveyed. */
function mapped({ files, lines }: NonNullable<StoryPanel["mapped"]>): string {
  const counts = files === undefined || lines === undefined ? "" : ` ${files.toLocaleString("en-GB")} file${files === 1 ? "" : "s"}, ${lines.toLocaleString("en-GB")} line${lines === 1 ? "" : "s"}.`;
  return `<p class="panel-mapped"><strong>Mapped:</strong> here before storytree, and assumed to be working.${counts}</p>`;
}

type ExtraCheck = NonNullable<StoryPanel["checks"]>[number];

const TRIGGER: Readonly<Record<ExtraCheck["trigger"], string>> = { change: "on every change", release: "before each formal release" };

/**
 * The extra checks only this story carries, each with what sets it off; the standard tests are not listed. Its risk
 * rating is switched off (question_0de2b8280384), so the panel shows none.
 */
function extraChecks(checks: readonly ExtraCheck[]): string {
  return fold("extra-checks", `Extra checks · ${checks.length}`, `<ul class="panel-checks">${checks
    .map(({ check, trigger, capability }) => `<li>${text(check)}${capability === undefined ? "" : ` <span class="panel-muted">(${text(capability)})</span>`}, ${TRIGGER[trigger]}</li>`)
    .join("")}</ul>`);
}

/** A capability's contracts, each with its own state on show (ADR-1297); with none, it says so. */
function contracts(line: CapabilityLine): string {
  if (line.contracts.length === 0) return `<p class="panel-muted">No contracts yet.</p>`;
  return `<h3 class="panel-subhead">Contracts</h3>${contractList(line.contracts)}`;
}

/**
 * Contracts, a capability's or a link's alike, each by its title and, after it, one small icon per check it has and no words
 * (question_32b645261409, Mick's answer A): a gear for storytree's run of its tests, a robot for agentic user acceptance
 * testing, each green passed, red failed or yellow not run yet. The agent's report colours nothing (ADR-0630). Each opens one
 * level deeper to every check in full words, the agent's trail said as the agent's, the tests that last judged it (Fable's
 * F2.4), and when it was last seen if not re-run since.
 */
function contractList(contracts: readonly ContractLine[]): string {
  return `<ul class="panel-contracts">${contracts
    .map((contract) => {
      const icons = [
        ...(contract.gear === undefined ? [] : [mark("gear", contract.gear.state, run(contract.gear))]),
        ...(contract.acceptance === undefined ? [] : [mark("robot", ACCEPTANCE[contract.acceptance].state, accepted(contract.acceptance))]),
      ].join("");
      return `
      <li data-contract-id="${attribute(contract.id)}">${fold("contract", `<span class="panel-contract-said">${text(contract.title)}</span><span class="panel-marks">${icons}</span>`, `
        <span class="panel-health">
          ${contract.gear === undefined ? "" : `<span class="panel-check">${text(run(contract.gear))}</span>`}
          ${contract.local === undefined ? "" : `<span class="panel-check">${text(run(contract.local))}</span>`}
          ${contract.acceptance === undefined ? "" : `<span class="panel-check">${text(accepted(contract.acceptance))}</span>`}
          <span class="panel-trail">${text(trail(contract.trail))}</span>
          ${contract.ran?.tests === undefined || contract.ran.tests.length === 0 ? "" : testedBy(contract.ran.tests)}
          ${contract.lastSeen === undefined ? "" : `<span class="panel-last-seen">last seen ${contract.lastSeen.state === "passing" ? "passing" : "failing"} ${day(contract.lastSeen.at)}, not re-run since</span>`}
        </span>`)}</li>`;
    })
    .join("")}</ul>`;
}

/** The icons a contract row draws, each a shape alone, never words (the app's menu gear is larger and grey). */
const ICONS: Readonly<Record<"gear" | "robot", string>> = {
  gear: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 1h2l.4 2 1.3.6 1.7-1.2 1.4 1.4-1.2 1.7.6 1.3 2 .4v2l-2 .4-.6 1.3 1.2 1.7-1.4 1.4-1.7-1.2-1.3.6-.4 2H7l-.4-2-1.3-.6-1.7 1.2-1.4-1.4 1.2-1.7-.6-1.3-2-.4V7l2-.4.6-1.3-1.2-1.7 1.4-1.4 1.7 1.2 1.3-.6zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>`,
  robot: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.25 1h1.5v2H12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.25zM5.5 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM5.5 10.5v1h5v-1zM0 6h1.5v4H0zm14.5 0H16v4h-1.5z"/></svg>`,
};

/** One check's icon, coloured by its state; its words are for a screen reader alone. */
function mark(kind: "gear" | "robot", state: HealthState, words: string): string {
  return `<span class="panel-mark mark-${kind} state-${state}" data-mark="${kind}" data-state="${state}" role="img" aria-label="${attribute(words)}">${ICONS[kind]}</span>`;
}

/** What storytree's run said, in full words: "storytree's run: fails, from CI, 11 Nov"; a run not yet made has no where or when. */
function run({ state, source, at }: CheckReading): string {
  if (state === "not-checked") return "storytree's run: not run yet";
  return `storytree's run: ${state === "passing" ? "passes" : "fails"}${source === undefined ? "" : `, ${FROM[source]}`}${at === undefined ? "" : `, ${day(at)}`}`;
}

/**
 * A capability picked: why it is not green and who moves it, only when that needs the user; that nothing checks a
 * report-only project; where it is parked; its whole description; its open work; then its contracts. Its health is the
 * territory's to show (ADR-1295), so it has no word and no Health fold here.
 */
function capability(line: CapabilityLine): string {
  return `
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      ${line.reportOnly ? "" : lead(line)}
      ${line.reportOnly ? `<p class="panel-why report-only">${text(NOT_VERIFIED)}.</p>` : ""}
      ${line.parkedOn === undefined ? "" : parked(line.parkedOn)}
      ${description(line.description, "panel-lead")}
      ${line.openWork === undefined || line.openWork.length === 0 ? "" : openWork(line.openWork)}
      ${contracts(line)}
    </section>`;
}

/** The why line matters only when it is unhealthy or untested, or the owner moves it: "not built yet" on a proposed one is no news. */
function mattersWhy(status: CapabilityLine["status"], { mover }: WhyLine): boolean {
  return status === "unhealthy" || status === "untested" || mover === "owner";
}

/** On the story's surface, only when the owner moves one of its capabilities: how many need him (ADR-1284 D2). */
function needsYou(capabilities: readonly CapabilityLine[]): string {
  const count = capabilities.filter(({ why: reason }) => reason?.mover === "owner").length;
  if (count === 0) return "";
  return `<p class="panel-needs-you">${count} ${count === 1 ? "capability needs" : "capabilities need"} you</p>`;
}

/** What a report-only capability says in place of a reason (ADR-0630); the library's words, kept here as the panel's. */
const NOT_VERIFIED = "storytree does not check this project's tests yet";

/** How many of a capability's contracts carry a reason: "2 of 4 contracts". */
function counted(carrying: number, of: number): string {
  return `${carrying} of ${of} contract${of === 1 ? "" : "s"}`;
}

/** The reason in the owner's words, by how many of how many contracts carry it; none carrying it, said of the capability. */
const REASON: Readonly<Record<WhyLine["reason"], (carrying: number, of: number) => string>> = {
  "not built": () => "it is not built yet",
  failing: (carrying, of) => (carrying === 0 ? "it is failing" : `${counted(carrying, of)} ${carrying === 1 ? "fails" : "fail"}`),
  "not re-run": (carrying, of) => `${counted(carrying, of)} ${carrying === 1 ? "was" : "were"} not re-run`,
  "no test names it": (carrying, of) => (carrying === 0 ? "no test names it" : `no test names ${counted(carrying, of)}`),
  "out of CI's reach": (carrying, of) => `${counted(carrying, of)} can only run on another platform`,
  "needs owner": (carrying, of) => `${counted(carrying, of)} ${carrying === 1 ? "needs" : "need"} something only you can give`,
};

/**
 * Under its title (4.49, ADR-0825 D1): why it is not green, in counts of its contracts, and who moves it. A contract counts as
 * failing by its gear, so a CI failure counts though a later local run passed it (question_32b645261409); any failing gear
 * on a built capability makes the reason failing, else the library's reason stands, shown only when it matters. The agent's work is named by the
 * open increment that moves it, with what it waits on; the owner's says he moves it. Everything the library says is text.
 */
function lead(line: CapabilityLine): string {
  const failing = line.contracts.filter(({ gear }) => gear?.state === "failing");
  const reason: WhyLine | undefined = failing.length > 0 && line.status !== "proposed" && line.why?.reason !== "not built"
    ? { reason: "failing", mover: "agent", contracts: failing.map(({ id }) => id), ...(line.why?.reason === "failing" && line.why.since !== undefined ? { since: line.why.since } : {}), ...gearSources(failing) }
    : line.why !== undefined && mattersWhy(line.status, line.why) ? line.why : undefined;
  if (reason === undefined) return "";
  const { mover, since, sources } = reason;
  const sentence = REASON[reason.reason](reason.contracts.length, line.contracts.length);
  return `<p class="panel-why mover-${mover}"><strong>Why not green:</strong> ${text(sentence)}${sources === undefined ? "" : `, ${FROM[sourceKey(sources)]}`}${since === undefined || reason.reason === "not re-run" ? "" : `, since ${day(since)}`}. <span class="panel-mover">${text(mover === "owner" ? "You move this one." : moves(line.openWork))}</span></p>`;
}

/** The sources failing gears were read from, local before CI, when they say. */
function gearSources(contracts: readonly ContractLine[]): { sources?: HealthSource[] } {
  const said = (["local", "ci"] as const).filter((source) => contracts.some(({ gear }) => gear?.source === source));
  return said.length === 0 ? {} : { sources: [...said] };
}

/** The open increment that moves it, the first in the library's order, and what holds it, else that it is under way or ready to take. */
function moves(work: CapabilityLine["openWork"]): string {
  const next = work?.[0];
  if (next === undefined) return "No open work moves it yet.";
  if (next.waits !== undefined && next.waits.length > 0) return `${next.title} moves it; it waits on ${and(next.waits.map(waitSaid))}.`;
  return `${next.title} moves it; ${next.active ? "it is under way" : "it is ready to take"}.`;
}

/** One thing holding an increment, as the lead says it. */
function waitSaid(wait: NonNullable<NonNullable<CapabilityLine["openWork"]>[number]["waits"]>[number]): string {
  switch (wait.kind) {
    case "work": return `${wait.title}${wait.state === "active" ? ", which is under way" : wait.state === "ready" ? ", which is ready to take" : ""}`;
    case "claim": return `another session's claim on ${wait.title}`;
    case "question": return "your answer to a question";
    case "owner": return `you: ${wait.note}`;
    case "event": return `an outside event: ${wait.note}`;
  }
}

/** Phrases joined as a sentence says them: "a", "a and b", "a, b and c"; with a comma inside one, the last after ", and". */
function and(phrases: readonly string[]): string {
  if (phrases.length < 2) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")}${phrases.some((phrase) => phrase.includes(",")) ? ", and" : " and"} ${phrases.at(-1)}`;
}

/** Why a grey territory is grey (ADR-0992 D6): the arcs that park it, by title. */
function parked(arcs: NonNullable<CapabilityLine["parkedOn"]>): string {
  const titles = arcs.map(({ title }) => title);
  const named = titles.length < 2 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  return `<p class="panel-parked">Parked on ${text(named)}: shelved on purpose.</p>`;
}

/** The open work naming it, in the library's order (ADR-1253 D1): read here, not drawn on the map; each row's button opens its increment (4.48). */
function openWork(increments: NonNullable<CapabilityLine["openWork"]>): string {
  return fold("open-work", `Open work · ${increments.length}`, `<ol class="panel-open-work">${increments
    .map(({ increment, title, active }) => `<li data-increment-id="${attribute(increment)}"${active ? ` class="active"` : ""}><button type="button" class="panel-open-increment" data-open-increment="${attribute(increment)}">${text(title)}${active ? ` <span class="panel-muted">(in progress)</span>` : ""}</button></li>`)
    .join("")}</ol>`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time as the day it fell on, in UTC so every reader sees the same: "27 Sep". */
function day(at: string): string {
  const when = new Date(at);
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}

/** How many tests the fold names before saying how many more there are. */
const TESTS_NAMED = 3;

/** The tests that last judged a contract, when its entry kept them. */
function testedBy(tests: readonly string[]): string {
  const more = tests.length - TESTS_NAMED;
  return `<span class="panel-tests">tested by ${text(tests.slice(0, TESTS_NAMED).join("; "))}${more > 0 ? ` and ${more} more` : ""}</span>`;
}

/** The agent's trail on a contract, said as the agent's: a history of its reports, not a check (ADR-0630 D2). */
function trail(words: string): string {
  return words === "not reported yet" ? "the agent has not reported it yet" : `the agent reported it ${words}`;
}

/** Agentic user acceptance testing's state on a contract marked for it, its robot's colour and its words, never "UAT" (ADR-1294 D1). */
const ACCEPTANCE: Readonly<Record<AcceptanceState, { words: string; state: HealthState }>> = {
  passed: { words: "passed", state: "passing" },
  failed: { words: "failed", state: "failing" },
  "not-run": { words: "not run yet", state: "not-checked" },
};

function accepted(state: AcceptanceState): string {
  return `agentic user acceptance testing: ${ACCEPTANCE[state].words}`;
}

/** Where storytree saw a verdict, in words (ADR-1193 D3). */
const FROM: Readonly<Record<"local" | "ci" | "both", string>> = { local: "verified locally", ci: "from CI", both: "verified locally and from CI" };

function sourceKey(sources: readonly HealthSource[]): "local" | "ci" | "both" {
  return sources.length > 1 ? "both" : (sources[0] ?? "local");
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(value: string): string {
  return text(value).replace(/"/g, "&quot;");
}
