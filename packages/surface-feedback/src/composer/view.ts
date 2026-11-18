// Capability 1 · Button and composer
import type { FeedbackAnchor, FeedbackBridge } from "../record/bridge.js";
import { anchorOf, pickableAt, surfaceOf, type Pickable } from "../naming/anchor.js";
import { surfaceInFront } from "../naming/resolve.js";
import { cornerStyles } from "./styles.js";

export interface FeedbackCorner {
  stop(): void;
}

export interface Shown {
  project?: string | undefined;
  selection?: string | undefined;
}

export function mountFeedbackCorner(document: Document, bridge: FeedbackBridge, options: { shown(): Shown }): FeedbackCorner {
  let stopped = false;
  let stopMounted: (() => void) | undefined;
  void bridge.feedbackSetup().then((setup) => {
    if (stopped || !setup.offered) return;
    stopMounted = mount(document, bridge, setup.surfaces, options.shown);
  }, () => {});
  return {
    stop() {
      stopped = true;
      stopMounted?.();
    },
  };
}

function mount(document: Document, bridge: FeedbackBridge, surfaces: readonly { id: string; name: string }[], shown: () => Shown): () => void {
  const window = document.defaultView!;
  const sheet = new window.CSSStyleSheet();
  sheet.replaceSync(cornerStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const host = document.createElement("div");
  host.className = "feedback-corner";
  host.innerHTML = `<section class="feedback-composer" data-corner-composer id="feedback-composer" role="dialog" aria-labelledby="feedback-title" hidden>
      <h2 id="feedback-title">Feedback on what you pointed at</h2>
      <p class="feedback-anchor"><span data-corner-anchor></span> <button type="button" data-corner-repick>Pick again</button></p>
      <label>On <select data-corner-surface><option value="">Choose the surface…</option></select></label>
      <label>What should change? <textarea data-corner-text></textarea></label>
      <label class="feedback-picture"><input type="checkbox" data-corner-picture> Attach pictures of the window and the element</label>
      <p class="feedback-status" data-corner-status role="status"></p>
      <div class="feedback-actions"><button type="button" data-corner-cancel>Cancel</button><button type="button" data-corner-copy hidden>Copy text</button><button type="button" data-corner-retry hidden>Retry</button><button type="button" data-corner-send>Send</button></div>
    </section>
    <div class="feedback-picker" data-corner-picker hidden><div class="feedback-outline" data-corner-outline hidden><span data-corner-label></span></div><p class="feedback-hint">Click what this note is about · Esc to cancel</p></div>
    <button type="button" class="feedback-button" data-corner-button aria-label="Feedback on this screen" title="Feedback on this screen (Ctrl+Shift+F)" aria-controls="feedback-composer" aria-expanded="false">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3h11v7.5H7L4 13v-2.5H2.5z"/></svg>
    </button>`;
  const composer = host.querySelector<HTMLElement>("[data-corner-composer]")!;
  const button = host.querySelector<HTMLButtonElement>("[data-corner-button]")!;
  const chip = host.querySelector<HTMLSelectElement>("[data-corner-surface]")!;
  const text = host.querySelector<HTMLTextAreaElement>("[data-corner-text]")!;
  const picture = host.querySelector<HTMLInputElement>("[data-corner-picture]")!;
  const status = host.querySelector<HTMLElement>("[data-corner-status]")!;
  const send = host.querySelector<HTMLButtonElement>("[data-corner-send]")!;
  const retry = host.querySelector<HTMLButtonElement>("[data-corner-retry]")!;
  const copy = host.querySelector<HTMLButtonElement>("[data-corner-copy]")!;
  const picker = host.querySelector<HTMLElement>("[data-corner-picker]")!;
  const outline = host.querySelector<HTMLElement>("[data-corner-outline]")!;
  const label = host.querySelector<HTMLElement>("[data-corner-label]")!;
  const pointed = host.querySelector<HTMLElement>("[data-corner-anchor]")!;
  for (const surface of surfaces) {
    const option = document.createElement("option");
    option.value = surface.id;
    option.textContent = surface.name;
    chip.append(option);
  }
  document.body.append(host);

  let token: string | undefined;
  let crop: string | undefined;
  let anchor: FeedbackAnchor | undefined;
  let opening = false;
  let sending = false;

  const place = (): void => {
    if (!composer.hidden || !picker.hidden) return;
    const open = [...document.querySelectorAll<HTMLElement>(":popover-open, dialog[open]")].filter((layer) => !host.contains(layer));
    const into = open.at(-1) ?? document.body;
    if (host.parentElement !== into) into.append(host);
  };
  const ready = (): void => {
    send.disabled = sending || text.value.trim() === "" || chip.value === "" || anchor === undefined;
  };
  const say = (words: string, failed = false): void => {
    status.textContent = words;
    status.toggleAttribute("data-failed", failed);
  };
  const failedNow = (on: boolean): void => {
    retry.hidden = !on;
    copy.hidden = !on;
    send.hidden = on;
  };

  const open = async (): Promise<void> => {
    if (opening || !composer.hidden || !picker.hidden) return;
    opening = true;
    try {
      token = await bridge.captureForFeedback().catch(() => undefined);
      place();
      startPicking();
    } finally {
      opening = false;
    }
  };
  const startPicking = (): void => {
    composer.hidden = true;
    outline.hidden = true;
    picker.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  const hover = (x: number, y: number): Pickable | undefined => {
    const picked = pickableAt(document, x, y, host);
    const target = picked?.element;
    outline.hidden = picked === undefined;
    if (picked !== undefined && target !== undefined) {
      const box = picked.drawn?.box ?? target.getBoundingClientRect();
      Object.assign(outline.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
      outline.toggleAttribute("data-below", box.y < 24);
      outline.toggleAttribute("data-right", box.x + box.width / 2 > window.innerWidth / 2);
      const role = target.getAttribute("role");
      label.textContent = picked.drawn === undefined
        ? `${target.tagName.toLowerCase()}${role === null ? "" : ` · ${role}`} · ${Math.round(box.width)}×${Math.round(box.height)}`
        : `${picked.drawn.kind} · ${picked.drawn.name}`;
    }
    return picked;
  };
  const pick = async ({ element: target, drawn }: Pickable): Promise<void> => {
    opening = true;
    try {
      anchor = anchorOf(target, drawn);
      const surface = surfaceOf(target) ?? surfaceInFront(document);
      picker.hidden = true;
      await new Promise((done) => window.requestAnimationFrame(() => window.requestAnimationFrame(done)));
      crop = token === undefined ? undefined : await bridge.captureForFeedback(anchor.box).catch(() => undefined);
      chip.value = surface ?? "";
      pointed.textContent = drawn === undefined ? `${anchor.tag}${anchor.name === undefined ? "" : ` “${anchor.name}”`}` : `${drawn.kind} “${drawn.name}”`;
      picture.checked = token !== undefined;
      picture.disabled = token === undefined;
      say(surface === undefined ? "Choose the surface this note is about." : "");
      failedNow(false);
      composer.hidden = false;
      ready();
      text.focus();
    } finally {
      opening = false;
    }
  };
  const cancelPick = (): void => {
    picker.hidden = true;
    if (anchor !== undefined) {
      composer.hidden = false;
      text.focus();
      return;
    }
    button.setAttribute("aria-expanded", "false");
    place();
    button.focus();
  };
  const close = (): void => {
    if (composer.hidden) return;
    composer.hidden = true;
    anchor = undefined;
    button.setAttribute("aria-expanded", "false");
    place();
    button.focus();
  };
  const submit = async (): Promise<void> => {
    if (sending || text.value.trim() === "" || chip.value === "" || anchor === undefined) return;
    sending = true;
    ready();
    retry.disabled = true;
    say("Sending…");
    const { project, selection } = shown();
    const note = {
      text: text.value.trim(),
      surface: chip.value,
      anchor,
      ...(project === undefined ? {} : { project }),
      ...(selection === undefined ? {} : { selection }),
      window: { width: window.innerWidth, height: window.innerHeight },
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" as const : "light" as const,
    };
    try {
      await bridge.sendFeedback(note, picture.checked ? token : undefined, picture.checked ? crop : undefined);
      text.value = "";
      failedNow(false);
      say("Sent");
    } catch (error) {
      failedNow(true);
      say(`Not sent: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      sending = false;
      retry.disabled = false;
      ready();
    }
  };

  button.addEventListener("click", () => {
    if (opening) return;
    if (!picker.hidden) cancelPick();
    else if (composer.hidden) void open();
    else close();
  });
  host.querySelector("[data-corner-repick]")!.addEventListener("click", startPicking);
  picker.addEventListener("mousemove", (event) => { hover(event.clientX, event.clientY); });
  picker.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = hover(event.clientX, event.clientY);
    if (target !== undefined) void pick(target);
  });
  host.querySelector("[data-corner-cancel]")!.addEventListener("click", close);
  send.addEventListener("click", () => void submit());
  retry.addEventListener("click", () => void submit());
  copy.addEventListener("click", () => {
    void Promise.resolve().then(() => window.navigator.clipboard.writeText(text.value)).then(
      () => say("Copied. Not sent yet: Retry, or paste it elsewhere."),
      () => { text.select(); say("Could not copy: the text is selected, so copy it yourself.", true); },
    );
  });
  text.addEventListener("input", () => { if (!sending) say(""); ready(); });
  chip.addEventListener("change", ready);
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !picker.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      cancelPick();
      return;
    }
    if (event.key === "Escape" && !composer.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (!picker.hidden) return;
      if (composer.hidden) void open();
      else text.focus();
    }
  };
  window.addEventListener("keydown", key, true);
  document.addEventListener("toggle", place, true);
  document.addEventListener("close", place, true);

  return () => {
    window.removeEventListener("keydown", key, true);
    document.removeEventListener("toggle", place, true);
    document.removeEventListener("close", place, true);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
    host.remove();
  };
}
