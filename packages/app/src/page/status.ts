/**
 * Capability 2 · Storytree projects. What the desktop page says about itself on its body and over its content: `data-state`
 * (loading, ready, empty, missing, error), the start's bar and `data-start`, the kept forest's `data-fresh="no"` mark, the notice
 * over a forest whose first read failed, a message in place of the project, and `data-drew`, the census every mounted surface adds
 * its reading to, which the smoke check reads.
 */
export interface PageStatus {
  state(): string | undefined;
  setState(state: string): void;
  /** Show the start's bar (index.html's, on show from the window opening) while the forest settles, or take it away when settled. */
  showProgress(on: boolean): void;
  /** Mark the forest on show as the one last read, with why (`data-fresh="no"`), or clear the mark. */
  showFreshness(text: string | undefined): void;
  /** Say over the forest why its first read failed, while the reading keeps trying (`data-state="error"`), or take it away. */
  showReadError(heading: string | undefined, text?: string): void;
  /** A heading and a line of text in place of the project, written as text (never as HTML). */
  showMessage(state: string, heading: string, text: string): void;
  /** Add `drawn` to the page's census of what its surfaces drew. */
  sayWhatWasDrawn(drawn: object): void;
}

export function pageStatus(document: Document, content: HTMLElement): PageStatus {
  const body = document.body;
  const notice = (heading: string, text: string): HTMLElement => {
    const box = document.createElement("div");
    box.className = "empty";
    const title = document.createElement("h1");
    title.textContent = heading;
    const line = document.createElement("p");
    line.textContent = text;
    box.append(title, line);
    return box;
  };
  const status: PageStatus = {
    state: () => body.dataset.state,
    setState(state) { body.dataset.state = state; },
    showProgress(on) {
      const bar = document.getElementById("start-progress");
      if (bar !== null) bar.hidden = !on;
      body.dataset.start = on ? "settling" : "settled";
    },
    showFreshness(text) {
      let mark = document.getElementById("freshness");
      if (text === undefined) {
        mark?.remove();
        delete body.dataset.fresh;
        return;
      }
      if (mark === null) {
        mark = document.createElement("p");
        mark.id = "freshness";
        mark.setAttribute("role", "status");
        content.append(mark);
      }
      mark.textContent = text;
      body.dataset.fresh = "no";
    },
    showReadError(heading, text) {
      document.getElementById("read-error")?.remove();
      if (heading === undefined) return;
      const box = notice(heading, text ?? "");
      box.id = "read-error";
      box.setAttribute("role", "status");
      content.append(box);
      status.setState("error");
    },
    showMessage(state, heading, text) {
      const box = notice(heading, text);
      box.dataset.surfaceId = "app-message";
      content.replaceChildren(box);
      status.showProgress(false);
      status.setState(state);
    },
    sayWhatWasDrawn(drawn) {
      body.dataset.drew = JSON.stringify({ ...JSON.parse(body.dataset.drew ?? "{}"), ...drawn });
    },
  };
  return status;
}
