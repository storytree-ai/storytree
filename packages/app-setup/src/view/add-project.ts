// Capability 3 · First-run guide.
import type { AddedFolder, SetupHelpBridge } from "../help/bridge.js";
import { unreadableSentence } from "@storytree/map/languages";
import { ACTIONS } from "@storytree/shown-words";

import { COMMIT_STORYTREE } from "../project/storytree-folder.js";

const PROJECT_GONE = "storytree:project-gone";

export function sayProjectGone(from: HTMLElement, project: string): void {
  const page = from.ownerDocument.defaultView;
  if (page !== null) from.dispatchEvent(new page.CustomEvent(PROJECT_GONE, { bubbles: true, detail: project }));
}

export function addedSentence(added: AddedFolder, shown = ""): string {
  const { unreadable, ...folder } = added;
  if (unreadable !== undefined) return `${addedSentence(folder, shown)} ${unreadableSentence(unreadable)}`;
  if (added.status === "set up" && added.replaced !== undefined) return `Project “${added.project}” is set up in ${added.folder}${shown}. ${COMMIT_STORYTREE} It is new here because its marker named “${added.replaced}”, a project this computer's library does not have.`;
  if (added.status === "set up") return `Project “${added.project}” is set up in ${added.folder}${shown}. ${COMMIT_STORYTREE}`;
  if (added.status === "brought back") return `${added.folder} is project “${added.project}” again, with its records${shown}.`;
  return `${added.folder} is already project “${added.project}”.`;
}

export function mountAddProject(host: HTMLElement, bridge: Pick<SetupHelpBridge, "addProject">, options: { onAdded(project: string): Promise<void> }): { stop(): void; add(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-add-project";
  root.innerHTML = `<button type="button" data-add-project>${ACTIONS.addProject}</button><p class="setup-add-project-status" data-add-project-status role="status"></p>`;
  host.append(root);
  const button = root.querySelector<HTMLButtonElement>("[data-add-project]")!;
  const status = root.querySelector<HTMLElement>("[data-add-project-status]")!;
  let named: string | undefined;
  const say = (text: string, failed = false, project?: string) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); named = project; };
  const gone = (event: Event) => { if (named !== undefined && (event as CustomEvent<string>).detail === named) say(""); };
  root.ownerDocument.addEventListener(PROJECT_GONE, gone);
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
