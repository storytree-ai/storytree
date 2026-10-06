/** Capability 3 · First-run guide. */
import type { SetupHelpBridge } from "../help/bridge.js";

type Deletion = { deleted: null } | { deleted: string; snapshot?: string } | { failed: string };

/** Delete the chosen project once its name is typed, then let the frame refresh; a name not yet typed asks nothing of the library. */
export async function deleteChosenProject(bridge: Pick<SetupHelpBridge, "deleteProject">, options: { project: string; typed: string; snapshot: boolean; onDeleted(project: string): Promise<void> }): Promise<Deletion> {
  if (options.typed !== options.project) return { deleted: null };
  try {
    const { snapshot } = await bridge.deleteProject(options.project, options.typed, options.snapshot);
    await options.onDeleted(options.project);
    return snapshot === undefined ? { deleted: options.project } : { deleted: options.project, snapshot };
  } catch (error: unknown) {
    return { failed: `The project was not deleted: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Delete a project, in the app menu's Projects section below Remove (ADR-0831): picks any project
 * in the library but the one on show, says where its records live and who loses them, and deletes
 * only once its name is typed. A snapshot into this computer's backups is ticked by default and can
 * be unticked.
 */
export function mountDeleteProject(host: HTMLElement, bridge: Pick<SetupHelpBridge, "deletableProjects" | "deleteProject">, options: { onDeleted(project: string): Promise<void> }): { stop(): void; refresh(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-delete-project";
  root.innerHTML = `<button type="button" class="setup-delete-project-ask" data-delete-project>Delete a project’s records…</button>
<div class="setup-delete-project-dialog" data-delete-project-dialog role="group" aria-label="Delete a project’s records" hidden>
<label class="setup-delete-project-field">Project <select data-delete-project-choice></select></label>
<p class="setup-delete-project-warning" data-delete-project-warning></p>
<label class="setup-delete-project-field">Type its name to confirm <input type="text" data-delete-project-typed autocomplete="off" spellcheck="false"></label>
<label class="setup-delete-project-snapshot"><input type="checkbox" data-delete-project-snapshot checked> Save a snapshot to this computer’s backups first</label>
<div class="setup-delete-project-actions"><button type="button" class="setup-delete-project-yes" data-delete-project-yes disabled>Delete for good</button><button type="button" data-delete-project-cancel>Cancel</button></div>
</div>
<p class="setup-delete-project-status" data-delete-project-status role="status"></p>`;
  host.append(root);
  const ask = root.querySelector<HTMLButtonElement>("[data-delete-project]")!;
  const dialog = root.querySelector<HTMLElement>("[data-delete-project-dialog]")!;
  const choice = root.querySelector<HTMLSelectElement>("[data-delete-project-choice]")!;
  const warning = root.querySelector<HTMLElement>("[data-delete-project-warning]")!;
  const typed = root.querySelector<HTMLInputElement>("[data-delete-project-typed]")!;
  const snapshot = root.querySelector<HTMLInputElement>("[data-delete-project-snapshot]")!;
  const yes = root.querySelector<HTMLButtonElement>("[data-delete-project-yes]")!;
  const cancel = root.querySelector<HTMLButtonElement>("[data-delete-project-cancel]")!;
  const status = root.querySelector<HTMLElement>("[data-delete-project-status]")!;
  const say = (text: string, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); };
  let warnings = new Map<string, string>();
  let busy = false;
  function ready(): void {
    warning.textContent = warnings.get(choice.value) ?? "";
    yes.disabled = busy || choice.value === "" || typed.value !== choice.value;
  }
  function close(): void { dialog.hidden = true; typed.value = ""; snapshot.checked = true; }
  async function load(): Promise<void> {
    const projects = await bridge.deletableProjects();
    warnings = new Map(projects.map(({ project, warning: text }) => [project, text]));
    const kept = choice.value;
    choice.replaceChildren(...projects.map(({ project }) => Object.assign(document.createElement("option"), { value: project, textContent: project })));
    if (warnings.has(kept)) choice.value = kept;
    if (projects.length === 0) { close(); say("There is no other project to delete: the one on show is in use."); }
    ready();
  }
  /** Read the projects afresh while the dialog is open; a closed one asks the library nothing. */
  function refresh(): void {
    if (dialog.hidden) return;
    void load().catch((error: unknown) => say(`The projects could not be read: ${error instanceof Error ? error.message : String(error)}`, true));
  }
  ask.addEventListener("click", () => { say(""); dialog.hidden = false; refresh(); choice.focus(); });
  choice.addEventListener("change", () => { typed.value = ""; ready(); });
  typed.addEventListener("input", ready);
  cancel.addEventListener("click", () => { close(); ask.focus(); });
  yes.addEventListener("click", () => {
    busy = true;
    yes.disabled = cancel.disabled = true;
    void deleteChosenProject(bridge, { project: choice.value, typed: typed.value, snapshot: snapshot.checked, onDeleted: options.onDeleted }).then((result) => {
      if ("failed" in result) say(result.failed, true);
      else if (result.deleted !== null) {
        close();
        say(result.snapshot === undefined ? `“${result.deleted}” is deleted. No snapshot was taken.` : `“${result.deleted}” is deleted. Its snapshot is at ${result.snapshot}.`);
      }
    }).finally(() => { busy = false; cancel.disabled = false; refresh(); });
  });
  return { stop: () => root.remove(), refresh };
}
