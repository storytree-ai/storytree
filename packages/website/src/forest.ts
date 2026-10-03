/** The page and its still work before this small entry asks for React or the drawing engine. */
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
  const schedule = (early = false) => {
    if (scheduled || (!early && openingVisible())) return;
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
    if ((event as CustomEvent<{ active: boolean }>).detail.active) {
      generation++;
      scheduled = false;
      stop?.(); stop = undefined;
    } else schedule();
  });
  const check = () => {
    const box = host.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) schedule();
  };
  window.addEventListener("scroll", check, { passive: true });
  window.addEventListener("resize", check);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(check).observe(host);
    // A visitor who pressed Run meets the globe about twenty seconds later, so it starts below the fold, where it draws
    // nothing (world 6.10), once every helper waits on the visitor: its setup stalls nothing that moves, and the turn
    // lands on it live. Without IntersectionObserver it could not tell it is off screen, so there it waits.
    window.addEventListener("storytree-opening-quiet", () => schedule(true));
  }
  check();
}

if (host) {
  // Two animation frames give the completed text page a paint before activation is possible.
  const afterText = () => requestAnimationFrame(() => requestAnimationFrame(() => observe(host)));
  if (document.readyState === "complete") afterText();
  else window.addEventListener("load", afterText, { once: true });
}
