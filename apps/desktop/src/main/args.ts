/**
 * Capability 1 · Lifecycle. The app's command line: `--quit` asks the running app to quit, as its tray's Quit does, and starts
 * nothing when none is running (ADR-0656 D1); `--project <name>` picks the project to open, `--smoke` runs the smoke
 * check (render, screenshot, print, quit), and `--screenshot <file>` says where the smoke check
 * saves its screenshot, `--start-check` starts the main process as far as its handlers and exits 0
 * (the updater's check of a new build, contract 4.17), and `--background` starts the app without its window (it restarts that
 * way after an update, when the window was closed). Anything else (Electron's and Chromium's own switches, the app path in
 * development) is left alone.
 */
export interface AppArgs {
  project?: string;
  smoke: boolean;
  startCheck: boolean;
  background: boolean;
  quit: boolean;
  screenshot?: string;
  /** Smoke-only choice; ordinary launches always open Forest. */
  forestMode?: "forest" | "library";
}

export function parseArgs(argv: readonly string[]): AppArgs {
  const args: AppArgs = { smoke: false, startCheck: false, background: false, quit: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = (): string | undefined => inline ?? argv[++index];
    if (flag === "--smoke") args.smoke = true;
    else if (flag === "--start-check") args.startCheck = true;
    else if (flag === "--background") args.background = true;
    else if (flag === "--quit") args.quit = true;
    else if (flag === "--project") {
      const project = value();
      if (project !== undefined) args.project = project;
    } else if (flag === "--forest-mode") {
      const mode = value();
      if (mode !== "forest" && mode !== "library") throw new Error("--forest-mode must be forest or library");
      args.forestMode = mode;
    } else if (flag === "--screenshot") {
      const screenshot = value();
      if (screenshot !== undefined) args.screenshot = screenshot;
    }
  }
  return args;
}
