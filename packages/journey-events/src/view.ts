/** Capability 3 · Sharing controls. */
import type { JourneyBridge, JourneyState } from "./bridge.js";

/** Story-owned surfaces; the app frame supplies only hosts and the local bridge. */
export function mountJourneySettings(host: HTMLElement, bridge: JourneyBridge) {
  return mount(host, bridge, false);
}
export function mountJourneyConsent(host: HTMLElement, bridge: JourneyBridge) {
  return mount(host, bridge, true);
}

function mount(host: HTMLElement, bridge: JourneyBridge, firstLaunch: boolean) {
  const doc = host.ownerDocument;
  const sheet = new doc.defaultView!.CSSStyleSheet();
  sheet.replaceSync(styles);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  const panel = doc.createElement("section");
  panel.className = `journey-panel${firstLaunch ? " journey-consent" : ""}`;
  panel.setAttribute("aria-label", firstLaunch ? "Choose journey sharing" : "Journey sharing");
  panel.hidden = true;
  panel.innerHTML = `<h2>${firstLaunch ? "Help improve storytree?" : "Journey sharing"}</h2>
    <p>Share a few milestones with PostHog in the US: installation, first launch, agent connected, hooks verified, first project, first landed increment, errors and app version.</p>
    <p>No code, conversations, prompts or file contents. Events use a random installation identifier.</p>
    <p data-journey-retention></p>
    <p class="journey-status" data-journey-status role="status" aria-live="polite">Reading sharing settings…</p>
    <div class="journey-actions"><button type="button" data-journey-off>${firstLaunch ? "No thanks" : "Turn off"}</button><button type="button" data-journey-on disabled>${firstLaunch ? "Share journey events" : "Turn on sharing"}</button></div>
    <p class="journey-note">You can change this anytime in the app menu → Sharing.</p>
    ${firstLaunch ? "" : '<div class="journey-delete"><h3>Delete previously shared events</h3><p>Prepare a request with your installation identifier. Turning sharing off also discards events waiting to send.</p><button type="button" data-journey-delete>Prepare deletion request</button><p data-journey-deletion role="status" hidden></p></div>'}
    <p class="journey-error" role="alert" hidden></p>`;
  host.append(panel);
  const on = panel.querySelector<HTMLButtonElement>("[data-journey-on]")!;
  const off = panel.querySelector<HTMLButtonElement>("[data-journey-off]")!;
  const deletion = panel.querySelector<HTMLButtonElement>("[data-journey-delete]");
  const status = panel.querySelector<HTMLElement>("[data-journey-status]")!;
  const error = panel.querySelector<HTMLElement>("[role=alert]")!;
  let state: JourneyState | undefined;
  let stopped = false;
  let opened = firstLaunch;
  let busy = false;
  let revision = 0;

  function render() {
    if (stopped) return;
    panel.hidden = !opened || (firstLaunch && state?.consent !== "pending");
    on.disabled = busy || state?.available !== true || state.consent === "on";
    off.disabled = busy || state === undefined;
    if (deletion !== null) deletion.disabled = busy || state === undefined;
    if (state === undefined) return;
    status.textContent = state.available
      ? state.consent === "on" ? "Sharing is on." : "Sharing is off. Nothing is sent without your choice."
      : "Live sharing is unavailable. Nothing will be sent until setup is complete.";
    panel.querySelector<HTMLElement>("[data-journey-retention]")!.textContent = state.retention === undefined ? "" : `Retention: ${state.retention}`;
  }
  async function refresh() {
    if (stopped || busy) return;
    const mine = ++revision;
    try {
      const next = await bridge.readJourney();
      if (stopped || revision !== mine) return;
      state = next;
      const previousRequest = panel.querySelector<HTMLElement>("[data-journey-deletion]");
      if (previousRequest !== null) previousRequest.hidden = true;
      error.hidden = true;
      render();
    } catch {
      if (stopped || revision !== mine) return;
      // A failed read never claims consent or prevents the app from being used.
      if (!firstLaunch) { panel.hidden = !opened; error.textContent = "Sharing settings could not be read. Reopen Sharing to retry."; error.hidden = false; }
    }
  }
  async function act(action: "on" | "off" | "delete") {
    if (busy || stopped || state === undefined || (action === "on" && !state.available)) return;
    busy = true; revision++; error.hidden = true; render();
    try {
      if (action === "delete") {
        const request = await bridge.prepareJourneyDeletion();
        state = await bridge.readJourney();
        if (stopped) return;
        const instructions = panel.querySelector<HTMLElement>("[data-journey-deletion]")!;
        instructions.textContent = request.contact === undefined
          ? `Sharing is off. Live sharing is unavailable and no deletion contact is configured. Your installation identifier: ${request.installId}. A deletion request has not been sent.`
          : `Sharing is off. To request deletion, contact ${request.contact} and include this installation identifier: ${request.installId}. Your request has not been sent, and remote deletion has not been confirmed.`;
        instructions.hidden = false;
      } else {
        state = await bridge.chooseJourney(action === "on");
        const previousRequest = panel.querySelector<HTMLElement>("[data-journey-deletion]");
        if (previousRequest !== null) previousRequest.hidden = true;
      }
      if (stopped) return;
      const EventType = doc.defaultView!.Event;
      doc.dispatchEvent(new EventType("storytree-journey-changed"));
    } catch {
      if (!stopped) { error.textContent = "Your sharing choice could not be saved. Please try again."; error.hidden = false; }
    } finally { busy = false; render(); }
  }
  on.addEventListener("click", () => { void act("on"); });
  off.addEventListener("click", () => { void act("off"); });
  deletion?.addEventListener("click", () => { void act("delete"); });
  const changed = () => { void refresh(); };
  doc.addEventListener("storytree-journey-changed", changed);
  if (firstLaunch) void refresh();
  return {
    open() { opened = true; render(); void refresh(); },
    close() { opened = false; render(); },
    stop() { stopped = true; revision++; doc.removeEventListener("storytree-journey-changed", changed); panel.remove(); doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(candidate => candidate !== sheet); },
  };
}

const styles = `
.journey-panel { max-width: 680px; color: #eceae3; font: 14px/1.55 "Segoe UI", system-ui, sans-serif; }
.journey-panel[hidden] { display: none; }
.journey-panel h2 { margin: 0 0 12px; font-size: 22px; font-weight: 600; }
.journey-panel h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.journey-panel p { margin: 0 0 14px; }
.journey-panel [data-journey-retention]:empty { display: none; }
.journey-panel .journey-status { padding: 12px 14px; border: 1px solid #485159; border-radius: 6px; background: #191e23; }
.journey-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.journey-panel button { border: 1px solid #64717d; border-radius: 6px; padding: 8px 14px; background: transparent; color: #eceae3; font: inherit; cursor: pointer; }
.journey-panel button:hover { background: #262a2f; }
.journey-panel button:disabled { cursor: default; color: #a9b0ba; opacity: .65; }
.journey-panel button:focus-visible { outline: 2px solid #a9b0ba; outline-offset: 3px; }
.journey-panel .journey-note { color: #a9b0ba; font-size: 13px; }
.journey-delete { border-top: 1px solid #485159; margin-top: 24px; padding-top: 24px; }
.journey-panel [data-journey-deletion] { margin-top: 16px; overflow-wrap: anywhere; }
.journey-panel .journey-error { color: #ffaaaa; }
.journey-consent { position: fixed; bottom: 24px; left: 24px; z-index: 8; box-sizing: border-box; width: min(480px, calc(100vw - 48px)); max-height: calc(100dvh - 120px); overflow: auto; padding: 24px; background: #101418; border: 1px solid #485159; border-radius: 12px; box-shadow: 0 8px 30px #0006; }
`;
