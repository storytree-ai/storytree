import { createTour, type TourState } from "./tour.js";
import { explainers, researchDate, steps } from "./tour-copy.js";

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};

/** The guide works independently of the drawing, including when WebGL is unavailable. */
export function wireTour() {
  const root = document.querySelector<HTMLElement>("#chapter2");
  if (!root || root.dataset.tourReady) return;
  root.dataset.tourReady = "true";
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const tour = createTour(steps);
  const heading = get("tour-title");
  const kicker = get("tour-kicker");
  const lines = get("tour-lines");
  const progress = get("tour-progress");
  const why = get("tour-why");
  const whyBody = get("tour-why-body");
  const comparisons = get("tour-comparisons");
  const menu = get("tour-navigation");
  const pause = get<HTMLButtonElement>("tour-pause");
  const whyButton = get<HTMLButtonElement>("tour-depth");
  const everything = get<HTMLButtonElement>("tour-everything");
  const speed = get<HTMLSelectElement>("tour-speed");
  const live = get("tour-live");
  let previous: TourState | undefined;
  let visible = false;
  let openingActive = !document.getElementById("opening")?.hidden;
  let clock = performance.now();

  const emit = () => window.dispatchEvent(new CustomEvent("storytree-tour", { detail: { step: steps[tour.state.index], state: tour.state } }));
  const render = (state = tour.state) => {
    const step = steps[state.index]!;
    const changedStep = !previous || previous.index !== state.index || previous.generation !== state.generation || previous.freePlay !== state.freePlay;
    root.dataset.tourMode = state.freePlay ? "freeplay" : "tour";
    root.dataset.tourStep = step.id;
    if (changedStep) {
      kicker.textContent = state.freePlay ? "Chapter 2 · Your turn" : step.explainer === "opening" ? "Chapter 2 · Why storytree" : `Chapter 2 · ${explainers.find(item => item.id === step.explainer)?.title ?? step.explainer}`;
      heading.textContent = state.freePlay ? "Follow your curiosity." : step.title;
      lines.replaceChildren();
      if (state.freePlay) {
        lines.append(element("p", "Explore storytree’s own project: its stories, plan, sessions and knowledge."), element("p", "This is a saved reading. Nothing you do here changes the project."));
      } else {
        step.lines.forEach(line => lines.append(element("p", line)));
      }
      whyBody.replaceChildren();
      for (const decision of step.why) {
        const item = element("li");
        item.append(element("p", `ADR-${String(decision.number).padStart(4, "0")}`, "tour-decision-number"), element("h4", decision.title), element("p", decision.reason));
        whyBody.append(item);
      }
      comparisons.replaceChildren();
      if (step.comparisons?.length && !state.freePlay) {
        comparisons.append(element("p", "Different tools, different jobs", "eyebrow"));
        const table = element("table");
        table.append(element("caption", `${explainers.find(item => item.id === step.explainer)?.title ?? "This surface"}: how other tools approach it`));
        const head = element("thead");
        const header = element("tr");
        for (const label of ["Tool & primary source", "What it does"] ) { const th = element("th", label); th.scope = "col"; header.append(th); }
        head.append(header); table.append(head);
        const body = element("tbody");
        for (const comparison of step.comparisons) {
          const row = element("tr");
          const name = element("th"); name.scope = "row";
          const source = element("a", `${comparison.name} ↗`); source.href = comparison.url;
          name.append(source); row.append(name, element("td", comparison.claim)); body.append(row);
        }
        table.append(body); comparisons.append(table, element("p", `Comparisons checked against primary sources on ${researchDate}. Follow a tool’s link to read its own documentation.`, "tour-source-note"));
      }
    }
    comparisons.hidden = !step.comparisons?.length || state.freePlay || state.lines < step.lines.length;
    if (!state.freePlay) {
      [...lines.children].forEach((line, index) => { (line as HTMLElement).hidden = index >= state.lines; });
    }
    progress.textContent = state.freePlay ? "Free play · saved project" : `${String(state.index + 1).padStart(2, "0")} / ${steps.length} · ${state.why ? "Reading why" : state.everything ? "Showing everything" : state.paused ? "Paused" : "Playing"}`;
    pause.textContent = state.paused ? "Resume" : "Pause";
    pause.setAttribute("aria-label", state.paused ? "Resume the tour" : "Pause the tour");
    pause.setAttribute("aria-pressed", String(state.paused));
    speed.value = String(state.speed);
    everything.setAttribute("aria-pressed", String(state.everything));
    everything.textContent = state.everything ? "Back to this view" : "Show everything";
    whyButton.setAttribute("aria-expanded", String(state.why));
    why.hidden = !state.why;
    menu.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.explainer === state.selection)));
    if (changedStep) live.textContent = state.freePlay ? "Free play. Explore the saved project below." : `${heading.textContent}. Step ${state.index + 1} of ${steps.length}.`;
    else if (previous?.lines !== state.lines && !state.freePlay) live.textContent = step.lines.slice(previous?.lines ?? 0, state.lines).join(" ");
    if (state.why && !previous?.why) get("tour-why-title").focus();
    if (!state.why && previous?.why) whyButton.focus({ preventScroll: true });
    previous = { ...state };
    emit();
  };
  for (const choice of [{ id: "all", title: "Play all" }, ...explainers]) {
    const button = element("button", choice.title);
    button.type = "button"; button.dataset.explainer = choice.id;
    button.addEventListener("click", () => render(tour.select(choice.id as Parameters<typeof tour.select>[0])));
    menu.append(button);
  }
  pause.addEventListener("click", () => render(tour.togglePause()));
  speed.addEventListener("change", () => render(tour.setSpeed(Number(speed.value) as .75 | 1 | 1.5)));
  get("tour-next").addEventListener("click", () => render(tour.next()));
  get("tour-replay").addEventListener("click", () => render(tour.replay()));
  get("tour-skip").addEventListener("click", () => render(tour.skip()));
  everything.addEventListener("click", () => render(tour.toggleEverything()));
  whyButton.addEventListener("click", () => render(tour.toggleWhy()));
  get("tour-why-close").addEventListener("click", () => { if (tour.state.why) render(tour.toggleWhy()); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && tour.state.why && !openingActive) { event.preventDefault(); render(tour.toggleWhy()); }
  });
  window.addEventListener("storytree-tour-request", emit);
  window.addEventListener("storytree-tour-interact", () => { if (!tour.state.paused) render(tour.togglePause()); });
  window.addEventListener("storytree-opening", event => {
    openingActive = (event as CustomEvent<{ active: boolean }>).detail.active;
    clock = performance.now();
  });
  document.addEventListener("visibilitychange", () => { clock = performance.now(); });
  get("tour-hatch").addEventListener("click", event => {
    event.preventDefault();
    const target = document.querySelector<HTMLElement>("#waitlist-form:not([hidden]) #waitlist-email") ?? get("waitlist-title");
    get("waitlist").scrollIntoView({ block: "start", behavior: "instant" });
    target.tabIndex = target.id === "waitlist-email" ? 0 : -1;
    target.focus({ preventScroll: true });
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      root.dataset.tourVisible = String(visible);
      clock = performance.now();
    });
    observer.observe(root);
  } else { visible = true; root.dataset.tourVisible = "true"; }
  const frame = (now: number) => {
    const delta = Math.min(now - clock, 1000);
    clock = now;
    if (visible && !openingActive && !document.hidden) {
      const before = tour.state;
      const after = tour.tick(delta);
      if (after.index !== before.index || after.lines !== before.lines || after.freePlay !== before.freePlay) render(after);
    }
    requestAnimationFrame(frame);
  };
  get("tour-controls").hidden = false;
  menu.hidden = false;
  get("tour-hatch").hidden = false;
  render();
  requestAnimationFrame(frame);
}
