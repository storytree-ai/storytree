/** Capability 3 · First-run guide. */
import type { FactoryFolder, SetupHelpBridge } from "../help/bridge.js";

type FactoryBridge = Pick<SetupHelpBridge, "factoryFolder" | "chooseFactory">;

/**
 * Your factory, in the app menu's Projects section (question_0b0b82eb8fbc): the folder of your own plugins in use, and
 * "Import or switch factory…", which picks another, set up or validated as first launch does, with no approval asked.
 */
export function mountFactory(host: HTMLElement, bridge: FactoryBridge): { stop(): void; refresh(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-factory";
  root.innerHTML = `<p class="setup-factory-title">Your factory</p>
<p class="setup-factory-about">The folder that holds your own plugins and changes to storytree.</p>
<p class="setup-factory-folder" data-factory-folder></p>
<div class="setup-factory-actions"><button type="button" data-switch-factory>Import or switch factory…</button></div>
<p class="setup-factory-status" data-factory-status role="status"></p>`;
  host.append(root);
  const shown = root.querySelector<HTMLElement>("[data-factory-folder]")!;
  const button = root.querySelector<HTMLButtonElement>("[data-switch-factory]")!;
  const status = root.querySelector<HTMLElement>("[data-factory-status]")!;
  const say = (text: string, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); };
  const show = ({ folder }: FactoryFolder) => {
    shown.textContent = folder;
    shown.title = folder;
  };
  function refresh(): void {
    void bridge.factoryFolder().then(show).catch((error: unknown) => {
      console.error("app-setup factory: the factory folder could not be read", error);
      say(`Your factory could not be read: ${messageOf(error)}`, true);
    });
  }
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.disabled = true;
    say("Choose a folder…");
    void bridge.chooseFactory().then((chosen) => {
      if (chosen === null) return say("");
      say(chosen.status === "set up" ? `${chosen.folder} is now your factory, set up for your plugins.` : `${chosen.folder} is now your factory.`);
      refresh();
    }).catch((error: unknown) => {
      // A refused folder and a failed switch reach the page alike, so both are written down.
      console.error("app-setup factory: the folder could not become the factory", error);
      say(`That folder cannot be your factory: ${messageOf(error)}`, true);
    })
      .finally(() => { button.disabled = false; });
  });
  refresh();
  return { stop: () => root.remove(), refresh };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
