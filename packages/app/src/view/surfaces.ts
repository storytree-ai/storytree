/**
 * The Surfaces tab of the gear menu (the app story; ADR-0750): every surface of the app window the
 * stories declare, with its name, one line on what it is, a switch where it can be switched off, and
 * its own settings beneath it. The Story panel is a group holding the surfaces within it. A change
 * is saved in the settings file at once, and `changed` hears it so the frame can apply it.
 */
import type { SurfacesBridge } from "../surfaces/bridge.js";
import type { SurfaceReading } from "../surfaces/switches.js";

export function renderSurfaces(readings: readonly SurfaceReading[]): string {
  const within = (group: string) => readings.filter((surface) => surface.within === group);
  return readings.filter((surface) => surface.within === undefined).map((surface) => {
    const members = within(surface.id);
    if (members.length === 0) return row(surface, readings);
    return `<section class="surface-group" data-surface-group="${attribute(surface.id)}" aria-labelledby="surface-${attribute(surface.id)}">
      ${row(surface, readings)}${members.map((member) => row(member, readings)).join("")}
    </section>`;
  }).join("");
}

function row(surface: SurfaceReading, readings: readonly SurfaceReading[]): string {
  const id = attribute(surface.id);
  const followed = readings.find((each) => each.id === surface.follows);
  const state = surface.switchable
    ? `<label class="surface-toggle"><input type="checkbox" role="switch" data-switch="${id}" aria-labelledby="surface-${id}" aria-describedby="surface-${id}-description"${surface.on ? " checked" : ""}><span aria-hidden="true">${surface.on ? "On" : "Off"}</span></label>`
    : `<span class="surface-fixed">${followed === undefined ? "Always on" : `${surface.on ? "On" : "Off"} with ${text(followed.name)}`}</span>`;
  const settings = surface.settings.map((setting) => {
    const name = `surface-${id}-${attribute(setting.id)}`;
    const options = setting.choices.map((choice) => `<option value="${attribute(choice.id)}"${choice.id === setting.value ? " selected" : ""}>${text(choice.name)}</option>`).join("");
    return `<div class="surface-setting">
        <label for="${name}">${text(setting.name)}</label>
        <select id="${name}" data-setting="${id} ${attribute(setting.id)}" aria-describedby="${name}-meaning"${surface.on ? "" : " disabled"}>${options}</select>
        <p id="${name}-meaning">${text(setting.meaning)}</p>
      </div>`;
  }).join("");
  return `<div class="surface" data-surface="${id}"${surface.within === undefined ? "" : ` data-within="${attribute(surface.within)}"`}>
      <div class="surface-text"><h3 id="surface-${id}">${text(surface.name)}</h3><p id="surface-${id}-description">${text(surface.description)}</p></div>
      <div class="surface-state">${state}</div>
      ${settings}
    <!-- /${id} --></div>`;
}

/** Mount the menu in `host`: read when opened, and save each change as it is made. */
export function mountSurfaces(host: HTMLElement, bridge: SurfacesBridge, changed: () => void) {
  host.innerHTML = `<section class="surfaces" aria-labelledby="surfaces-title">
      <h2 id="surfaces-title">Surfaces</h2>
      <p class="app-section-description">The parts of the app window. Switch one off to hide it. Saved on this computer, and shown by <code>storytree settings show</code>.</p>
      <p class="surfaces-status" data-surfaces-status role="status"></p>
      <div data-surfaces></div>
    </section>`;
  const list = host.querySelector<HTMLElement>("[data-surfaces]")!;
  const status = host.querySelector<HTMLElement>("[data-surfaces-status]")!;
  let generation = 0;
  let stopped = false;
  const draw = (readings: readonly SurfaceReading[]): void => {
    list.innerHTML = renderSurfaces(readings);
  };
  const answer = async (asked: ReturnType<SurfacesBridge["readSurfaces"]>, saving: boolean): Promise<void> => {
    const mine = ++generation;
    try {
      const result = await asked;
      if (stopped || mine !== generation) return;
      if (!result.ok) throw new Error(result.error);
      const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.id || document.activeElement.dataset.switch : undefined;
      draw(result.value);
      status.textContent = saving ? "Saved" : "";
      if (focused !== undefined) (list.querySelector<HTMLElement>(`[id="${focused}"]`) ?? list.querySelector<HTMLElement>(`[data-switch="${focused}"]`))?.focus();
      if (saving) changed();
    } catch (error) {
      if (stopped || mine !== generation) return;
      status.textContent = saving ? `Couldn’t save: ${message(error)}` : `Couldn’t read the surfaces: ${message(error)}`;
      if (saving) void answer(bridge.readSurfaces(), false);
    }
  };
  list.addEventListener("change", (event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const words = control.dataset.switch !== undefined
      ? [control.dataset.switch, (control as HTMLInputElement).checked ? "on" : "off"]
      : control.dataset.setting !== undefined ? [...control.dataset.setting.split(" "), control.value] : undefined;
    if (words === undefined) return;
    status.textContent = "Saving…";
    void answer(bridge.saveSurface(words), true);
  });
  return {
    open(): void {
      if (stopped) return;
      status.textContent = "Reading surfaces…";
      void answer(bridge.readSurfaces(), false);
    },
    close(): void { generation++; },
    stop(): void { stopped = true; generation++; host.replaceChildren(); },
  };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function text(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function attribute(value: string): string {
  return text(value).replaceAll('"', "&quot;");
}
