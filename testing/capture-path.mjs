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
