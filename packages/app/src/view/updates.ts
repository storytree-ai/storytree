import type { UpdateAction, UpdateState } from "../updates/main-updates.js";

/** Plain, live status inside the gear; closing the menu never cancels an update. */
export function mountUpdates(host: HTMLElement, request: (action: UpdateAction) => Promise<UpdateState>) {
  const button = host.querySelector<HTMLButtonElement>("[data-app-updates]")!;
  const status = host.querySelector<HTMLElement>("#app-update-status")!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const show = (state: UpdateState) => {
    const busy = ["checking", "building", "ready", "restarting"].includes(state.phase);
    button.disabled = busy;
    status.hidden = state.phase === "idle";
    status.dataset.phase = state.phase;
    const [title, detail] = updateText(state);
    const heading = document.createElement("strong");
    heading.textContent = title;
    const text = document.createElement("span");
    text.textContent = detail;
    status.replaceChildren(heading, text);
    if (busy) timer = setTimeout(() => void read("status"), 200);
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
    show({ phase: "checking", runningBuild: "" });
    void read("check");
  };
  button.addEventListener("click", check);
  return { stop() { stopped = true; clearTimeout(timer); button.removeEventListener("click", check); } };
}

export function updateText(state: UpdateState): readonly [string, string] {
  switch (state.phase) {
    case "idle": return ["", ""];
    case "checking": return ["Checking for updates…", "Looking for the latest build."];
    case "up-to-date": return ["Up to date", `Running ${state.runningBuild}.`];
    case "building": return ["Building update…", `${state.nextBuild ?? "The new build"} will restart the app when ready.`];
    case "ready": return ["Update ready", `${state.nextBuild ?? "The new build"} will restart after the library finishes writing.`];
    case "restarting": return ["Restarting…", `Opening ${state.nextBuild ?? "the new build"}.`];
    case "failed": return ["Couldn’t update", `${state.reason ?? "The check failed."} The running app is unchanged. Try again.`];
    case "unavailable": return ["Updates unavailable", "This app is not running from a runtime slot and does not update itself."];
  }
}
