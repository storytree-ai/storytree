/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { SettingsBridge } from "../settings/bridge.js";
import { renderSettings } from "./render.js";
import { settingsStyles } from "./styles.js";

export { SETTINGS_CHANNELS, type SettingsBridge } from "../settings/bridge.js";

/** Capability 10 owns its panel; the app surface only mounts it and supplies the desktop bridge. */
export function mountSettings(host: HTMLElement, bridge: SettingsBridge, options: { returnFocus: HTMLElement; embedded?: boolean }) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(settingsStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const launch = options.embedded ? null : document.createElement("button");
  if (launch) {
    launch.type = "button";
    launch.textContent = "Settings";
    launch.setAttribute("aria-haspopup", "dialog");
    launch.setAttribute("aria-controls", "settings-panel");
    host.append(launch);
  }
  const dialog = options.embedded ? null : document.createElement("dialog");
  const panel = dialog ?? document.createElement("section");
  panel.id = "settings-panel";
  panel.className = `settings-panel${options.embedded ? " settings-panel-embedded" : ""}`;
  panel.setAttribute("aria-labelledby", "settings-title");
  panel.hidden = !!options.embedded;
  panel.innerHTML = `<header><div><h2 id="settings-title" tabindex="-1">Settings</h2><p>Yours on this computer · all projects</p></div>${options.embedded ? "" : '<button type="button" data-close aria-label="Close settings">Close</button>'}</header>
    <p data-loading role="status">Reading settings…</p><p data-read-error role="alert" hidden></p><button type="button" data-retry hidden>Retry</button><div data-settings></div>`;
  (options.embedded ? host : document.body).append(panel);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const rows = get("[data-settings]");
  let generation = 0;
  let stopped = false;
  function close(): void {
    generation++;
    if (dialog) dialog.close();
    else panel.hidden = true;
  }
  dialog?.addEventListener("close", () => options.returnFocus.focus());
  dialog?.addEventListener("cancel", () => { generation++; });
  dialog?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
      .filter((node) => node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === get("#settings-title"))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });
  panel.querySelector("[data-close]")?.addEventListener("click", close);
  async function read(): Promise<void> {
    const mine = ++generation;
    rows.replaceChildren();
    get("[data-loading]").hidden = false;
    get("[data-read-error]").hidden = true;
    get("[data-retry]").hidden = true;
    try {
      const result = await bridge.readSettings();
      if (stopped || mine !== generation) return;
      if (!result.ok) throw new Error(result.error);
      rows.innerHTML = renderSettings(result.value);
      for (const form of rows.querySelectorAll<HTMLFormElement>("form")) bind(form);
    } catch (error) {
      if (stopped || mine !== generation) return;
      get("[data-read-error]").textContent = message(error);
      get("[data-read-error]").hidden = false;
      get("[data-retry]").hidden = false;
    } finally { if (!stopped && mine === generation) get("[data-loading]").hidden = true; }
  }
  function bind(form: HTMLFormElement): void {
    const value = form.elements.namedItem("value") as HTMLInputElement | HTMLSelectElement;
    const save = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const error = form.querySelector<HTMLElement>(".settings-error")!;
    const status = form.querySelector<HTMLElement>(".settings-saved")!;
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")];
    let pending = false;
    const edited = () => {
      if (pending) return;
      save.disabled = false;
      error.textContent = "";
      status.textContent = "";
      value.removeAttribute("aria-invalid");
      const cloud = form.querySelector<HTMLElement>(".settings-cloud");
      if (cloud) cloud.hidden = value.value !== "cloudsql";
    };
    form.addEventListener("input", edited);
    form.addEventListener("change", edited);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (pending || save.disabled) return;
      pending = true;
      const mine = generation;
      controls.forEach((control) => { control.disabled = true; });
      error.textContent = "";
      status.textContent = "Saving…";
      const name = form.dataset.setting!;
      const words = [value.value];
      if (name === "library" && value.value === "cloudsql") {
        words.push((form.elements.namedItem("instance") as HTMLInputElement).value, (form.elements.namedItem("user") as HTMLInputElement).value);
      }
      void (async () => {
        try {
          const result = await bridge.saveSetting(name, words);
          if (stopped || mine !== generation) return;
          if (!result.ok) throw new Error(result.error);
          const source = form.querySelector<HTMLElement>(".settings-source")!;
          source.dataset.source = "set";
          source.textContent = "set by you";
          status.textContent = name === "library" ? "Saved · applies when storytree next opens" : "Saved";
          save.disabled = true;
        } catch (reason) {
          if (stopped || mine !== generation) return;
          error.textContent = message(reason);
          status.textContent = "";
          value.setAttribute("aria-invalid", "true");
          save.disabled = false;
        } finally {
          pending = false;
          controls.filter((control) => control !== save).forEach((control) => { control.disabled = false; });
          if (!stopped && mine === generation && (document.activeElement === document.body || form.contains(document.activeElement))) value.focus();
        }
      })();
    });
  }
  function open(): void {
    if (stopped || (dialog ? dialog.open : !panel.hidden)) return;
    if (dialog) dialog.showModal();
    else panel.hidden = false;
    get("#settings-title").focus();
    void read();
  }
  launch?.addEventListener("click", open);
  get("[data-retry]").addEventListener("click", () => { void read(); });
  return { open, close, stop(): void {
    stopped = true; generation++;
    panel.remove(); launch?.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
  } };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
