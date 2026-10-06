/** Capability 3 · First-run guide. */
import type { SetupHelpBridge } from "../help/bridge.js";

/** Add project, in the app menu's Projects section: the native folder picker, then the new project on show. */
export function mountAddProject(host: HTMLElement, bridge: Pick<SetupHelpBridge, "addProject">, options: { onAdded(project: string): Promise<void> }): { stop(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-add-project";
  root.innerHTML = `<button type="button" data-add-project>Add project…</button><p class="setup-add-project-status" data-add-project-status role="status"></p>`;
  host.append(root);
  const button = root.querySelector<HTMLButtonElement>("[data-add-project]")!;
  const status = root.querySelector<HTMLElement>("[data-add-project-status]")!;
  const say = (text: string, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); };
  button.addEventListener("click", () => {
    button.disabled = true;
    say("Choose a folder…");
    void bridge.addProject().then(async (added) => {
      if (added === null) return say("");
      say(added.status === "set up" ? `${added.folder} is now project “${added.project}”.` : `${added.folder} is already project “${added.project}”.`);
      await options.onAdded(added.project);
    }).catch((error: unknown) => {
      say(`The folder could not be added: ${error instanceof Error ? error.message : String(error)}`, true);
    }).finally(() => { button.disabled = false; });
  });
  return { stop: () => root.remove() };
}
