/**
 * Capability 4 · Drill-down. The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It shows exactly what is selected, each thing once (ADR-1295, ADR-1297): a story picked alone is its title, its whole
 * description and its capabilities by name, each opening that capability; a capability picked is its title, its story
 * named small above it, its whole description and its contracts, each with its own state. Its open work, a contract's
 * detail and the story's extra checks wait in a fold behind a handle saying what is inside and how much, which a single
 * click opens (ADR-1287; ./panel-folds.ts works them). The island draws the capability tree and the territories carry
 * health, so the panel draws neither (ADR-1285). Every word from the library is written as text, never as HTML.
 */
import type { AcceptanceState, CapabilityLine, ContractLine, StoryPanel, WhyLine } from "@storytree/forest";
import type { HealthSource, HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };

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

/** How many of a link's contracts storytree last saw failing, in its state line; with none, nothing. */
function failing(contracts: readonly ContractLine[]): string {
  const count = contracts.filter(({ verified }) => verified === "failing").length;
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
 * Contracts, a capability's or a link's alike, each by its title and its state in plain words: "tests pass", "tests fail"
 * or "tests not run" with its source where something judged it, else the agent's claim, labelled as its claim and never
 * as a check (ADR-1294 D1, question_ee767f05e0b9 part 4); a contract marked for agentic user acceptance testing also
 * says where that stands, and an unmarked one says nothing of it. Each opens one level deeper to its trail, the tests that last
 * judged it and the day they ran with their result (Fable's F2.4), and when it was last seen if not re-run since.
 */
function contractList(contracts: readonly ContractLine[]): string {
  return `<ul class="panel-contracts">${contracts
    .map((contract) => {
      const state = contract.verified === undefined ? claim(contract.reported) : tests(contract.verified, contract.source);
      const acceptance = contract.acceptance === undefined ? "" : ` ${accepted(contract.acceptance)}`;
      return `
      <li data-contract-id="${attribute(contract.id)}">${fold("contract", `<span class="panel-contract-said">${text(contract.title)} ${state}${acceptance}</span>`, `
        <span class="panel-health">
          <span class="panel-trail">${text(trail(contract.trail))}</span>
          ${contract.ran === undefined ? "" : ran(contract.ran, contract.verified, contract.source)}
          ${contract.lastSeen === undefined ? "" : `<span class="panel-last-seen">last seen ${contract.lastSeen.state === "passing" ? "passing" : "failing"} ${day(contract.lastSeen.at)}, not re-run since</span>`}
        </span>`)}</li>`;
    })
    .join("")}</ul>`;
}

/**
 * A capability picked: why it is not green and who moves it, only when that needs the user; that nothing checks a
 * report-only project; where it is parked; its whole description; its open work; then its contracts. Its health is the
 * territory's to show (ADR-1295), so it has no word and no Health fold here.
 */
function capability(line: CapabilityLine): string {
  return `
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      ${line.reportOnly || line.why === undefined || !mattersWhy(line.status, line.why) ? "" : why(line.why)}
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

/** The reason in the owner's words, by what carries it. */
const REASON: Readonly<Record<WhyLine["reason"], (named: string) => string>> = {
  "not built": () => "it is not built yet",
  failing: (named) => `${named} ${/ and |, /.test(named) ? "are" : "is"} failing`,
  "not re-run": (named) => `${named} ${/ and |, /.test(named) ? "were" : "was"} not re-run`,
  "no test names it": (named) => `no test names ${named}`,
  "out of CI's reach": (named) => `${named} can only run on another platform`,
  "needs owner": (named) => `${named} needs something only you can give`,
};

/** Under its word: why it is not green and who moves it (ADR-0825 D1). Everything the library says is text. */
function why({ reason, mover, contracts, since, sources }: WhyLine): string {
  const named = contracts.length < 2 ? (contracts[0] ?? "it") : `${contracts.slice(0, -1).join(", ")} and ${contracts.at(-1)}`;
  const sentence = REASON[reason](reason === "not built" ? "" : named);
  return `<p class="panel-why mover-${mover}"><strong>Why not green:</strong> ${text(sentence)}${sources === undefined ? "" : `, ${FROM[sourceKey(sources)]}`}${since === undefined || reason === "not re-run" ? "" : `, since ${day(since)}`}. <span class="panel-mover">${mover === "owner" ? "You move this one." : "The agent moves this one."}</span></p>`;
}

/** Why a grey territory is grey (ADR-0992 D6): the arcs that park it, by title. */
function parked(arcs: NonNullable<CapabilityLine["parkedOn"]>): string {
  const titles = arcs.map(({ title }) => title);
  const named = titles.length < 2 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  return `<p class="panel-parked">Parked on ${text(named)}: shelved on purpose.</p>`;
}

/** The open work naming it, in the library's order (ADR-1253 D1): read here, not drawn on the map. */
function openWork(increments: NonNullable<CapabilityLine["openWork"]>): string {
  return fold("open-work", `Open work · ${increments.length}`, `<ol class="panel-open-work">${increments
    .map(({ increment, title, active }) => `<li data-increment-id="${attribute(increment)}"${active ? ` class="active"` : ""}>${text(title)}${active ? ` <span class="panel-muted">(in progress)</span>` : ""}</li>`)
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

/** The run that last judged a contract: the tests it named, when it kept them, then the day it ran, its result and where. */
function ran({ at, tests }: NonNullable<ContractLine["ran"]>, state: HealthState | undefined, source: HealthSource | undefined): string {
  const more = (tests?.length ?? 0) - TESTS_NAMED;
  const named = tests === undefined || tests.length === 0 ? "" : `<span class="panel-tests">tested by ${text(tests.slice(0, TESTS_NAMED).join("; "))}${more > 0 ? ` and ${more} more` : ""}</span>`;
  const result = state === "failing" ? "tests failed" : "tests passed";
  return `${named}<span class="panel-last-ran">last ran ${day(at)}: ${result}${source === undefined ? "" : `, ${FROM[source]}`}</span>`;
}

/** The agent's trail on a contract, said as the agent's: a history of its reports, not a check (ADR-0630 D2). */
function trail(words: string): string {
  return words === "not reported yet" ? "the agent has not reported it yet" : `the agent reported it ${words}`;
}

/** The agent's own word on a contract nothing else judged: its claim, never a check. */
function claim(state: HealthState): string {
  return `<span class="panel-badge badge-${state}">the agent's claim: ${HEALTH[state]}</span>`;
}

/** What the tests said of a contract, in plain words, and where (ADR-1294 D1). */
const TESTS: Readonly<Record<HealthState, string>> = { passing: "tests pass", failing: "tests fail", "not-checked": "tests not run" };

function tests(state: HealthState, source: HealthSource | undefined): string {
  return `<span class="panel-badge badge-${state}">${TESTS[state]}${source === undefined ? "" : `, ${FROM[source]}`}</span>`;
}

/** Agentic user acceptance testing's state on a contract marked for it, in full words, never "UAT" (ADR-1294 D1). */
const ACCEPTANCE: Readonly<Record<AcceptanceState, { words: string; badge: HealthState }>> = {
  passed: { words: "passed", badge: "passing" },
  failed: { words: "failed", badge: "failing" },
  "not-run": { words: "not run", badge: "not-checked" },
};

function accepted(state: AcceptanceState): string {
  return `<span class="panel-badge badge-${ACCEPTANCE[state].badge}">agentic user acceptance testing: ${ACCEPTANCE[state].words}</span>`;
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
