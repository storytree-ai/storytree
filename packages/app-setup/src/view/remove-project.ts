import type { SetupHelpBridge } from "../help/bridge.js";

type Removal = { removed: string | null } | { failed: string };

/** Take the project on show off this computer's list, then let the frame refresh; nothing on show removes nothing. */
export async function removeCurrentProject(bridge: Pick<SetupHelpBridge, "removeProject">, options: { current(): string | undefined; onRemoved(project: string): Promise<void> }): Promise<Removal> {
  const project = options.current();
  if (project === undefined) return { removed: null };
  try {
    await bridge.removeProject(project);
    await options.onRemoved(project);
    return { removed: project };
  } catch (error: unknown) {
    return { failed: `The project could not be removed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Remove project, in the app menu's Projects section beside Add project: offers to take the project
 * on show off this computer's list. A quiet button asks in place first; the records stay in the library.
 */
export function mountRemoveProject(host: HTMLElement, bridge: Pick<SetupHelpBridge, "removeProject">, options: { current(): string | undefined; onRemoved(project: string): Promise<void> }): { stop(): void; refresh(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-remove-project";
  root.innerHTML = `<button type="button" class="setup-remove-project-ask" data-remove-project></button>
<div class="setup-remove-project-confirm" data-remove-project-confirm role="group" aria-label="Confirm removing the project" hidden>
<p data-remove-project-question></p>
<div class="setup-remove-project-actions"><button type="button" class="setup-remove-project-yes" data-remove-project-yes>Remove</button><button type="button" data-remove-project-cancel>Cancel</button></div>
</div>
<p class="setup-remove-project-status" data-remove-project-status role="status"></p>`;
  host.append(root);
  const ask = root.querySelector<HTMLButtonElement>("[data-remove-project]")!;
  const confirm = root.querySelector<HTMLElement>("[data-remove-project-confirm]")!;
  const question = root.querySelector<HTMLElement>("[data-remove-project-question]")!;
  const yes = root.querySelector<HTMLButtonElement>("[data-remove-project-yes]")!;
  const cancel = root.querySelector<HTMLButtonElement>("[data-remove-project-cancel]")!;
  const status = root.querySelector<HTMLElement>("[data-remove-project-status]")!;
  const say = (text: string, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); };
  let asked: string | undefined;
  function close(): void { confirm.hidden = true; asked = undefined; }
  function refresh(): void {
    const project = options.current();
    ask.disabled = project === undefined;
    ask.textContent = project === undefined ? "Remove project from this computer…" : `Remove “${project}” from this computer…`;
    if (asked !== undefined && asked !== project) close();
  }
  ask.addEventListener("click", () => {
    const project = options.current();
    if (project === undefined) return;
    asked = project;
    say("");
    question.textContent = `“${project}” leaves this computer’s list. Its records stay in the library, and adding its folder again brings it back.`;
    confirm.hidden = false;
    cancel.focus();
  });
  cancel.addEventListener("click", () => { close(); ask.focus(); });
  yes.addEventListener("click", () => {
    if (asked === undefined) return;
    yes.disabled = cancel.disabled = true;
    void removeCurrentProject(bridge, { current: () => asked, onRemoved: options.onRemoved }).then((result) => {
      close();
      if ("failed" in result) say(result.failed, true);
      else if (result.removed !== null) say(`“${result.removed}” is off this computer’s list.`);
    }).finally(() => { yes.disabled = cancel.disabled = false; refresh(); });
  });
  refresh();
  return { stop: () => root.remove(), refresh };
}
