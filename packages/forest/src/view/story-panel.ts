/**
 * Capability 4 · Drill-down. The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It leads with the story's lead, and below it shows the one capability picked on the island, its word saying where it came
 * from and a why line only when that needs the user (ADR-1284 D2, D3). Everything else waits in a fold behind a handle saying what is inside and how much, which a
 * single click opens (ADR-1287, narrowing ADR-1284 D1; ./panel-folds.ts works them). The island draws the capability tree, so the panel draws
 * none (ADR-1285). Every word from the library is written as text, never as HTML.
 */
import type { CapabilityLine, ContractLine, StoryPanel, WhyLine } from "@storytree/forest";
import type { HealthSource, HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };

/**
 * The panel's HTML, with `selected`, the capability picked on the island, shown below the story's lead if it is one of
 * the story's capabilities. Every fold is drawn closed, with nothing to open them all (ADR-1292); the page's folds open
 * the kinds the user keeps open. With the capability details switched off (ADR-0750) it is the story alone. A
 * `gate` picked on the map, the pair of capabilities it joins, shows the edges between them in its place (ADR-1282 D1),
 * each in one state line (ADR-1284 D4); `open` holds the contracts the arc opened in the Arcs tab links in its open work.
 */
// Its head, on show exactly while the panel is, names the panel as the Story panel's canvas (Surface feedback).
export function renderStoryPanel(panel: StoryPanel, selected: string | undefined, { details = true, gate, open }: { details?: boolean; gate?: readonly [string, string] | undefined; open?: readonly string[] | undefined } = {}): string {
  const shown = details && gate === undefined ? panel.capabilities.find(({ id }) => id === selected) : undefined;
  const [lead, rest] = paragraphs(panel.description);
  const body = `
    <p class="panel-sentences">${text(lead)}</p>
    ${panel.mapped === undefined ? "" : mapped(panel.mapped)}
    ${needsYou(panel.capabilities)}
    ${more(rest)}
    ${panel.checks === undefined || panel.checks.length === 0 ? "" : extraChecks(panel.checks)}
    ${shown === undefined ? "" : capability(shown)}
    ${gate === undefined ? "" : gateLinks(panel, gate, open)}`;
  return `
    <header class="panel-head" data-surface-id="story-panel" data-surface-layer="panel">
      <h2>${text(panel.title)}</h2>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>${body}`;
}

/** One block of detail behind its handle, closed until the user opens it (ADR-1284 D1); `handle` is already text. */
function fold(kind: string, handle: string, inside: string): string {
  return `<div class="panel-fold" data-fold="${kind}"><button type="button" class="panel-handle" aria-expanded="false">${handle}</button><div class="panel-fold-body" hidden>${inside}</div></div>`;
}

/** A description's lead, its first paragraph, and the rest, every later one (ADR-1284 D5). */
function paragraphs(description: string): [string, string[]] {
  const [lead = "", ...rest] = description.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph !== "");
  return [lead, rest];
}

/** The rest of a description behind a bare "How it works", no count (ADR-1291); with no rest, no handle. */
function more(rest: readonly string[]): string {
  if (rest.length === 0) return "";
  return fold("more", "How it works", rest.map((paragraph) => `<p>${text(paragraph)}</p>`).join(""));
}

/**
 * A picked gate: the edges joining its two capabilities, whichever depends on which, each saying so and then its state in
 * one line: its own contracts behind "Contracts · n", each opening as a capability's does, never either capability's
 * (ADR-1282 D1), and "open work on this link" when the opened arc's open work links one of them, the reason the gate is
 * ringed; one with none says so, with no handle (ADR-1284 D4). After the handle, how many of them storytree last saw
 * failing, when any are.
 */
function gateLinks(panel: StoryPanel, [one, other]: readonly [string, string], open: readonly string[] | undefined): string {
  const links = (panel.edges ?? []).filter(({ from, to }) => (from === one && to === other) || (from === other && to === one));
  return `
    <section class="panel-gate" aria-label="Gate">
      ${links.length === 0 ? `<p class="panel-muted">No link joins these two capabilities directly.</p>` : links
        .map(({ fromTitle, toTitle, contracts }) => `
          <h3>${text(fromTitle)} depends on ${text(toTitle)}.</h3>
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

/** A capability's contracts behind "Contracts · n". */
function contracts(line: CapabilityLine): string {
  if (line.contracts.length === 0) return `<p class="panel-muted">No contracts yet.</p>`;
  return fold("contracts", `Contracts · ${line.contracts.length}`, contractList(line.contracts));
}

/** Contracts, a capability's or a link's alike, each by its title, opening one level deeper to its health and trail. */
function contractList(contracts: readonly ContractLine[]): string {
  return `<ul class="panel-contracts">${contracts
    .map((contract) => `
      <li data-contract-id="${attribute(contract.id)}">${fold("contract", text(contract.title), `
        <span class="panel-health">
          ${badge("the agent reports", contract.reported)}
          <span class="panel-trail">${text(contract.trail)}</span>
          ${contract.verified === undefined ? "" : badge("storytree saw", contract.verified, contract.source === undefined ? undefined : [contract.source])}
          ${contract.lastSeen === undefined ? "" : `<span class="panel-last-seen">last seen ${contract.lastSeen.state === "passing" ? "passing" : "failing"} ${day(contract.lastSeen.at)}, not re-run since</span>`}
        </span>`)}</li>`)
    .join("")}</ul>`;
}

function capability(line: CapabilityLine): string {
  const [lead, rest] = paragraphs(line.description);
  return `
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      <h3>${text(line.title)} <span class="panel-state status-${line.status}">${line.reportOnly ? `the agent reports ${HEALTH[line.reported]}` : word(line)}</span></h3>
      ${line.why === undefined || !mattersWhy(line.status, line.why) ? "" : why(line.why)}
      ${line.reportOnly ? `<p class="panel-why report-only">${text(NOT_VERIFIED)}.</p>` : ""}
      ${line.parkedOn === undefined ? "" : parked(line.parkedOn)}
      <p class="panel-lead">${text(lead)}</p>
      ${more(rest)}
      ${health(line)}
      ${line.openWork === undefined || line.openWork.length === 0 ? "" : openWork(line.openWork)}
      ${contracts(line)}
    </section>`;
}

/** Its word with where it came from (ADR-1284 D3): "healthy, from CI"; with no source recorded, or proposed, the word alone. */
function word({ status, sources }: CapabilityLine): string {
  return status === "proposed" || sources === undefined || sources.length === 0 ? status : `${status}, ${FROM[sourceKey(sources)]}`;
}

/** The why line matters only when it is unhealthy or untested, or the owner moves it: "not built yet" on a proposed one is no news. */
function mattersWhy(status: CapabilityLine["status"], { mover }: WhyLine): boolean {
  return status === "unhealthy" || status === "untested" || mover === "owner";
}

/** The agent's report and storytree's, side by side behind Health, each with its source (ADR-1284 D3). */
function health(line: CapabilityLine): string {
  const readings = [badge("the agent reports", line.reported), ...(line.verified === undefined ? [] : [badge("storytree saw", line.verified, line.sources)])];
  return fold("health", `Health · ${readings.length}`, `<p class="panel-health">${readings.join(" ")}</p>`);
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
