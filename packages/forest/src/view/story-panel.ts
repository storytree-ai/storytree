/**
 * Capability 4 · Drill-down. The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It explains the story in plain words, and below them shows the one capability picked on the island, with its health as
 * the agent reports it and its contracts on request (ADR-0659). The island draws the capability tree, so the panel draws
 * none (ADR-1285). Every word from the library is written as text, never as HTML.
 */
import type { CapabilityLine, StoryPanel, WhyLine } from "@storytree/forest";
import type { HealthSource, HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };

/**
 * The panel's HTML, with `selected`, the capability picked on the island, shown below the story's sentences if it is one
 * of the story's capabilities. With the capability details switched off (ADR-0750) it is the story's sentences alone. A
 * `gate` picked on the map, the pair of capabilities it joins, shows the contracts of the edges between them in its place
 * (ADR-1282 D1).
 */
// Its head, on show exactly while the panel is, names the panel as the Story panel's canvas (Surface feedback).
export function renderStoryPanel(panel: StoryPanel, selected: string | undefined, { details = true, gate }: { details?: boolean; gate?: readonly [string, string] | undefined } = {}): string {
  const shown = details && gate === undefined ? panel.capabilities.find(({ id }) => id === selected) : undefined;
  return `
    <header class="panel-head" data-surface-id="story-panel" data-surface-layer="panel">
      <h2>${text(panel.title)}</h2>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    <p class="panel-sentences">${text(panel.description)}</p>
    ${panel.checks === undefined ? "" : extraChecks(panel.checks)}
    ${panel.mapped === undefined ? "" : mapped(panel.mapped)}
    ${shown === undefined ? "" : capability(shown)}
    ${gate === undefined ? "" : gateLinks(panel, gate)}`;
}

/**
 * A picked gate: the edges joining its two capabilities, whichever depends on which, each saying so and listing its own
 * contracts; one with none says so, never listing either capability's own (ADR-1282 D1).
 */
function gateLinks(panel: StoryPanel, [one, other]: readonly [string, string]): string {
  const links = (panel.edges ?? []).filter(({ from, to }) => (from === one && to === other) || (from === other && to === one));
  return `
    <section class="panel-gate" aria-label="Gate">
      ${links.length === 0 ? `<p class="panel-muted">No link joins these two capabilities directly.</p>` : links
        .map(({ fromTitle, toTitle, contracts }) => `
          <h3>${text(fromTitle)} depends on ${text(toTitle)}.</h3>
          ${contracts.length === 0
            ? `<p class="panel-muted">No contracts on this link yet.</p>`
            : `<ul class="panel-contracts">${contracts.map(({ id, title }) => `<li data-contract-id="${attribute(id)}">${text(title)}</li>`).join("")}</ul>`}`)
        .join("")}
    </section>`;
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
  return `
    <section class="panel-checks" aria-label="Extra checks">
      <span class="panel-checks-label">Extra checks</span>
      <ul>${checks
        .map(({ check, trigger, capability }) => `<li>${text(check)}${capability === undefined ? "" : ` <span class="panel-muted">(${text(capability)})</span>`}, ${TRIGGER[trigger]}</li>`)
        .join("")}</ul>
    </section>`;
}

function capability(line: CapabilityLine): string {
  const contracts = line.contracts.length === 0
    ? `<p class="panel-muted">No contracts yet.</p>`
    : `<ul class="panel-contracts">${line.contracts
        .map(
          (contract) => `
            <li data-contract-id="${attribute(contract.id)}">
              <span>${text(contract.title)}</span>
              <span class="panel-health">
                ${badge("the agent reports", contract.reported)}
                <span class="panel-trail">${text(contract.trail)}</span>
                ${contract.verified === undefined ? "" : badge("storytree saw", contract.verified, contract.source === undefined ? undefined : [contract.source])}
                ${contract.lastSeen === undefined ? "" : `<span class="panel-last-seen">last seen ${contract.lastSeen.state === "passing" ? "passing" : "failing"} ${day(contract.lastSeen.at)}, not re-run since</span>`}
              </span>
            </li>`,
        )
        .join("")}</ul>`;
  return `
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      <h3>${text(line.title)} <span class="panel-state status-${line.status}">${line.reportOnly ? `the agent reports ${HEALTH[line.reported]}` : line.status}</span></h3>
      ${line.why === undefined ? "" : why(line.why)}
      ${line.reportOnly ? `<p class="panel-why report-only">${text(NOT_VERIFIED)}.</p>` : ""}
      ${line.parkedOn === undefined ? "" : parked(line.parkedOn)}
      ${line.openWork === undefined ? "" : openWork(line.openWork)}
      <p>${text(line.description)}</p>
      <p class="panel-health">
        ${badge("the agent reports", line.reported)}
        ${line.verified === undefined ? "" : badge("storytree saw", line.verified, line.sources)}
      </p>
      <details><summary>${line.contracts.length} contract${line.contracts.length === 1 ? "" : "s"}</summary>${contracts}</details>
    </section>`;
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
  return `
      <section class="panel-open-work" aria-label="Open work">
        <span class="panel-open-work-label">Open work</span>
        <ol>${increments
          .map(({ increment, title, active }) => `<li data-increment-id="${attribute(increment)}"${active ? ` class="active"` : ""}>${text(title)}${active ? ` <span class="panel-muted">(in progress)</span>` : ""}</li>`)
          .join("")}</ol>
      </section>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time as the day it fell on, in UTC so every reader sees the same: "27 Sep". */
function day(at: string): string {
  const when = new Date(at);
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}

function badge(who: string, state: HealthState, sources?: readonly HealthSource[]): string {
  return `<span class="panel-badge badge-${state}">${text(who)}: ${HEALTH[state]}${sources === undefined || sources.length === 0 ? "" : `, ${FROM[sourceKey(sources)]}`}</span>`;
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
