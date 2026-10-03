import { AGENTS, BANNER, EXTRA, FINALE, FINALE_AGAIN, THINK } from "./opening-copy.js";
import { createOpeningAudio } from "./opening-audio.js";
import { OPENING_PROMPT, lineClass, lineText } from "./opening-lines.js";
import { OPENING_SEED, mulberry32 } from "./opening-seed.js";

// ADR-0879 D6: chapter 1 is storytree 0.2's green-phosphor CRT. A window powers off like a tube losing its picture.
const POWER_OFF: Keyframe[] = [
  { scale: "1 1", filter: "brightness(1)", opacity: 1 },
  { offset: 0.3, scale: "1.02 .55", filter: "brightness(2.6)", opacity: 1 },
  { scale: "1 .04", filter: "brightness(3)", opacity: 0 },
];
// Where the three agents the joke adds appear, as [column, row] on the 4-column and 3-column grids.
const EXTRA_SLOTS = [[0.55, 1.3, 0.5, 1.35], [1.7, 0.4, 1.4, 0.45], [2.6, 1.45, 1.8, 2.4]] as const;

export function wireOpening() {
  const root = document.querySelector<HTMLElement>("#opening");
  const globe = document.querySelector<HTMLElement>("#website-forest");
  if (!root || !globe) return;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const run = get<HTMLButtonElement>("opening-run");
  const sound = get<HTMLButtonElement>("opening-sound");
  const skip = get<HTMLButtonElement>("opening-skip");
  const better = get<HTMLButtonElement>("opening-better");
  const joke = get<HTMLButtonElement>("opening-joke");
  const lead = get("opening-lead");
  const finale = get("opening-finale");
  const agents = get("opening-agents");
  const replay = get<HTMLButtonElement>("opening-replay");
  const screen = root.querySelector<HTMLElement>(".opening-screen")!;
  const crtLine = get("opening-crt-line");
  const crtDot = get("opening-crt-dot");
  const countEl = get("opening-count");
  const [agentsCount, waitingCount, answeredCount] = [...countEl.querySelectorAll<HTMLElement>("span")] as [HTMLElement, HTMLElement, HTMLElement];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const timers = new Set<number>();
  const initialAgents = agents.innerHTML;
  const audio = createOpeningAudio();
  let typing = mulberry32(OPENING_SEED ^ 0x7e57);
  let enabled = false;
  let count = 1;
  let waiting = 0;
  let round = 0;
  let turnId = 0;
  const later = (ms: number, action: () => void) => {
    const id = window.setTimeout(() => { timers.delete(id); action(); }, ms);
    timers.add(id);
  };
  const stop = () => { timers.forEach(clearTimeout); timers.clear(); };

  // Sound is off until the visitor turns it on.
  const detune = (element: HTMLElement) => (Number(element.dataset.agent ?? 3) * 0.37) % 1;
  const sfx = {
    tick: (element: HTMLElement) => { if (enabled) audio.tick(detune(element)); },
    blip: () => { if (enabled) audio.blip(); },
    bell: (element: HTMLElement) => { if (enabled) audio.bell(detune(element)); },
  };

  // The arcade counter: two digits, an arrow once there is more than one agent, a pulse on each change.
  const pad = (n: number) => String(n).padStart(2, "0");
  const show = (element: HTMLElement, text: string) => {
    if (element.textContent === text) return;
    element.textContent = text;
    element.classList.remove("tick"); void element.offsetWidth; element.classList.add("tick");
  };
  const counter = () => {
    show(agentsCount, `AGENTS: ${pad(count)}${count > 1 ? " ▲" : ""}`);
    show(waitingCount, `WAITING ON YOU: ${pad(waiting)}`);
    show(answeredCount, "ANSWERED: 00");
  };

  const lines = (element: HTMLElement) => element.querySelector<HTMLElement>(".opening-lines")!;
  const status = (element: HTMLElement, text: string) => { element.querySelector(".term-status")!.textContent = text; };
  const cursor = () => { const span = document.createElement("span"); span.className = "term-cursor"; span.setAttribute("aria-hidden", "true"); span.textContent = "▌"; return span; };
  const powerOn = (element: HTMLElement) => {
    if (reduced.matches) return;
    element.classList.remove("is-new"); void element.offsetWidth; element.classList.add("is-new");
  };
  // On a phone the windows pile up like notifications: the newest on top, older ones dimmer.
  const age = () => {
    const open = [...root.querySelectorAll<HTMLElement>(".opening-agent")].filter(window => !window.hidden);
    open.forEach((window, i) => window.style.setProperty("--age", String(open.length - 1 - i)));
  };
  // A streamed line arrives in one to three chunks, 60-160 ms apart.
  const type = (p: HTMLElement, text: string, element: HTMLElement) => {
    const words = text.split(" ");
    const chunks = Math.min(words.length, 1 + Math.floor(typing() * 3));
    let delay = 0;
    for (let k = 0; k < chunks; k++) {
      const end = k === chunks - 1 ? text.length : words.slice(0, Math.ceil(words.length * (k + 1) / chunks)).join(" ").length;
      const reveal = () => { p.textContent = text.slice(0, end); sfx.tick(element); };
      if (k === 0) reveal(); else { delay += 60 + typing() * 100; later(delay, reveal); }
    }
  };
  const append = (element: HTMLElement, text: string, options: { stream?: boolean; kind?: string } = {}) => {
    const p = document.createElement("p");
    const kind = [lineClass(text), options.kind].filter(Boolean).join(" ");
    if (kind) p.className = kind;
    // A parked window always ends on its demand: later lines go above it.
    const demand = lines(element).querySelector(".opening-demand");
    if (demand) demand.before(p); else lines(element).append(p);
    if (options.stream && !reduced.matches) type(p, lineText(text), element); else p.textContent = lineText(text);
  };
  const park = (element: HTMLElement, text: string) => {
    const p = document.createElement("p");
    p.className = "opening-demand"; p.append(`${text} `, cursor());
    lines(element).append(p);
    element.classList.add("is-parked"); status(element, "waiting on you");
    waiting++; counter(); sfx.bell(element);
  };

  // The grain: four pre-rendered noise frames drawn at half size, stopped while chapter 1 is hidden or off screen.
  const grain = root.querySelector<HTMLCanvasElement>(".opening-grain")!;
  const grainContext = grain.getContext("2d");
  let frames: HTMLCanvasElement[] | undefined;
  let grainHandle = 0;
  let grainStep = 0;
  let grainIndex = 0;
  let onScreen = true;
  const sizeGrain = () => { grain.width = Math.max(320, Math.floor(innerWidth / 2)); grain.height = Math.max(200, Math.floor(innerHeight / 2)); };
  const noiseFrames = () => {
    const random = mulberry32(OPENING_SEED ^ 0x00611a1);
    return [0, 1, 2, 3].map(() => {
      const frame = document.createElement("canvas"); frame.width = 480; frame.height = 300;
      const context = frame.getContext("2d")!;
      const image = context.createImageData(480, 300);
      for (let i = 0; i < image.data.length; i += 4) { const v = 60 + Math.floor(random() * 170); image.data[i] = v; image.data[i + 1] = v; image.data[i + 2] = v; image.data[i + 3] = 255; }
      context.putImageData(image, 0, 0);
      return frame;
    });
  };
  const paintGrain = () => {
    grainHandle = requestAnimationFrame(paintGrain);
    if (!grainContext || !frames) return;
    if (++grainStep % 3 === 0) grainIndex = (grainIndex + 1) % frames.length;
    grainContext.clearRect(0, 0, grain.width, grain.height);
    grainContext.globalAlpha = 0.055; grainContext.imageSmoothingEnabled = false;
    grainContext.drawImage(frames[grainIndex]!, 0, 0, grain.width, grain.height);
  };
  const syncGrain = () => {
    const wanted = Boolean(grainContext) && !reduced.matches && !root.hidden && onScreen && !document.hidden;
    if (wanted && !grainHandle) { sizeGrain(); frames ??= noiseFrames(); grainHandle = requestAnimationFrame(paintGrain); }
    if (!wanted && grainHandle) { cancelAnimationFrame(grainHandle); grainHandle = 0; grainContext?.clearRect(0, 0, grain.width, grain.height); }
  };
  if ("IntersectionObserver" in window) new IntersectionObserver(entries => { onScreen = entries[entries.length - 1]!.isIntersecting; syncGrain(); }).observe(root);
  document.addEventListener("visibilitychange", syncGrain);
  window.addEventListener("resize", () => { if (grainHandle) sizeGrain(); });

  const remember = () => { try { localStorage.setItem("storytree-opening-seen", "yes"); } catch { /* Storage is optional. */ } };
  const endTurn = () => {
    turnId++;
    delete root.dataset.crt; crtLine.hidden = true; crtDot.hidden = true;
    root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  };
  const leave = (move = true, bloom = false) => {
    endTurn(); stop(); remember(); root.hidden = true;
    enabled = false; audio.close(); sound.textContent = "sound off"; sound.setAttribute("aria-pressed", "false");
    syncGrain();
    replay.hidden = false;
    window.dispatchEvent(new CustomEvent("storytree-opening", { detail: { active: false } }));
    if (move) {
      const destination = document.getElementById("chapter2") ?? globe;
      destination.scrollIntoView({ block: "start", behavior: "instant" });
      destination.tabIndex = -1; destination.focus({ preventScroll: true });
    }
    // Reveal without transforming a canvas ancestor: the renderer measures its host.
    if (bloom && !reduced.matches) globe.animate([{ clipPath: "circle(0% at 50% 50%)", opacity: 0 }, { clipPath: "circle(75% at 50% 50%)", opacity: 1 }], { duration: 900, easing: "cubic-bezier(.2,.7,.2,1)" });
  };
  const showFinale = (copy: string[], instant = false) => {
    root.dataset.phase = "peak"; finale.hidden = false; lines(finale).replaceChildren(); powerOn(finale);
    better.hidden = true; joke.hidden = true;
    copy.forEach((line, i) => {
      const show = () => append(finale, line.replaceAll("{N}", String(count)), { stream: !instant });
      if (instant) show(); else later(i * 750, show);
    });
    const actions = () => { better.hidden = false; joke.hidden = false; joke.textContent = round ? "restart chapter 1" : "i'll keep babysitting"; };
    if (instant) actions(); else later(copy.length * 750, actions);
  };
  const reset = () => {
    endTurn(); stop(); typing = mulberry32(OPENING_SEED ^ 0x7e57);
    root.hidden = false; root.dataset.phase = reduced.matches ? "peak" : "ready";
    window.dispatchEvent(new CustomEvent("storytree-opening", { detail: { active: true } }));
    agents.innerHTML = initialAgents; round = 0; count = 1; waiting = 0;
    run.hidden = reduced.matches; run.disabled = false;
    lines(lead).replaceChildren(); BANNER.forEach(line => append(lead, line, { kind: "is-banner" }));
    if (reduced.matches) {
      count = 12; waiting = 12; countEl.hidden = false; lead.classList.add("is-parked"); status(lead, "waiting on you");
      counter(); showFinale(FINALE, true);
    } else {
      countEl.hidden = true; finale.hidden = true; lead.classList.remove("is-parked"); status(lead, "idle");
      agents.querySelectorAll<HTMLElement>(".opening-agent").forEach(agent => { agent.hidden = true; agent.classList.remove("is-parked"); lines(agent).replaceChildren(); status(agent, "running"); });
      counter();
    }
    syncGrain();
  };
  run.addEventListener("click", () => {
    if (root.dataset.phase !== "ready") return;
    root.dataset.phase = "running"; run.disabled = true;
    count = 1; waiting = 0; countEl.hidden = false; counter();
    lines(lead).replaceChildren(); append(lead, `~/shop $ ${OPENING_PROMPT}`, { kind: "is-cmd" });
    status(lead, "thinking"); powerOn(lead);
    THINK.forEach((line, i) => later(200 + i * 260, () => append(lead, line.replace("{P}", OPENING_PROMPT), { stream: true })));
    AGENTS.forEach((agent, i) => {
      const window = agents.querySelector<HTMLElement>(`[data-agent="${i}"]`)!;
      const spawn = 1800 + i * 900;
      const parent = i < 2 ? lead : agents.querySelector<HTMLElement>(`[data-agent="${Math.floor((i - 2) / 2)}"]`)!;
      later(spawn - 200, () => append(parent, `⇒ spawning helper: ${agent.n}`, { kind: "is-spawn" }));
      later(spawn, () => { window.hidden = false; powerOn(window); status(window, "running"); count++; counter(); age(); sfx.blip(); });
      agent.l.forEach((line, j) => later(spawn + 500 + j * 650, () => append(window, line, { stream: true })));
      later(spawn + 3200, () => park(window, agent.d));
    });
    later(15000, () => park(lead, "awaiting instructions"));
    later(16750, () => showFinale(FINALE));
  });
  const extraWindow = (agent: (typeof EXTRA)[number], i: number) => {
    const [c4, r4, c3, r3] = EXTRA_SLOTS[i]!;
    const window = document.createElement("article");
    window.className = `opening-window opening-agent${i === 1 ? " ph-amber" : ""}`;
    window.style.cssText = `--i:${AGENTS.length + i};--c4:${c4};--r4:${r4};--c3:${c3};--r3:${r3};--jx:0px;--jy:0px`;
    window.dataset.agent = String(AGENTS.length + i);
    const header = document.createElement("header");
    const dots = document.createElement("span"); dots.className = "term-dots"; dots.setAttribute("aria-hidden", "true"); dots.textContent = "● ● ●";
    const name = document.createElement("span"); name.className = "term-name"; name.textContent = agent.n;
    const state = document.createElement("span"); state.className = "term-status"; state.textContent = "running";
    header.append(dots, name, state);
    const body = document.createElement("div"); body.className = "opening-lines";
    window.append(header, body); agents.append(window);
    powerOn(window); age(); sfx.blip(); count++; counter(); append(window, agent.l, { stream: true });
    if (reduced.matches) park(window, agent.d); else later(500, () => park(window, agent.d));
  };
  joke.addEventListener("click", () => {
    if (round) { reset(); (reduced.matches ? better : run).focus({ preventScroll: true }); return; }
    round++; finale.hidden = true; root.dataset.phase = "running";
    EXTRA.forEach((agent, i) => {
      if (reduced.matches) {
        extraWindow(agent, i);
      } else later(300 + i * 850, () => extraWindow(agent, i));
    });
    if (reduced.matches) showFinale(FINALE_AGAIN, true); else later(3000, () => showFinale(FINALE_AGAIN));
  });
  // The turn: the windows power off one after another, then the whole screen collapses like an old CRT
  // switching off (a bright line, a point, a fading glow), and the globe grows out of that point.
  // Every step is an animation on one schedule, so a slow frame never stretches the turn, and cancelling
  // one cancels all.
  const beat = (ms: number) => root.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Math.max(1, ms) }).finished;
  better.addEventListener("click", async () => {
    if (reduced.matches) { leave(); return; }
    if (root.dataset.phase === "turn") return;
    stop(); root.dataset.phase = "turn";
    const id = ++turnId;
    root.scrollIntoView({ block: "start", behavior: "instant" });
    const open = [...root.querySelectorAll<HTMLElement>(".opening-window")].filter(window => !window.hidden);
    const gap = Math.min(40, 400 / Math.max(1, open.length - 1));
    const collapse = (open.length - 1) * gap; // the last window has started powering off
    open.forEach((window, i) => window.animate(POWER_OFF, { duration: 500, delay: i * gap, fill: "both", easing: "cubic-bezier(.55,0,.75,.4)" }));
    crtLine.hidden = false; crtDot.hidden = false;
    const squash = screen.animate([
      { transform: "scale(1, 1)", filter: "brightness(1)", opacity: 1 },
      { offset: 0.55, transform: "scale(1, .03)", filter: "brightness(2.4)", opacity: 1 },
      { transform: "scale(1, .003)", filter: "brightness(3)", opacity: 0 },
    ], { delay: collapse, duration: 250, easing: "cubic-bezier(.7,0,.85,.4)", fill: "forwards", id: "crt-squash" });
    crtLine.animate([{ opacity: 0 }, { opacity: 1 }], { delay: collapse, duration: 250, fill: "forwards", id: "crt-line" });
    crtLine.animate([
      { opacity: 1, left: "0px", right: "0px" },
      { offset: 0.97, opacity: 1, left: "calc(50% - 4px)", right: "calc(50% - 4px)" },
      { opacity: 0, left: "calc(50% - 4px)", right: "calc(50% - 4px)" },
    ], { delay: collapse + 250, duration: 200, easing: "cubic-bezier(.6,0,.9,.5)", fill: "forwards", id: "crt-point" });
    const glow = crtDot.animate([{ opacity: 1, transform: "translate(-50%, -50%) scale(1)" }, { opacity: 0, transform: "translate(-50%, -50%) scale(3.2)" }], { delay: collapse + 450, duration: 250, easing: "ease-out", fill: "forwards", id: "crt-glow" });
    const mark = (phase: string) => () => { if (id === turnId) root.dataset.crt = phase; };
    void beat(collapse).then(mark("line")).catch(() => {});
    void squash.finished.then(mark("point")).catch(() => {});
    try { await glow.finished; } catch { return; /* A reset or an exit cancelled the turn. */ }
    if (id === turnId) leave(true, true);
  });
  sound.addEventListener("click", () => {
    if (enabled) { enabled = false; audio.setOn(false); }
    else {
      try { audio.unlock(); audio.setOn(true); enabled = true; }
      catch { sound.textContent = "sound unavailable"; sound.setAttribute("aria-pressed", "false"); return; }
    }
    sound.textContent = enabled ? "sound on" : "sound off"; sound.setAttribute("aria-pressed", String(enabled));
  });
  skip.addEventListener("click", () => leave());
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !root.hidden) leave(); });
  window.addEventListener("scroll", () => { if (!root.hidden && root.getBoundingClientRect().bottom <= 0) leave(false); }, { passive: true });
  replay.addEventListener("click", () => { reset(); root.scrollIntoView({ behavior: "instant" }); (reduced.matches ? better : run).focus({ preventScroll: true }); });
  reduced.addEventListener("change", () => { if (!root.hidden) reset(); else syncGrain(); });
  get("opening-static-exit").hidden = true; sound.hidden = false; skip.hidden = false; replay.hidden = false;
  let seen = false;
  try { seen = localStorage.getItem("storytree-opening-seen") === "yes"; } catch { /* Storage is optional. */ }
  reset();
  if (seen && !location.hash) leave();
}
