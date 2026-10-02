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

async function activate(host: HTMLElement) {
  performance.mark("forest-activate");
  const webgl = hasWebGL();
  host.dataset.forestState = webgl ? "loading" : "still";
  const layer = document.createElement("div");
  layer.className = "forest-canvas";
  host.append(layer);
  let finished = false;
  const fallback = () => {
    finished = true;
    clearTimeout(timeout);
    host.dataset.forestState = "still";
    // The app's text surfaces stay mounted even when the globe cannot draw.
  };
  const timeout = window.setTimeout(fallback, 15_000);
  performance.mark("forest-request");
  try {
    const { mountForest } = await import("./forest-scene.js");
    if (finished) return;
    mountForest(layer, () => {
      if (finished) return;
      clearTimeout(timeout);
      host.dataset.forestState = "live";
      performance.mark("forest-ready");
    }, fallback, webgl);
    if (!webgl) { clearTimeout(timeout); finished = true; }
  } catch {
    fallback();
  }
}

function observe(host: HTMLElement) {
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => void activate(host), { timeout: 1000 });
    else setTimeout(() => void activate(host), 0);
  };
  if (!("IntersectionObserver" in window)) { schedule(); return; }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    schedule();
  });
  observer.observe(host);
}

if (host) {
  // Two animation frames give the completed text page a paint before activation is possible.
  const afterText = () => requestAnimationFrame(() => requestAnimationFrame(() => observe(host)));
  if (document.readyState === "complete") afterText();
  else window.addEventListener("load", afterText, { once: true });
}
