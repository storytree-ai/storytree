import type { UpdateAction, UpdateState } from "../updates/main-updates.js";
import type { InstallChoice, InstallChoiceState } from "../updates/install-choice.js";

/**
 * Plain, live status inside the gear; closing the menu never cancels an update. The status is read
 * every minute as well, so a downloaded release waiting to install is announced (`pending`) and can
 * be installed now from the same button.
 */
export function mountUpdates(host: HTMLElement, request: (action: UpdateAction) => Promise<UpdateState>, pending: (waiting: boolean) => void = () => {}) {
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
    const [title, detail] = updateText(state);
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
  return { stop() { stopped = true; clearTimeout(timer); button.removeEventListener("click", check); } };
}

export function updateText(state: UpdateState): readonly [string, string] {
  switch (state.phase) {
    case "idle": return ["", ""];
    case "checking": return ["Checking for updates…", "Looking for the latest build."];
    case "up-to-date": return ["Up to date", `Running ${state.runningBuild}.`];
    case "building": return ["Building update…", `${state.nextBuild ?? "The new build"} will restart the app when ready.`];
    case "pending": return ["Update ready to install", `storytree ${state.nextBuild ?? "update"} is downloaded. ${state.reason ?? "It installs once no one has used the window, and no agent has worked, for ten minutes."} Restart now to install it: the app is back in a minute or two.`];
    case "ready": return ["Update ready", `${state.nextBuild ?? "The new build"} will restart after the library finishes writing.`];
    case "restarting": return ["Restarting…", `Opening ${state.nextBuild ?? "the new build"}.`];
    case "failed": return ["Couldn’t update", `${state.reason ?? "The check failed."} The running app is unchanged. Try again.`];
    case "unavailable": return ["Updates unavailable", "This app is not running from a runtime slot and does not update itself."];
  }
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

export interface InstallChoiceBridge { read(): Promise<InstallChoiceState>; set(choice: InstallChoice): Promise<InstallChoiceState> }

export function mountInstallChoice(_host: HTMLElement, _bridge: InstallChoiceBridge | undefined, _now: () => Date = () => new Date()) {
  return { stop() {} };
}
