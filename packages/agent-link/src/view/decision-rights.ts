/// <reference lib="dom" />
import { decisionRights } from "../instructions/habits.js";
import { decisionRightsStyles } from "./styles.js";

/**
 * Who decides what, shown (capability 7, contract 7.6; ADR-0842 D4): the split the habits card
 * hands every agent, rendered from the same lines the card is built from so the two never
 * disagree, and the project's standing delegations when its library defines them. Read-only
 * (ADR-0842 D3): nothing on it is a control.
 */
export function renderDecisionRights({ delegations }: { readonly delegations?: string | undefined }): string {
  const split = decisionRights();
  const group = (title: string, lines: readonly string[]) =>
    `<section class="decision-rights-group"><h4>${title}</h4><ul>${lines.map((line) => `<li>${escape(capitalised(line))}</li>`).join("")}</ul></section>`;
  const register = delegations === undefined ? "" : `<section class="decision-rights-register" data-delegations aria-labelledby="decision-rights-register-title">
      <h4 id="decision-rights-register-title">This project’s standing delegations</h4>
      <p class="decision-rights-source">From the definition “Standing delegation” in its library.</p>
      <p class="decision-rights-text">${escape(delegations)}</p>
    </section>`;
  return `<section class="decision-rights" aria-labelledby="decision-rights-title">
    <h3 id="decision-rights-title">Who decides what</h3>
    <p class="decision-rights-lead">What every agent is told at the start of a session, on storytree’s habits card. Shown, not set.</p>
    <p class="decision-rights-override">${escape(split.override)}</p>
    <div class="decision-rights-groups">
      ${group("Agents decide, and record", split.decides)}
      ${group("Agents ask the owner before", split.asks)}
      ${group("No file moves these", split.honesty)}
    </div>
    <p class="decision-rights-delegations">${escape(split.delegations)}</p>
    ${register}
  </section>`;
}

/**
 * Mounts the view in `host`, hidden until opened; each opening reads the project's register
 * afresh. A failed or absent read still shows the split, which needs no project.
 */
export function mountDecisionRights(host: HTMLElement, readDelegations: () => Promise<string | undefined>) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(decisionRightsStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const panel = document.createElement("div");
  panel.className = "decision-rights-panel";
  panel.hidden = true;
  panel.innerHTML = renderDecisionRights({});
  host.append(panel);
  let generation = 0;
  return {
    open(): void {
      panel.hidden = false;
      const mine = ++generation;
      void readDelegations().then(
        (delegations) => { if (mine === generation) panel.innerHTML = renderDecisionRights({ delegations }); },
        () => { if (mine === generation) panel.innerHTML = renderDecisionRights({}); },
      );
    },
    close(): void { generation++; panel.hidden = true; },
    stop(): void {
      generation++;
      panel.remove();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
    },
  };
}

function capitalised(text: string): string { return text.charAt(0).toUpperCase() + text.slice(1); }

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
