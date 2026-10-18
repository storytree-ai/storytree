import path from "node:path";

// Lexical containment for local captures. This does not resolve symlinks inside the build root.
export function capturePath(dist, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes("\0")) return { status: 400 };
  const root = path.resolve(dist);
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { status: 403 };
  }
  return { file };
}

// Where capture.mjs writes: the evidence subfolder named by the first word that is not a flag ("scaffold" if none). A run
// with a --verify-* journey is a check, so it writes to a scratch folder and leaves the committed evidence as it was;
// --retake writes the journey's pictures into the evidence folder on purpose.
export function captureOutput(evidence, argv, tmp) {
  const args = argv.slice(2);
  const folder = args.find(arg => !arg.startsWith("--")) ?? "scaffold";
  const check = args.some(arg => arg.startsWith("--verify-")) && !args.includes("--retake");
  return check ? path.join(tmp, "storytree-captures", "website", folder) : path.resolve(evidence, folder);
}

// Which widths and views --verify-own-sheet checks: all four widths and every view, or the one width (--width=390) and the
// one view (--view=everything) named, so a framing guess is judged in seconds. The shop's sheet is checked only on phones.
export function ownSheetScope(argv) {
  const sizes = [[390, 844], [320, 844], [1440, 900], [1280, 800]];
  const views = ["grow", "value", "fixes", "harness", "everything", "freeplay", "shop"];
  const named = flag => argv.find(arg => arg.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  const width = named("width"), view = named("view");
  const chosen = width === undefined ? sizes : sizes.filter(([w]) => String(w) === width);
  if (!chosen.length) throw new Error(`--width=${width} is not one of ${sizes.map(([w]) => w).join(", ")}`);
  if (view !== undefined && !views.includes(view)) throw new Error(`--view=${view} is not one of ${views.join(", ")}`);
  const fit = view === "shop" ? chosen.filter(([w]) => w <= 600) : chosen;
  if (!fit.length) throw new Error(`--view=shop is checked only on phones, not at --width=${width}`);
  return { sizes: fit, views: view === undefined ? undefined : [view] };
}
