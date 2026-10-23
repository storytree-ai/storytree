/**
 * Capability 1 · Button and composer. One 22px button in the bottom-right corner of the whole app, and the composer it
 * opens: the surface in front named in a chip the owner can correct, his text, the picture of the window, and a Send
 * that says Sent only once the note is written. While a popover or dialog is open the corner moves into it, so it stays
 * above it and a press on it light-dismisses nothing: the surface the note is about stays on show for its picture.
 */
import type { FeedbackBridge } from "../record/bridge.js";
import { surfaceInFront } from "../naming/resolve.js";
import { cornerStyles } from "./styles.js";

export interface FeedbackCorner {
  stop(): void;
}

/** What the page has on show that a note records: the project, and the story node or note selected. */
export interface Shown {
  project?: string | undefined;
  selection?: string | undefined;
}

/**
 * Mount the corner on `document`, once the main process says it is offered here (only where the library holds project
 * storytree); otherwise nothing is mounted.
 */
export function mountFeedbackCorner(document: Document, bridge: FeedbackBridge, options: { shown(): Shown }): FeedbackCorner {
  let stopped = false;
  let stopMounted: (() => void) | undefined;
  void bridge.feedbackSetup().then((setup) => {
    if (stopped || !setup.offered) return;
    stopMounted = mount(document, bridge, setup.surfaces, options.shown);
  }, () => { /* No corner where the setup cannot be read: the app works on without it. */ });
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
      <h2 id="feedback-title">Feedback on this screen</h2>
      <label>On <select data-corner-surface><option value="">Choose the surface…</option></select></label>
      <label>What should change? <textarea data-corner-text></textarea></label>
      <label class="feedback-picture"><input type="checkbox" data-corner-picture> Attach a picture of the window</label>
      <p class="feedback-status" data-corner-status role="status"></p>
      <div class="feedback-actions"><button type="button" data-corner-cancel>Cancel</button><button type="button" data-corner-copy hidden>Copy text</button><button type="button" data-corner-retry hidden>Retry</button><button type="button" data-corner-send>Send</button></div>
    </section>
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
  for (const surface of surfaces) {
    const option = document.createElement("option");
    option.value = surface.id;
    option.textContent = surface.name;
    chip.append(option);
  }
  document.body.append(host);

  let token: string | undefined;
  let opening = false;
  let sending = false;

  /** Into the top-most open popover or dialog, or back onto the page; never while the composer is on show. */
  const place = (): void => {
    if (!composer.hidden) return;
    const open = [...document.querySelectorAll<HTMLElement>(":popover-open, dialog[open]")].filter((layer) => !host.contains(layer));
    const into = open.at(-1) ?? document.body;
    if (host.parentElement !== into) into.append(host);
  };
  const ready = (): void => {
    send.disabled = sending || text.value.trim() === "" || chip.value === "";
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
    if (opening || !composer.hidden) return;
    opening = true;
    try {
      // The surface and the picture are taken first, with nothing of the corner's own on show.
      const surface = surfaceInFront(document);
      token = await bridge.captureForFeedback().catch(() => undefined);
      place();
      chip.value = surface ?? "";
      picture.checked = token !== undefined;
      picture.disabled = token === undefined;
      say(surface === undefined ? "Choose the surface this note is about." : "");
      failedNow(false);
      composer.hidden = false;
      button.setAttribute("aria-expanded", "true");
      ready();
      text.focus();
    } finally {
      opening = false;
    }
  };
  const close = (): void => {
    if (composer.hidden) return;
    composer.hidden = true;
    button.setAttribute("aria-expanded", "false");
    place();
    button.focus();
  };
  const submit = async (): Promise<void> => {
    if (sending || text.value.trim() === "" || chip.value === "") return;
    sending = true;
    ready();
    retry.disabled = true;
    say("Sending…");
    const { project, selection } = shown();
    const note = {
      text: text.value.trim(),
      surface: chip.value,
      ...(project === undefined ? {} : { project }),
      ...(selection === undefined ? {} : { selection }),
      window: { width: window.innerWidth, height: window.innerHeight },
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" as const : "light" as const,
    };
    try {
      await bridge.sendFeedback(note, picture.checked ? token : undefined);
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

  button.addEventListener("click", () => { if (composer.hidden) void open(); else close(); });
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
  // Ahead of the page's own keys (the window hears them before the document): Escape closes the composer and not the
  // menu under it, and Ctrl+Shift+F (Cmd on macOS) opens it from anywhere.
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !composer.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (composer.hidden) void open();
      else text.focus();
    }
  };
  window.addEventListener("keydown", key, true);
  // A popover or dialog opening or closing anywhere on the page: toggle and close do not bubble, so they are heard as
  // they come down to their element.
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
