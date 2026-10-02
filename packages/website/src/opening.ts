import { AGENTS, BANNER, EXTRA, FINALE, FINALE_AGAIN, THINK } from "./opening-copy.js";

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
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const timers = new Set<number>();
  const initialAgents = agents.innerHTML;
  let enabled = false;
  let audio: AudioContext | undefined;
  let count = 1;
  let waiting = 0;
  let round = 0;
  const later = (ms: number, action: () => void) => {
    const id = window.setTimeout(() => { timers.delete(id); action(); }, ms);
    timers.add(id);
  };
  const stop = () => { timers.forEach(clearTimeout); timers.clear(); };
  const tone = (frequency = 480) => {
    if (!enabled || !audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.025, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + .08);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + .09);
  };
  const counter = () => { get("opening-count").textContent = `${count} agents · ${waiting} waiting on you · 0 answered`; };
  const lines = (element: HTMLElement) => element.querySelector<HTMLElement>(".opening-lines")!;
  const append = (element: HTMLElement, text: string, demand = false) => {
    const p = document.createElement("p");
    p.textContent = text.replace(/^[!+] /, "");
    if (demand) p.className = "opening-demand";
    else if (text.startsWith("!")) p.className = "opening-warning";
    else if (text.startsWith("+")) p.className = "opening-good";
    lines(element).append(p);
  };
  const park = (element: HTMLElement, text: string) => {
    append(element, text, true);
    element.querySelector("header span")!.textContent = "waiting on you";
    waiting++; counter(); tone(330);
  };
  const remember = () => { try { localStorage.setItem("storytree-opening-seen", "yes"); } catch { /* Storage is optional. */ } };
  const leave = (move = true, bloom = false) => {
    stop(); remember(); root.hidden = true;
    enabled = false; sound.textContent = "Sound off"; sound.setAttribute("aria-pressed", "false");
    if (audio) { void audio.close().catch(() => {}); audio = undefined; }
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
    root.dataset.phase = "peak"; finale.hidden = false; lines(finale).replaceChildren();
    better.hidden = true; joke.hidden = true;
    copy.forEach((line, i) => {
      const show = () => append(finale, line.replaceAll("{N}", String(count)));
      if (instant) show(); else later(i * 750, show);
    });
    const actions = () => { better.hidden = false; joke.hidden = false; joke.textContent = round ? "Restart chapter 1" : "I'll keep babysitting"; };
    if (instant) actions(); else later(copy.length * 750, actions);
  };
  const reset = () => {
    root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    stop(); root.hidden = false; root.dataset.phase = reduced.matches ? "peak" : "ready";
    window.dispatchEvent(new CustomEvent("storytree-opening", { detail: { active: true } }));
    agents.innerHTML = initialAgents; round = 0; count = 1; waiting = 0;
    run.hidden = reduced.matches; run.disabled = false;
    if (reduced.matches) { count = 12; waiting = 12; showFinale(FINALE, true); }
    else {
      finale.hidden = true; lines(lead).replaceChildren(); BANNER.forEach(line => append(lead, line));
      lead.querySelector("header span")!.textContent = "idle";
      agents.querySelectorAll<HTMLElement>(".opening-agent").forEach(agent => { agent.hidden = true; lines(agent).replaceChildren(); });
    }
    counter();
  };
  run.addEventListener("click", () => {
    if (root.dataset.phase !== "ready") return;
    root.dataset.phase = "running"; run.disabled = true;
    lines(lead).replaceChildren(); lead.querySelector("header span")!.textContent = "thinking";
    THINK.forEach((line, i) => later(200 + i * 260, () => append(lead, line.replace("{P}", "Build me a shopping website"))));
    AGENTS.forEach((agent, i) => {
      const window = agents.querySelector<HTMLElement>(`[data-agent="${i}"]`)!;
      const spawn = 1800 + i * 900;
      const parent = i < 2 ? lead : agents.querySelector<HTMLElement>(`[data-agent="${Math.floor((i - 2) / 2)}"]`)!;
      later(spawn - 200, () => append(parent, `⇒ spawning helper: ${agent.n}`));
      later(spawn, () => { window.hidden = false; window.querySelector("header span")!.textContent = "running"; count++; counter(); tone(); });
      agent.l.forEach((line, j) => later(spawn + 500 + j * 650, () => append(window, line)));
      later(spawn + 3200, () => park(window, agent.d));
    });
    later(15000, () => park(lead, "awaiting instructions"));
    later(16750, () => showFinale(FINALE));
  });
  joke.addEventListener("click", () => {
    if (round) { reset(); return; }
    round++; finale.hidden = true; root.dataset.phase = "running";
    EXTRA.forEach((agent, i) => {
      const spawn = () => {
        const window = document.createElement("article");
        window.className = "opening-window opening-agent";
        window.style.cssText = `--x:${10 + i * 27}%;--y:${14 + i * 17}%;--color:#a48be0`;
        const header = document.createElement("header"); header.textContent = agent.n;
        const status = document.createElement("span"); status.textContent = "running"; header.append(status);
        const body = document.createElement("div"); body.className = "opening-lines"; window.append(header, body); agents.append(window);
        count++; append(window, agent.l); park(window, agent.d);
      };
      if (reduced.matches) spawn(); else later(300 + i * 850, spawn);
    });
    if (reduced.matches) showFinale(FINALE_AGAIN, true); else later(3000, () => showFinale(FINALE_AGAIN));
  });
  better.addEventListener("click", () => {
    if (reduced.matches) { leave(); return; }
    stop(); root.dataset.phase = "turn";
    const stage = root.querySelector(".opening-stage")!.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>(".opening-window").forEach((window, i) => {
      const box = window.getBoundingClientRect();
      const transform = getComputedStyle(window).transform;
      const base = transform === "none" ? "" : transform;
      window.animate([{ transform, opacity: 1 }, { transform: `${base} translate(${stage.x + stage.width / 2 - box.x - box.width / 2}px, ${stage.y + stage.height / 2 - box.y - box.height / 2}px) scale(.015)`, opacity: 0 }], { duration: 700, delay: i * 20, fill: "forwards", easing: "cubic-bezier(.6,0,.8,.4)" });
    });
    later(1050, () => leave(true, true));
  });
  sound.addEventListener("click", () => {
    enabled = !enabled;
    sound.textContent = enabled ? "Sound on" : "Sound off"; sound.setAttribute("aria-pressed", String(enabled));
    if (enabled) { try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { enabled = false; sound.textContent = "Sound unavailable"; sound.setAttribute("aria-pressed", "false"); } }
  });
  skip.addEventListener("click", () => leave());
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !root.hidden) leave(); });
  window.addEventListener("scroll", () => { if (!root.hidden && root.getBoundingClientRect().bottom <= 0) leave(false); }, { passive: true });
  replay.addEventListener("click", () => { reset(); root.scrollIntoView({ behavior: "instant" }); (reduced.matches ? better : run).focus({ preventScroll: true }); });
  reduced.addEventListener("change", () => { if (!root.hidden) reset(); });
  get("opening-static-exit").hidden = true; sound.hidden = false; skip.hidden = false; replay.hidden = false;
  let seen = false;
  try { seen = localStorage.getItem("storytree-opening-seen") === "yes"; } catch { /* Storage is optional. */ }
  reset();
  if (seen && !location.hash) leave();
}
