/** Capability 2 · The forest on the site. The page and its still work before this small entry asks for React or the drawing engine. */
const host = document.querySelector<HTMLElement>("#website-forest");

function hasWebGL(): boolean {
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function activate(host: HTMLElement): () => void {
  performance.mark("forest-activate");
  const webgl = hasWebGL();
  host.dataset.forestState = webgl ? "loading" : "still";
  const layer = document.createElement("div");
  layer.className = "forest-canvas";
  host.append(layer);
  let finished = false;
  let unmount: (() => void) | undefined;
  const fallback = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    host.dataset.forestState = "still";
    // The app's text surfaces stay mounted even when the globe cannot draw.
  };
  const timeout = window.setTimeout(fallback, 15_000);
  performance.mark("forest-request");
  void import("./forest-scene.js").then(({ mountForest }) => {
    if (finished) return;
    unmount = mountForest(layer, () => {
      if (finished) return;
      clearTimeout(timeout);
      host.dataset.forestState = "live";
      performance.mark("forest-ready");
    }, fallback, webgl);
    if (!webgl) { clearTimeout(timeout); finished = true; }
  }).catch(fallback);
  return () => {
    finished = true;
    clearTimeout(timeout);
    unmount?.();
    layer.remove();
    host.dataset.forestState = "still";
  };
}

function observe(host: HTMLElement) {
  let scheduled = false;
  let generation = 0;
  let stop: (() => void) | undefined;
  const opening = document.getElementById("opening");
  const openingVisible = () => opening && !opening.hidden && opening.getBoundingClientRect().bottom > 0;
  // Act 1 loads nothing of the globe. After the hand-over it waits for Act 2's first words, so its setup stalls
  // only a screen of still text (2.10); a slow or missing tour lets it start anyway.
  let awaitingWords = false;
  const schedule = () => {
    if (scheduled || awaitingWords || openingVisible()) return;
    scheduled = true;
    const requested = generation;
    const start = () => {
      if (requested !== generation) return;
      stop = activate(host);
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 1000 });
    else setTimeout(start, 0);
  };
  // Run belongs to the terminal: a globe merely touching the fold waits for the handover.
  window.addEventListener("storytree-opening", event => {
    if (event.detail.active) {
      generation++;
      scheduled = false; awaitingWords = false;
      stop?.(); stop = undefined;
    } else {
      const requested = generation;
      awaitingWords = true;
      const start = () => { if (requested !== generation || !awaitingWords) return; awaitingWords = false; schedule(); };
      window.addEventListener("storytree-arrived", start, { once: true });
      setTimeout(start, 4000);
    }
  });
  const check = () => {
    const box = host.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) schedule();
  };
  window.addEventListener("scroll", check, { passive: true });
  window.addEventListener("resize", check);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(check).observe(host);
  }
  check();
}

if (host) {
  // Two animation frames give the completed text page a paint before activation is possible.
  const afterText = () => requestAnimationFrame(() => requestAnimationFrame(() => observe(host)));
  if (document.readyState === "complete") afterText();
  else window.addEventListener("load", afterText, { once: true });
}
