import type { UpdateAction, UpdateState } from "../updates/main-updates.js";
import { nextInstallAt, type InstallChoice, type InstallChoiceState } from "../updates/install-choice.js";

/**
 * Plain, live status inside the gear; closing the menu never cancels an update. The status is read
 * every minute as well, so a downloaded release waiting to install is announced (`pending`) and can
 * be installed now from the same button.
 */
export function mountUpdates(host: HTMLElement, request: (action: UpdateAction) => Promise<UpdateState>, pending: (waiting: boolean) => void = () => {}, choice: () => InstallChoice | undefined = () => undefined) {
  const button = host.querySelector<HTMLButtonElement>("[data-app-updates]")!;
  const status = host.querySelector<HTMLElement>("#app-update-status")!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let action: UpdateAction = "check";
  const show = (state: UpdateState) => {
    const busy = ["checking", "building", "ready", "restarting"].includes(state.phase);
    button.disabled = busy;
    action = state.phase === "pending" ? "install" : "check";
    button.textContent = state.phase === "pending" ? "Restart to update" : "Check for updates";
    pending(state.phase === "pending");
    status.hidden = state.phase === "idle";
    status.dataset.phase = state.phase;
    const [title, detail] = updateText(state, choice());
    const heading = document.createElement("strong");
    heading.textContent = title;
    const text = document.createElement("span");
    text.textContent = detail;
    status.replaceChildren(heading, text);
    timer = setTimeout(() => void read("status"), busy ? 200 : 60_000);
  };
  const read = async (action: UpdateAction) => {
    clearTimeout(timer);
    try {
      const state = await request(action);
      if (!stopped) show(state);
    } catch (error) {
      if (!stopped) show({ phase: "failed", runningBuild: "", reason: error instanceof Error ? error.message : String(error) });
    }
  };
  const check = () => {
    const asked = action;
    show({ phase: asked === "install" ? "restarting" : "checking", runningBuild: "" });
    void read(asked);
  };
  button.addEventListener("click", check);
  void read("status");
  return { stop() { stopped = true; clearTimeout(timer); button.removeEventListener("click", check); }, refresh() { if (!stopped) void read("status"); } };
}

export function updateText(state: UpdateState, choice?: InstallChoice): readonly [string, string] {
  switch (state.phase) {
    case "idle": return ["", ""];
    case "checking": return ["Checking for updates…", "Looking for the latest build."];
    case "up-to-date": return ["Up to date", `Running ${state.runningBuild}.`];
    case "building": return ["Building update…", `${state.nextBuild ?? "The new build"} will restart the app when ready.`];
    case "pending": return ["Update ready to install", `storytree ${state.nextBuild ?? "update"} is downloaded. ${state.reason ?? waitingFor(choice)} Restart now to install it: the app is back in a minute or two.`];
    case "ready": return ["Update ready", `${state.nextBuild ?? "The new build"} will restart after the library finishes writing.`];
    case "restarting": return ["Restarting…", `Opening ${state.nextBuild ?? "the new build"}.`];
    case "failed": return ["Couldn’t update", `${state.reason ?? "The check failed."} The running app is unchanged. Try again.`];
    case "unavailable": return ["Updates unavailable", "This app is not running from a runtime slot and does not update itself."];
  }
}

/** When a downloaded release waiting to install will install itself, by the user's choice (4.13). */
function waitingFor(choice: InstallChoice | undefined): string {
  if (choice?.mode === "manual") return "You chose to install updates only when you say.";
  if (choice?.mode === "hours") return `It installs during your quiet hours, ${choice.from} to ${choice.to}, once no one is using storytree.`;
  return "It installs once no one has used the window, and no agent has worked, for ten minutes.";
}

/** Whether the app opens at sign-in, in the tray (lifecycle 1.12), and whether it can here. */
export interface SignInState { available: boolean; on: boolean }
export interface SignInBridge { read(): Promise<SignInState>; set(on: boolean): Promise<SignInState> }

/** The Updates section's Open at sign-in switch; shown only where the app is installed and can open at sign-in. */
export function mountSignIn(host: HTMLElement, bridge: SignInBridge | undefined) {
  const label = host.querySelector<HTMLElement>("[data-app-sign-in]")!;
  const box = label.querySelector<HTMLInputElement>("input")!;
  const error = label.querySelector<HTMLElement>(".app-sign-in-error")!;
  let stopped = false;
  const show = (state: SignInState) => {
    if (stopped) return;
    label.hidden = !state.available;
    box.checked = state.on;
    box.disabled = false;
  };
  const change = () => {
    if (bridge === undefined) return;
    const wanted = box.checked;
    box.disabled = true;
    error.hidden = true;
    bridge.set(wanted).then(show, (reason: unknown) => {
      if (stopped) return;
      box.checked = !wanted;
      box.disabled = false;
      error.textContent = `Couldn’t change this: ${reason instanceof Error ? reason.message : String(reason)}`;
      error.hidden = false;
    });
  };
  box.addEventListener("change", change);
  void bridge?.read().then(show, () => { label.hidden = true; });
  return { stop() { stopped = true; box.removeEventListener("change", change); } };
}

/** The gear's install choice (4.14); the bridge reads and keeps it in the main process. */
export interface InstallChoiceBridge { read(): Promise<InstallChoiceState>; set(choice: InstallChoice): Promise<InstallChoiceState> }

/** What the Updates section says about when the next automatic install may happen. */
export function nextInstallText(choice: InstallChoice, now: Date): string {
  if (choice.mode === "manual") return "Updates still download in the background, ready for when you press Check for updates.";
  if (choice.mode === "quiet") return "A downloaded update installs at the next quiet moment.";
  const next = nextInstallAt(choice, now)!;
  if (next.getTime() === now.getTime()) return `Quiet hours are on now, until ${choice.to}: a downloaded update installs at the next quiet moment.`;
  const day = next.getDate() === now.getDate() ? "today" : "tomorrow";
  return `Next automatic install: ${day} from ${choice.from}, until ${choice.to}, when no one is using storytree.`;
}

/** The Updates section's When updates install choice; shown only where the app installs releases. */
export function mountInstallChoice(host: HTMLElement, bridge: InstallChoiceBridge | undefined, now: () => Date = () => new Date(), changed: () => void = () => {}) {
  const field = host.querySelector<HTMLElement>("[data-app-install-choice]")!;
  const radios = [...field.querySelectorAll<HTMLInputElement>('input[name="app-install-mode"]')];
  const from = field.querySelector<HTMLInputElement>("[data-app-install-from]")!;
  const to = field.querySelector<HTMLInputElement>("[data-app-install-to]")!;
  const next = field.querySelector<HTMLElement>("[data-app-install-next]")!;
  const error = field.querySelector<HTMLElement>("[data-app-install-error]")!;
  let kept: InstallChoice | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const show = (state: InstallChoiceState) => {
    if (stopped) return;
    kept = state.choice;
    field.hidden = !state.available;
    for (const radio of radios) { radio.checked = radio.value === state.choice.mode; radio.disabled = false; }
    if (state.choice.mode === "hours") { from.value = state.choice.from; to.value = state.choice.to; }
    from.disabled = to.disabled = state.choice.mode !== "hours";
    next.textContent = nextInstallText(state.choice, now());
  };
  const change = () => {
    if (bridge === undefined || kept === undefined) return;
    const mode = radios.find(radio => radio.checked)?.value;
    const wanted = (mode === "hours" ? { mode, from: from.value, to: to.value } : { mode }) as InstallChoice;
    const previous = kept;
    for (const radio of radios) radio.disabled = true;
    error.hidden = true;
    bridge.set(wanted).then((state) => { show(state); changed(); }, (reason: unknown) => {
      if (stopped) return;
      show({ available: true, choice: previous });
      error.textContent = `Couldn’t change this: ${reason instanceof Error ? reason.message : String(reason)}`;
      error.hidden = false;
    });
  };
  field.addEventListener("change", change);
  void bridge?.read().then(show, () => { field.hidden = true; });
  // The next window's day moves with the clock.
  timer = setInterval(() => { if (kept !== undefined) next.textContent = nextInstallText(kept, now()); }, 60_000);
  return { stop() { stopped = true; clearInterval(timer); field.removeEventListener("change", change); }, choice: () => kept };
}
