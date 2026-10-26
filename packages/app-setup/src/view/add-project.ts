/** Capability 3 · First-run guide. */
import type { AddedFolder, SetupHelpBridge } from "../help/bridge.js";

/** Said on the page the remove and delete views live on when a project leaves this computer's list, so a line naming it is cleared. */
const PROJECT_GONE = "storytree:project-gone";

/** Say from `from` that `project` left this computer's list, with its own window's event (the page it is on). */
export function sayProjectGone(from: HTMLElement, project: string): void {
  const page = from.ownerDocument.defaultView;
  if (page !== null) from.dispatchEvent(new page.CustomEvent(PROJECT_GONE, { bubbles: true, detail: project }));
}

/** What adding a folder made of it, in plain words. */
export function addedSentence(added: AddedFolder, shown = ""): string {
  if (added.status === "set up") return `${added.folder} is now project “${added.project}”${shown}.`;
  if (added.status === "brought back") return `${added.folder} is project “${added.project}” again, with its records${shown}.`;
  return `${added.folder} is already project “${added.project}”.`;
}

/** Add project, in the app menu's Projects section: the native folder picker, then the new project on show. */
export function mountAddProject(host: HTMLElement, bridge: Pick<SetupHelpBridge, "addProject">, options: { onAdded(project: string): Promise<void> }): { stop(): void; add(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-add-project";
  root.innerHTML = `<button type="button" data-add-project>Add project…</button><p class="setup-add-project-status" data-add-project-status role="status"></p>`;
  host.append(root);
  const button = root.querySelector<HTMLButtonElement>("[data-add-project]")!;
  const status = root.querySelector<HTMLElement>("[data-add-project-status]")!;
  /** The project the line names, which leaving this computer's list clears. */
  let named: string | undefined;
  const say = (text: string, failed = false, project?: string) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); named = project; };
  const gone = (event: Event) => { if (named !== undefined && (event as CustomEvent<string>).detail === named) say(""); };
  root.ownerDocument.addEventListener(PROJECT_GONE, gone);
  /** The picker, then the project added on show; the app bar's "New project…" starts it too. */
  function add(): void {
    if (button.disabled) return;
    button.disabled = true;
    say("Choose a folder…");
    void bridge.addProject().then(async (added) => {
      if (added === null) return say("");
      say(addedSentence(added), false, added.project);
      await options.onAdded(added.project);
    }).catch((error: unknown) => {
      console.error("app-setup projects: the folder could not be added", error);
      say(`The folder could not be added: ${error instanceof Error ? error.message : String(error)}`, true);
    }).finally(() => { button.disabled = false; });
  }
  button.addEventListener("click", add);
  return { stop: () => { root.ownerDocument.removeEventListener(PROJECT_GONE, gone); root.remove(); }, add };
}
