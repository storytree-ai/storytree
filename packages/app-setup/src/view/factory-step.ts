/**
 * Capability 3 · First-run guide. The first-launch step that asks for this computer's factory folder
 * (question_5867f490cdd6): it shows until one is chosen and cannot be dismissed, so picking the folder, the approval
 * for its plugins, is made once before anything else.
 */
import type { SetupHelpBridge } from "../help/bridge.js";

type FactoryBridge = Pick<SetupHelpBridge, "factoryFolder" | "chooseFactory">;

/** Whether the step is needed, and one pick through the native picker: true once a folder is the factory, said either way. */
export function chooseFactoryStep(bridge: FactoryBridge, say: (text: string, failed?: boolean) => void) {
  return {
    needed: async () => (await bridge.factoryFolder()) === null,
    async choose(): Promise<boolean> {
      say("Choose a folder…");
      try {
        const chosen = await bridge.chooseFactory();
        if (chosen === null) {
          say("");
          return false;
        }
        say(chosen.status === "set up" ? `${chosen.folder} is now your factory, set up for your plugins.` : `${chosen.folder} is now your factory.`);
        return true;
      } catch (error) {
        say(`That folder cannot be your factory: ${error instanceof Error ? error.message : String(error)}`, true);
        return false;
      }
    },
  };
}

/** The step, mounted over the app while no factory folder is chosen; it removes itself once one is. */
export function mountFactoryStep(host: HTMLElement, bridge: FactoryBridge): { stop(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-factory-step";
  root.hidden = true;
  root.innerHTML = `<section class="setup-factory-panel" role="dialog" aria-modal="true" aria-labelledby="setup-factory-title">
      <h2 id="setup-factory-title">Choose your factory folder</h2>
      <p>Your factory is the folder that holds your own plugins and changes to storytree. Choose an empty folder and storytree sets it up, or one it set up before.</p>
      <p>storytree runs the plugins in the folder you choose, so choose one you trust.</p>
      <div class="setup-help-actions"><button type="button" data-choose-factory>Choose folder…</button></div>
      <p data-factory-status role="status"></p>
    </section>`;
  host.append(root);
  const button = root.querySelector<HTMLButtonElement>("[data-choose-factory]")!;
  const status = root.querySelector<HTMLElement>("[data-factory-status]")!;
  const step = chooseFactoryStep(bridge, (text, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); });
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.disabled = true;
    void step.choose().then((done) => { if (done) root.remove(); }).finally(() => { button.disabled = false; });
  });
  void step.needed().then((needed) => {
    if (!needed) return root.remove();
    root.hidden = false;
    button.focus();
  }).catch(() => root.remove());
  return { stop: () => root.remove() };
}
