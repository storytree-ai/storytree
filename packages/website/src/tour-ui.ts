import { createTour, groups, type Hold, type TourState, type TourStep } from "./tour.js";
import { groupTitles, steps } from "./tour-copy.js";
import { fill } from "./tour-counts.js";

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
/** What the bar says while the tour waits, most specific first (ADR-0879 D3). */
const waiting: [Hold, string][] = [["reading", "Waiting while you read"], ["exploring", "Waiting while you explore"], ["everything", "Showing everything"], ["paused", "Paused"]];
const playIcon = "M5 3l8 5-8 5z", pauseIcon = "M4 3h3v10H4zM9 3h3v10H9z";
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));

/** The guide works independently of the drawing, including when WebGL is unavailable. */
export function wireTour() {
  const root = document.querySelector<HTMLElement>("#chapter2");
  if (!root || root.dataset.tourReady) return;
  root.dataset.tourReady = "true";
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let counts: Record<string, string> = {};
  try { counts = JSON.parse(document.getElementById("tour-counts")?.textContent ?? "{}") as Record<string, string>; } catch { /* The words keep their placeholders. */ }
  const text = (value: string) => fill(value, counts);
  const tour = createTour(steps);
  const card = get("tour-card"), kicker = get("tour-kicker"), heading = get("tour-title"), lines = get("tour-lines"), chips = get("tour-chips");
  const depthToggle = get<HTMLButtonElement>("tour-depth"), depth = get("tour-why");
  const play = get<HTMLButtonElement>("tour-play"), icon = play.querySelector("path")!;
  const pips = get<HTMLOListElement>("tour-pips"), label = get("tour-label"), held = get("tour-held");
  const everything = get<HTMLButtonElement>("tour-everything"), note = get("tour-note"), live = get("tour-live");
  const speeds = [...document.querySelectorAll<HTMLButtonElement>("#tour-bar [data-speed]")], cycle = get<HTMLButtonElement>("tour-speed-cycle");
  const grouped = groups(steps);
  let previous: TourState | undefined;
  let visible = false;
  let openingActive = !document.getElementById("opening")?.hidden;
  let clock = performance.now();

  // The pips: one per step, grouped by explainer, every one a jump (ADR-0879 D2).
  pips.replaceChildren(...grouped.map(group => {
    const item = element("li", "", "tb-group");
    item.dataset.group = group.explainer;
    item.style.setProperty("--n", String(group.steps.length));
    item.append(...group.steps.map(index => {
      const button = element("button", "", "tb-pip");
      button.type = "button";
      button.dataset.go = String(index);
      button.dataset.step = steps[index]!.id;
      button.title = `${groupTitles[group.explainer]} · ${text(steps[index]!.title)}`;
      button.setAttribute("aria-label", `${groupTitles[group.explainer]}, step ${group.steps.indexOf(index) + 1} of ${group.steps.length}: ${text(steps[index]!.title)}`);
      return button;
    }));
    return item;
  }));
  const pipButtons = [...pips.querySelectorAll<HTMLButtonElement>(".tb-pip")];

  const where = (index: number) => {
    const group = grouped.find(item => item.steps.includes(index))!;
    return { title: groupTitles[group.explainer], at: group.steps.indexOf(index) + 1, of: group.steps.length };
  };
  const drawLines = (step: TourStep) => {
    const kind = step.kind ?? "lines";
    lines.replaceChildren(...step.lines.map((line, index) => {
      const item = element("li", "", kind === "beats" && index === step.lines.length - 1 ? "tour-line coda" : "tour-line");
      if (kind === "principles") {
        item.append(element("span", String(index + 1), "n"), element("b", text(line)), element("span", text(step.notes?.[index] ?? ""), "note"));
      } else {
        item.append(element("span", text(line), "said"));
        const source = step.sources?.[index];
        if (source) {
          const link = element("a", `${source.name} ↗`, "source");
          link.href = source.url; link.rel = "noopener"; link.target = "_blank";
          item.append(" ", link);
        }
      }
      return item;
    }));
  };
  const drawDepth = (step: TourStep) => {
    const title = element("h3", step.kind === "compare" ? "Where these come from" : "Why it exists");
    title.tabIndex = -1;
    const list = element("ul", "", "tour-decisions");
    list.append(...step.decisions.map(decision => {
      const item = element("li");
      item.append(element("span", `ADR-${String(decision.number).padStart(4, "0")}`, "number"), ` ${decision.title}`);
      return item;
    }));
    const back = element("button", "Back to the tour", "tour-back");
    back.type = "button";
    back.addEventListener("click", () => render(tour.release("reading")));
    depth.replaceChildren(title, element("p", text(step.why ?? "")), element("p", "The decisions behind it, from storytree's own decision log:", "tour-decisions-intro"), list, back);
  };

  const render = (state = tour.state) => {
    const step = steps[state.index]!;
    const changedStep = !previous || previous.index !== state.index || previous.generation !== state.generation || previous.freePlay !== state.freePlay;
    const running = tour.running;
    root.dataset.tourMode = state.freePlay ? "freeplay" : "tour";
    root.dataset.tourStep = step.id;
    root.dataset.tourKind = step.kind ?? "lines";
    root.dataset.tourRunning = String(running);
    if (changedStep) {
      const at = where(state.index);
      kicker.textContent = state.freePlay ? "Chapter 2 · Your turn" : step.explainer === "opening" || step.explainer === "ending" ? `Chapter 2 · ${at.title}` : `${at.title} · ${at.at} of ${at.of}`;
      heading.textContent = state.freePlay ? "Your turn." : text(step.title);
      if (state.freePlay) {
        lines.replaceChildren(...["Explore storytree's own project: open an island, the arcs or the library.", "It's a saved reading, so nothing you do changes the project."].map(line => element("li", line, "tour-line on")));
      } else drawLines(step);
      chips.replaceChildren(...(state.freePlay ? [] : step.chips ?? []).map(chip => element("span", chip.text, `chip chip-${chip.kind}`)));
      depthToggle.hidden = state.freePlay || !step.why;
      depthToggle.textContent = step.kind === "compare" ? "Sources and decisions" : `Why it exists · ${step.decisions.length} ${step.decisions.length === 1 ? "decision" : "decisions"}`;
      card.classList.remove("is-in"); void card.offsetWidth; card.classList.add("is-in");
      note.textContent = step.chips?.some(chip => chip.kind === "recording") && !state.freePlay
        ? text("Recording · storytree's activity, {recording}") : text("storytree's own project · saved {saved} · read only");
      label.textContent = state.freePlay ? text("Free play · storytree’s own project, saved {saved} · read only") : `${at.title} · ${at.at} of ${at.of}`;
      pipButtons.forEach((button, index) => {
        button.classList.toggle("done", state.freePlay || index < state.index);
        if (!state.freePlay && index === state.index) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
        button.style.removeProperty("--fill");
      });
      live.textContent = state.freePlay ? "Free play. Explore storytree's own project." : `${heading.textContent} Step ${state.index + 1} of ${steps.length}.`;
    }
    // A step's lines arrive one at a time; a waiting step shows them all (the engine says how many).
    const shown = state.freePlay ? lines.children.length : state.lines;
    [...lines.children].forEach((line, index) => {
      const on = step.kind === "beats" && !state.freePlay
        ? index === shown - 1 || (index === shown - 2 && shown === step.lines.length) : index < shown;
      line.classList.toggle("on", on);
    });
    if (!changedStep && previous && state.lines > previous.lines && !state.freePlay) live.textContent = step.lines.slice(previous.lines, state.lines).map(text).join(" ");
    const reading = state.holds.includes("reading");
    if (reading && !previous?.holds.includes("reading")) { drawDepth(step); depth.hidden = false; depth.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true }); depth.scrollIntoView({ block: "nearest" }); }
    if (!reading && !depth.hidden) { depth.hidden = true; if (document.activeElement && depth.contains(document.activeElement)) depthToggle.focus({ preventScroll: true }); }
    depthToggle.setAttribute("aria-expanded", String(reading));
    const reason = waiting.find(([hold]) => state.holds.includes(hold));
    held.hidden = !reason || state.freePlay;
    held.textContent = reason?.[1] ?? "";
    icon.setAttribute("d", running || state.freePlay ? pauseIcon : playIcon);
    play.setAttribute("aria-label", state.freePlay ? "Replay the tour" : running ? "Pause the tour" : "Play the tour");
    play.dataset.state = running ? "playing" : "waiting";
    speeds.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === state.speed)));
    cycle.textContent = `${state.speed}×`;
    cycle.setAttribute("aria-label", `Tour speed ${state.speed}×, change it`);
    label.hidden = !held.hidden;
    everything.setAttribute("aria-checked", String(state.holds.includes("everything")));
    previous = { ...state };
    window.dispatchEvent(new CustomEvent("storytree-tour", { detail: { step, state, running } }));
  };

  play.addEventListener("click", () => render(tour.state.freePlay ? tour.replay() : tour.togglePlay()));
  speeds.forEach(button => button.addEventListener("click", () => render(tour.setSpeed(Number(button.dataset.speed) as .75 | 1 | 1.5))));
  // A phone has room for one speed button: each tap moves to the next speed.
  cycle.addEventListener("click", () => render(tour.setSpeed(({ .75: 1, 1: 1.5, 1.5: .75 } as const)[tour.state.speed])));
  pips.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-go]");
    if (button) render(tour.go(Number(button.dataset.go)));
  });
  get("tour-next").addEventListener("click", () => render(tour.next()));
  get("tour-replay").addEventListener("click", () => render(tour.replay()));
  get("tour-skip").addEventListener("click", () => render(tour.skip()));
  everything.addEventListener("click", () => render(tour.state.holds.includes("everything") ? tour.release("everything") : tour.hold("everything")));
  depthToggle.addEventListener("click", () => render(tour.state.holds.includes("reading") ? tour.release("reading") : tour.hold("reading")));
  document.addEventListener("keydown", event => {
    if (openingActive || !visible || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return;
    if (event.key === "Escape" && tour.state.holds.includes("reading")) { event.preventDefault(); render(tour.release("reading")); return; }
    if (tour.state.freePlay) return;
    const onControl = event.target instanceof HTMLElement && event.target.closest("button, a, summary, [role='switch']");
    if (event.key === " " && !onControl) { event.preventDefault(); render(tour.togglePlay()); }
    else if (event.key === "ArrowRight") { event.preventDefault(); render(tour.next()); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); render(tour.previous()); }
  });
  // The drawing asks the tour to wait while the visitor explores it, and to let go when a surface it opened closes.
  window.addEventListener("storytree-tour-hold", event => {
    const { reason, held: holding } = (event as CustomEvent<{ reason: Hold; held: boolean }>).detail;
    render(holding ? tour.hold(reason) : tour.release(reason));
  });
  window.addEventListener("storytree-tour-request", () => render());
  window.addEventListener("storytree-opening", event => {
    openingActive = (event as CustomEvent<{ active: boolean }>).detail.active;
    clock = performance.now();
  });
  document.addEventListener("visibilitychange", () => { clock = performance.now(); });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      root.dataset.tourVisible = String(visible);
      clock = performance.now();
    }, { threshold: .35 });
    observer.observe(root);
  } else { visible = true; root.dataset.tourVisible = "true"; }
  const frame = (now: number) => {
    const delta = Math.min(now - clock, 1000);
    clock = now;
    if (visible && !openingActive && !document.hidden) {
      const before = tour.state;
      const after = tour.tick(delta);
      if (after !== before) render(after);
      const current = pipButtons[tour.state.index];
      if (current && !tour.state.freePlay) current.style.setProperty("--fill", tour.progress().toFixed(3));
    }
    requestAnimationFrame(frame);
  };
  get("tour-bar").hidden = false;
  get("tour-hatch").hidden = false;
  render();
  requestAnimationFrame(frame);
}
