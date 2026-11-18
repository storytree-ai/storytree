// Capability 2 · Storytree projects
export interface PageStatus {
  state(): string | undefined;
  setState(state: string): void;
  showProgress(on: boolean): void;
  showFreshness(text: string | undefined): void;
  showReadError(heading: string | undefined, text?: string): void;
  showMessage(state: string, heading: string, text: string): void;
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
