// Capability 4 · Drill-down
import type { AcceptanceState, CapabilityLine, CheckReading, ContractLine, EdgeLine, StoryPanel, WhyLine } from "@storytree/forest";
import type { HealthSource, HealthState } from "@storytree/library";
import { scopeSection } from "./microscope.js";

export function renderStoryPanel(panel: StoryPanel, selected: string | undefined, { details = true, gate, open }: { details?: boolean; gate?: readonly [string, string] | undefined; open?: readonly string[] | undefined } = {}): string {
  if (gate !== undefined) return `${head(panel.title)}${gateLinks(panel, gate, open)}`;
  const shown = details ? panel.capabilities.find(({ id }) => id === selected) : undefined;
  if (shown !== undefined) return `${head(shown.title, panel.title)}${panel.microscope === undefined ? "" : scopeSection(panel.microscope, shown.id, shown.id, "bare")}${capability(shown, panel.edges ?? [], panel.capabilities)}`;
  return `${head(panel.title)}
    ${panel.microscope === undefined || !details ? "" : scopeSection(panel.microscope, panel.story, panel.story, "bare")}
    ${description(panel.description, "panel-sentences")}
    ${panel.mapped === undefined ? "" : mapped(panel.mapped, panel.capabilities)}
    ${needsYou(panel.capabilities)}
    ${details ? names(panel.capabilities.filter(({ parent }) => parent === undefined)) : ""}
    ${panel.checks === undefined || panel.checks.length === 0 ? "" : extraChecks(panel.checks)}`;
}

function head(title: string, story?: string): string {
  return `
    <header class="panel-head" data-surface-id="story-panel" data-surface-layer="panel">
      <div class="panel-titles">${story === undefined ? "" : `<button type="button" class="panel-story-name" data-pick-story>${text(story)}</button>`}<h2>${text(title)}</h2></div>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>`;
}

function description(words: string, kind: string): string {
  const paragraphs = words.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph !== "");
  return `<div class="${kind}">${paragraphs.map((paragraph) => `<p>${text(paragraph)}</p>`).join("")}</div>`;
}

function names(capabilities: readonly CapabilityLine[]): string {
  if (capabilities.length === 0) return "";
  return `<ul class="panel-capabilities" aria-label="Capabilities">${capabilities
    .map(({ id, title, why }) => {
      const owner = why?.mover === "owner";
      const button = `<button type="button" class="panel-pick" data-pick-capability="${attribute(id)}">${text(title)}</button>`;
      return owner ? `<li class="needs-you">${button} <span class="panel-needs-you-mark">needs you</span></li>` : `<li>${button}</li>`;
    })
    .join("")}</ul>`;
}

function fold(kind: string, handle: string, inside: string): string {
  return `<div class="panel-fold" data-fold="${kind}"><button type="button" class="panel-handle" aria-expanded="false">${handle}</button><div class="panel-fold-body" hidden>${inside}</div></div>`;
}

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

function failing(contracts: readonly ContractLine[]): string {
  const count = contracts.filter(({ gear }) => gear?.state === "failing").length;
  return count === 0 ? "" : `<span class="panel-link-failing">${count} failing</span>`;
}

function mapped({ files, lines }: NonNullable<StoryPanel["mapped"]>, capabilities: readonly CapabilityLine[]): string {
  const counts = files === undefined || lines === undefined ? "" : ` ${files.toLocaleString("en-GB")} file${files === 1 ? "" : "s"}, ${lines.toLocaleString("en-GB")} line${lines === 1 ? "" : "s"}.`;
  const read = capabilities.some(({ contracts }) => contracts.some(({ gear, acceptance }) => (gear !== undefined && gear.state !== "not-checked") || (acceptance !== undefined && acceptance !== "not-run")));
  return `<p class="panel-mapped"><strong>Imported:</strong> here before storytree${read ? "." : ", and assumed to be working."}${counts}</p>`;
}

type ExtraCheck = NonNullable<StoryPanel["checks"]>[number];

const TRIGGER: Readonly<Record<ExtraCheck["trigger"], string>> = { change: "on every change", release: "before each formal release" };

function extraChecks(checks: readonly ExtraCheck[]): string {
  return fold("extra-checks", `Extra checks · ${checks.length}`, `<ul class="panel-checks">${checks
    .map(({ check, trigger, capability }) => `<li>${text(check)}${capability === undefined ? "" : ` <span class="panel-muted">(${text(capability)})</span>`}, ${TRIGGER[trigger]}</li>`)
    .join("")}</ul>`);
}

function contracts(line: CapabilityLine, edges: readonly EdgeLine[]): string {
  if (line.contracts.length > 0) return `<h3 class="panel-subhead">Contracts</h3>${contractList(line.contracts)}`;
  const links = edges.filter(({ from, to, contracts: carried }) => (from === line.id || to === line.id) && carried.length > 0);
  if (links.length === 0) return `<p class="panel-muted">No contracts yet.</p>`;
  const where = links.map(({ from, fromTitle, toTitle, contracts: carried }) => {
    const numbers = carried.flatMap(({ title }) => /^(\d+\.\d+) · /.exec(title)?.[1] ?? []);
    return `${carried.length} on its link ${from === line.id ? `to ${toTitle}` : `from ${fromTitle}`}${numbers.length === 0 ? "" : ` (${numbers.join(", ")})`}`;
  });
  return `<p class="panel-muted panel-on-links">${text(`No contracts on this part; ${listed(where)}, ${states(links.flatMap(({ contracts: carried }) => carried))}.`)}</p>`;
}

function listed(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function states(contracts: readonly ContractLine[]): string {
  const counts = new Map<string, number>();
  for (const contract of contracts) counts.set(stateWords(contract), (counts.get(stateWords(contract)) ?? 0) + 1);
  if (counts.size > 1) return listed([...counts].map(([words, count]) => `${count} ${words}`));
  const [words = ""] = counts.keys();
  return contracts.length === 1 ? words : contracts.length === 2 ? `both ${words}` : `all ${contracts.length} ${words}`;
}

function stateWords({ gear, acceptance }: ContractLine): string {
  if (gear !== undefined && gear.state !== "not-checked") return `verified ${gear.state}`;
  if (gear === undefined && acceptance !== undefined && acceptance !== "not-run") return `${acceptance} acceptance testing`;
  return "not run yet";
}

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

const ICONS: Readonly<Record<"gear" | "robot", string>> = {
  gear: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 1h2l.4 2 1.3.6 1.7-1.2 1.4 1.4-1.2 1.7.6 1.3 2 .4v2l-2 .4-.6 1.3 1.2 1.7-1.4 1.4-1.7-1.2-1.3.6-.4 2H7l-.4-2-1.3-.6-1.7 1.2-1.4-1.4 1.2-1.7-.6-1.3-2-.4V7l2-.4.6-1.3-1.2-1.7 1.4-1.4 1.7 1.2 1.3-.6zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>`,
  robot: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.25 1h1.5v2H12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.25zM5.5 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM5.5 10.5v1h5v-1zM0 6h1.5v4H0zm14.5 0H16v4h-1.5z"/></svg>`,
};

function mark(kind: "gear" | "robot", state: HealthState, words: string): string {
  return `<span class="panel-mark mark-${kind} state-${state}" data-mark="${kind}" data-state="${state}" role="img" aria-label="${attribute(words)}">${ICONS[kind]}</span>`;
}

function run({ state, source, at }: CheckReading): string {
  if (state === "not-checked") return "storytree's run: not run yet";
  return `storytree's run: ${state === "passing" ? "passes" : "fails"}${source === undefined ? "" : `, ${FROM[source]}`}${at === undefined ? "" : `, ${day(at)}`}`;
}

function capability(line: CapabilityLine, edges: readonly EdgeLine[], all: readonly CapabilityLine[]): string {
  return `
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      ${line.reportOnly ? "" : lead(line)}
      ${line.reportOnly ? `<p class="panel-why report-only">${text(NOT_VERIFIED)}.</p>` : ""}
      ${line.parkedOn === undefined ? "" : parked(line.parkedOn)}
      ${description(line.description, "panel-lead")}
      ${names(all.filter(({ parent }) => parent === line.id))}
      ${line.openWork === undefined || line.openWork.length === 0 ? "" : openWork(line.openWork)}
      ${contracts(line, edges)}
    </section>`;
}

function mattersWhy(status: CapabilityLine["status"], { mover }: WhyLine): boolean {
  return status === "unhealthy" || status === "untested" || mover === "owner";
}

function needsYou(capabilities: readonly CapabilityLine[]): string {
  const count = capabilities.filter(({ why: reason }) => reason?.mover === "owner").length;
  if (count === 0) return "";
  return `<p class="panel-needs-you">${count} ${count === 1 ? "capability needs" : "capabilities need"} you</p>`;
}

const NOT_VERIFIED = "storytree does not check this project's tests yet";

function counted(carrying: number, of: number): string {
  return `${carrying} of ${of} contract${of === 1 ? "" : "s"}`;
}

const REASON: Readonly<Record<WhyLine["reason"], (carrying: number, of: number) => string>> = {
  "not built": () => "it is not built yet",
  failing: (carrying, of) => (carrying === 0 ? "it is failing" : `${counted(carrying, of)} ${carrying === 1 ? "fails" : "fail"}`),
  "not re-run": (carrying, of) => `${counted(carrying, of)} ${carrying === 1 ? "was" : "were"} not re-run`,
  "no test names it": (carrying, of) => (carrying === 0 ? "no test names it" : `no test names ${counted(carrying, of)}`),
  "no live reading": (carrying, of) => `observability as proof has no live reading of ${counted(carrying, of)} yet`,
  "acceptance test not run": (carrying, of) => `agentic user acceptance testing has not run on ${counted(carrying, of)}`,
  "out of CI's reach": (carrying, of) => `${counted(carrying, of)} can only run on another platform`,
  "needs owner": (carrying, of) => `${counted(carrying, of)} ${carrying === 1 ? "needs" : "need"} something only you can give`,
};

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

function gearSources(contracts: readonly ContractLine[]): { sources?: HealthSource[] } {
  const said = (["local", "ci"] as const).filter((source) => contracts.some(({ gear }) => gear?.source === source));
  return said.length === 0 ? {} : { sources: [...said] };
}

function moves(work: CapabilityLine["openWork"]): string {
  const next = work?.[0];
  if (next === undefined) return "No open work moves it yet.";
  if (next.waits !== undefined && next.waits.length > 0) return `${next.title} moves it; it waits on ${and(next.waits.map(waitSaid))}.`;
  return `${next.title} moves it; ${next.active ? "it is under way" : "it is ready to take"}.`;
}

function waitSaid(wait: NonNullable<NonNullable<CapabilityLine["openWork"]>[number]["waits"]>[number]): string {
  switch (wait.kind) {
    case "work": return `${wait.title}${wait.state === "active" ? ", which is under way" : wait.state === "ready" ? ", which is ready to take" : ""}`;
    case "claim": return `another session's claim on ${wait.title}`;
    case "question": return "your answer to a question";
    case "owner": return `you: ${wait.note}`;
    case "event": return `an outside event: ${wait.note}`;
  }
}

function and(phrases: readonly string[]): string {
  if (phrases.length < 2) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")}${phrases.some((phrase) => phrase.includes(",")) ? ", and" : " and"} ${phrases.at(-1)}`;
}

function parked(arcs: NonNullable<CapabilityLine["parkedOn"]>): string {
  const titles = arcs.map(({ title }) => title);
  const named = titles.length < 2 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  return `<p class="panel-parked">Parked on ${text(named)}: shelved on purpose.</p>`;
}

function openWork(increments: NonNullable<CapabilityLine["openWork"]>): string {
  return fold("open-work", `Open work · ${increments.length}`, `<ol class="panel-open-work">${increments
    .map(({ increment, title, active }) => `<li data-increment-id="${attribute(increment)}"${active ? ` class="active"` : ""}><button type="button" class="panel-open-increment" data-open-increment="${attribute(increment)}">${text(title)}${active ? ` <span class="panel-muted">(in progress)</span>` : ""}</button></li>`)
    .join("")}</ol>`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(at: string): string {
  const when = new Date(at);
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}

const TESTS_NAMED = 3;

function testedBy(tests: readonly string[]): string {
  const more = tests.length - TESTS_NAMED;
  return `<span class="panel-tests">tested by ${text(tests.slice(0, TESTS_NAMED).join("; "))}${more > 0 ? ` and ${more} more` : ""}</span>`;
}

function trail(words: string): string {
  return words === "not reported yet" ? "the agent has not reported it yet" : `the agent reported it ${words}`;
}

const ACCEPTANCE: Readonly<Record<AcceptanceState, { words: string; state: HealthState }>> = {
  passed: { words: "passed", state: "passing" },
  failed: { words: "failed", state: "failing" },
  "not-run": { words: "not run yet", state: "not-checked" },
};

function accepted(state: AcceptanceState): string {
  return `agentic user acceptance testing: ${ACCEPTANCE[state].words}`;
}

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
