import type { SetupHelpBridge } from "../help/bridge.js";
import { draftSaid, feedbackText } from "../help/feedback.js";
import { guideOffered, rememberGuideDismissed } from "./first-run.js";
import { guide, recoveryRequest } from "./guide.js";

/** A single help surface survives empty/error states and project switching in the thin frame. */
export function mountSetupHelp(host: HTMLElement, bridge: SetupHelpBridge, options: { returnFocus?: HTMLElement; embedded?: boolean; onOpen?: () => void } = {}): { open(): void; close(): void; stop(): void } {
  const entry = options.embedded ? null : document.createElement("div");
  if (entry) {
    entry.className = "setup-help";
    entry.innerHTML = `<button type="button" aria-controls="setup-help-panel" aria-expanded="false">Help</button>`;
    host.append(entry);
  }
  const launch = entry?.querySelector("button");
  const panel = document.createElement("section");
  panel.id = "setup-help-panel";
  panel.className = `setup-help setup-help-panel${options.embedded ? " setup-help-embedded" : ""}`;
  if (!options.embedded) panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "setup-help-title");
  panel.hidden = true;
  panel.innerHTML = `
    <header><h2 id="setup-help-title" tabindex="-1">Help with storytree</h2>${options.embedded ? "" : '<button type="button" data-close-help aria-label="Close help">Close</button>'}</header>
    <nav class="setup-help-nav" aria-label="Help pages">
      <button type="button" data-page="guide" aria-pressed="true">First-run guide</button>
      <button type="button" data-page="license" aria-pressed="false">License</button>
      <button type="button" data-page="feedback" aria-pressed="false">Send feedback</button>
    </nav>
    <div data-content="guide"><div class="setup-help-agents" data-agents role="status" hidden></div>${guide}
      <div class="setup-help-actions"><button type="button" data-check>Check a folder…</button><button type="button" data-recover>Copy request for your agent</button></div>
      <p data-check-status role="status"></p>
      <div class="setup-help-diagnostics" data-diagnostics hidden></div>
      <details><summary>Request to paste into your agent</summary><p data-request></p></details>
      <p>Need help or have a suggestion? Use <button type="button" data-feedback>Send feedback</button> to prepare a GitHub issue.</p>
    </div>
    <div data-content="license" hidden><h3>PolyForm Shield 1.0.0</h3>
      <p>This copy travels with the app and is available offline.</p>
      <p data-license-status role="status"></p><button type="button" data-license-retry hidden>Retry reading license</button>
      <pre data-license></pre>
    </div>
    <div data-content="feedback" hidden><h3>Prepare a GitHub issue</h3>
      <p>Review your message here, then open a draft on storytree-ai/storytree. You need a GitHub account to submit a public issue. Include only what you want to share.</p>
      <p>Only the title and message you write are included. Project contents, paths, transcripts and logs are never attached automatically.</p>
      <form data-feedback-form>
        <label>Title<input name="title" required autocomplete="off"></label>
        <label>Message<textarea name="body" required></textarea></label>
        <div class="setup-help-actions"><button type="submit">Open GitHub draft</button><button type="button" data-copy-feedback>Copy prepared text</button></div>
      </form>
      <p data-feedback-status role="status"></p>
    </div>`;
  (options.embedded ? host : document.body).append(panel);
  let stopped = false;
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const checkStatus = get("[data-check-status]");
  const licenseStatus = get("[data-license-status]");
  const feedbackStatus = get("[data-feedback-status]");
  const say = (node: HTMLElement, text: string, failed = false) => {
    node.textContent = text;
    node.setAttribute("role", failed ? "alert" : "status");
  };
  function page(name: string): void {
    for (const node of panel.querySelectorAll<HTMLElement>("[data-content]")) node.hidden = node.dataset.content !== name;
    for (const node of panel.querySelectorAll<HTMLElement>("[data-page]")) node.setAttribute("aria-pressed", String(node.dataset.page === name));
    panel.scrollTop = 0;
    if (name === "license") void license();
    if (name === "guide") void agents();
  }
  /** Each connected agent still waiting on a step from the user, or past it, read afresh whenever the guide shows. */
  async function agents(): Promise<void> {
    const box = get("[data-agents]");
    let connections: Awaited<ReturnType<SetupHelpBridge["agentConnections"]>> = [];
    try { connections = await bridge.agentConnections(); } catch { /* The guide stands without it. */ }
    box.replaceChildren(...connections.map((connection) => {
      const item = document.createElement("p");
      item.className = `setup-help-agent setup-help-agent-${connection.state}`;
      const name = document.createElement("strong");
      name.textContent = `${connection.agent}: `;
      item.append(name, connection.message);
      if (connection.step) { const step = document.createElement("span"); step.className = "setup-help-agent-step"; step.textContent = connection.step; item.append(" ", step); }
      return item;
    }));
    box.hidden = connections.length === 0;
  }
  async function license(): Promise<void> {
    const retry = get<HTMLButtonElement>("[data-license-retry]");
    retry.hidden = true;
    get("[data-license]").textContent = "";
    say(licenseStatus, "Reading the shipped license…");
    try {
      get("[data-license]").textContent = await bridge.readSetupLicense();
      say(licenseStatus, "");
    } catch {
      say(licenseStatus, "The shipped license could not be read. Try again or report the problem using Send feedback.", true);
      retry.hidden = false;
    }
  }
  async function copy(text: string, status: HTMLElement): Promise<void> {
    try { await bridge.copyHelpText(text); say(status, "Copied. Paste the text where you want to use it."); }
    catch { say(status, "Could not copy. Select and copy the text shown here, or try again.", true); }
  }
  const form = get<HTMLFormElement>("[data-feedback-form]");
  const submit = get<HTMLButtonElement>("[type=submit]");
  const draft = () => ({ title: get<HTMLInputElement>("[name=title]").value, body: get<HTMLTextAreaElement>("[name=body]").value });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    say(feedbackStatus, "Opening your draft…");
    void (async () => {
      try {
        const result = await bridge.openFeedbackDraft(draft());
        const opened = result.status === "opened";
        say(feedbackStatus, draftSaid(result), !opened);
        submit.textContent = opened ? "Open GitHub draft" : "Retry opening draft";
      } catch {
        say(feedbackStatus, "The draft could not be opened. Check the title and message, then retry or copy your prepared text.", true);
        submit.textContent = "Retry opening draft";
      } finally { submit.disabled = false; }
    })();
  });
  form.addEventListener("input", () => {
    if (!submit.disabled) { say(feedbackStatus, ""); submit.textContent = "Open GitHub draft"; }
  });
  get("[data-copy-feedback]").addEventListener("click", () => { void copy(feedbackText(draft()), feedbackStatus); });
  get("[data-request]").textContent = recoveryRequest;
  get("[data-recover]").addEventListener("click", () => { void copy(recoveryRequest, checkStatus); });
  get("[data-check]").addEventListener("click", () => {
    const button = get<HTMLButtonElement>("[data-check]");
    button.disabled = true;
    say(checkStatus, "Choose the project folder to check…");
    void (async () => {
      try {
        const lines = await bridge.checkSetupFolder();
        if (lines === null) { say(checkStatus, "Folder selection cancelled."); return; }
        const list = document.createElement("ul");
        for (const line of lines) {
          const item = document.createElement("li");
          const message = document.createElement("span");
          message.textContent = line.message;
          const state = document.createElement("small");
          state.textContent = `${line.check} · ${line.state}`;
          item.append(message, state);
          if (line.fix) { const fix = document.createElement("p"); fix.textContent = line.fix; item.append(fix); }
          list.append(item);
        }
        const diagnostics = get("[data-diagnostics]");
        diagnostics.replaceChildren(list); diagnostics.hidden = false;
        say(checkStatus, "Setup diagnostics are below. For skipped hook or command checks, copy the request for your agent. Only the agent session can finish hook verification.");
      } catch {
        say(checkStatus, "The setup check could not finish. Retry, or copy the request for your agent.", true);
      } finally { button.disabled = false; }
    })();
  });
  get("[data-license-retry]").addEventListener("click", () => { void license(); });
  for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-page]")) button.addEventListener("click", () => page(button.dataset.page!));
  get("[data-feedback]").addEventListener("click", () => { page("feedback"); get<HTMLInputElement>("[name=title]").focus(); });
  function open(): void {
    if (stopped || !panel.hidden) return;
    panel.hidden = false; launch?.setAttribute("aria-expanded", "true");
    void agents();
    get("#setup-help-title").focus();
  }
  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true; launch?.setAttribute("aria-expanded", "false");
    rememberGuideDismissed(() => localStorage);
    if (!options.embedded) (options.returnFocus ?? launch)?.focus();
  }
  function key(event: KeyboardEvent): void {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }
  }
  launch?.addEventListener("click", () => { if (panel.hidden) open(); else close(); });
  panel.querySelector("[data-close-help]")?.addEventListener("click", close);
  if (!options.embedded) document.addEventListener("keydown", key, true);
  if (guideOffered(() => localStorage)) {
    if (options.embedded) queueMicrotask(() => { if (!stopped) (options.onOpen ?? open)(); });
    else open();
  }
  return { open, close, stop() { stopped = true; document.removeEventListener("keydown", key, true); entry?.remove(); panel.remove(); } };
}
