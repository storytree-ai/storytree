/** Capability 3 · First-run guide. */
import type { ProjectSentence, SetupHelpBridge } from "../help/bridge.js";

type SentenceBridge = Pick<SetupHelpBridge, "projectSentence" | "setProjectSentence">;

/** Save what was typed as project `project`'s sentence; a refusal is said, never reported as saved. */
export async function saveProjectSentence(bridge: SentenceBridge, project: string, typed: { what: string; audience: string }): Promise<{ saved: ProjectSentence } | { failed: string }> {
  try {
    return { saved: await bridge.setProjectSentence(project, typed.what, typed.audience) };
  } catch (error: unknown) {
    console.error(`app-setup projects: the sentence of “${project}” could not be saved`, error);
    return { failed: `The sentence could not be saved: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * The project's sentence, in the app menu's Projects section (ADR-1085 D1 as narrowed): the selected project's two
 * halves, what it is and who it is for, as fields saved together; a half not yet said shows as unsaid.
 */
export function mountProjectSentence(host: HTMLElement, bridge: SentenceBridge, options: { current(): string | undefined }): { stop(): void; refresh(): void } {
  const root = document.createElement("div");
  root.className = "setup-help setup-project-sentence";
  root.innerHTML = `<form class="setup-project-sentence-form" data-project-sentence aria-label="The project's sentence">
<p class="setup-project-sentence-title" data-project-sentence-title></p>
<label class="setup-project-sentence-field">What it is <input type="text" data-project-sentence-what placeholder="Not said yet: what the project is" autocomplete="off"></label>
<label class="setup-project-sentence-field">Who it is for <input type="text" data-project-sentence-audience placeholder="Not said yet: who it is for" autocomplete="off"></label>
<div class="setup-project-sentence-actions"><button type="submit" data-project-sentence-save>Save sentence</button></div>
</form>
<p class="setup-project-sentence-status" data-project-sentence-status role="status"></p>`;
  host.append(root);
  const form = root.querySelector<HTMLFormElement>("[data-project-sentence]")!;
  const title = root.querySelector<HTMLElement>("[data-project-sentence-title]")!;
  const what = root.querySelector<HTMLInputElement>("[data-project-sentence-what]")!;
  const audience = root.querySelector<HTMLInputElement>("[data-project-sentence-audience]")!;
  const save = root.querySelector<HTMLButtonElement>("[data-project-sentence-save]")!;
  const status = root.querySelector<HTMLElement>("[data-project-sentence-status]")!;
  const say = (text: string, failed = false) => { status.textContent = text; status.setAttribute("role", failed ? "alert" : "status"); };
  let shown: string | undefined;
  let read: ProjectSentence = {};
  const fill = (sentence: ProjectSentence) => {
    read = sentence;
    what.value = sentence.what ?? "";
    audience.value = sentence.audience ?? "";
    changed();
  };
  const changed = () => { save.disabled = shown === undefined || (what.value.trim() === (read.what ?? "") && audience.value.trim() === (read.audience ?? "")); };
  function refresh(): void {
    const project = options.current();
    if (project === shown) return;
    shown = project;
    say("");
    form.hidden = project === undefined;
    title.textContent = project === undefined ? "" : `What “${project}” is, and who it is for`;
    fill({});
    if (project === undefined) return;
    void bridge.projectSentence(project).then((sentence) => { if (shown === project) fill(sentence); })
      .catch((error: unknown) => {
        console.error(`app-setup projects: the sentence of “${project}” could not be read`, error);
        if (shown === project) say(`The sentence could not be read: ${error instanceof Error ? error.message : String(error)}`, true);
      });
  }
  what.addEventListener("input", changed);
  audience.addEventListener("input", changed);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const project = shown;
    if (project === undefined) return;
    save.disabled = true;
    void saveProjectSentence(bridge, project, { what: what.value, audience: audience.value }).then((result) => {
      if (shown !== project) return;
      if ("failed" in result) { say(result.failed, true); changed(); return; }
      fill(result.saved);
      say("Saved.");
    });
  });
  refresh();
  return { stop: () => root.remove(), refresh };
}
