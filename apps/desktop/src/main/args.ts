/**
 * Capability 1 · Lifecycle. The app's command line: `--quit` asks the running app to quit, as its tray's Quit does, and starts
 * nothing when none is running (ADR-0656 D1); `--project <name>` picks the project to open, `--smoke` runs the smoke
 * check (render, screenshot, print, quit), `--screenshot <file>` says where the smoke check
 * saves its screenshot and `--stress <rounds>` how many rounds of closing and reopening its window it runs before it quits
 * (contract 1.30, none unless asked), `--start-check` starts the main process as far as its handlers and exits 0
 * (the updater's check of a new build, contract 4.17), `--page-check` has that start load the page too and hear its road
 * worker before it exits (the install checks' proof that the packaged page loads, contract 1.41), `--callback-check` keeps the app up with no window or library and
 * reports each sign-in callback a later start hands it (contract 1.15, CI's proof of deep-link delivery), and `--background` starts the app without its window (it restarts that
 * way after an update, when the window was closed). Anything else (Electron's and Chromium's own switches, the app path in
 * development) is left alone.
 *
 * Read strictly (contract 1.39): a start that carries a sign-in link takes no flag from it, reading stops at `--`, an
 * installed build takes the developer and check flags (`DEVELOPER_FLAGS`) only when the CI variable is set, as the install
 * checks set it, and `--screenshot` refuses a network (UNC) or device path.
 */
export interface AppArgs {
  project?: string;
  smoke: boolean;
  startCheck: boolean;
  /** With --start-check: load the page hidden and hear its road worker before exiting (contract 1.41). */
  pageCheck: boolean;
  callbackCheck: boolean;
  background: boolean;
  quit: boolean;
  screenshot?: string;
  /** Smoke-only: how many rounds of closing and reopening the window run before the smoke check quits (0 unless asked). */
  stress: number;
  /** Smoke-only choice; ordinary launches always open Forest. */
  forestMode?: "forest" | "library";
}

/** The flags for development and the checks, which an installed build takes only under CI. */
const DEVELOPER_FLAGS = new Set(["--smoke", "--screenshot", "--stress", "--start-check", "--page-check", "--callback-check", "--forest-mode"]);
/** The developer flags followed by a value, which an ignored one takes with it. */
const VALUE_FLAGS = new Set(["--screenshot", "--stress", "--forest-mode"]);

/** Where this start runs: a packaged build (Electron's app.isPackaged) and its environment. Unpackaged unless said. */
export interface ArgsContext {
  packaged?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

export function parseArgs(argv: readonly string[], { packaged = false, env = {} }: ArgsContext = {}): AppArgs {
  const args: AppArgs = { smoke: false, startCheck: false, pageCheck: false, callbackCheck: false, background: false, quit: false, stress: 0 };
  // A sign-in link's start is the system handing the link over, so nothing else on its line is the user's.
  if (argv.some(arg => arg.toLowerCase().startsWith("storytree-auth:"))) return args;
  const developer = !packaged || Boolean(env.CI);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--") break;
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = (): string | undefined => inline ?? argv[++index];
    if (!developer && DEVELOPER_FLAGS.has(flag)) {
      if (VALUE_FLAGS.has(flag)) value();
      continue;
    }
    if (flag === "--smoke") args.smoke = true;
    else if (flag === "--start-check") args.startCheck = true;
    else if (flag === "--page-check") args.pageCheck = true;
    else if (flag === "--callback-check") args.callbackCheck = true;
    else if (flag === "--background") args.background = true;
    else if (flag === "--quit") args.quit = true;
    else if (flag === "--project") {
      const project = value();
      if (project !== undefined) args.project = project;
    } else if (flag === "--forest-mode") {
      const mode = value();
      if (mode !== "forest" && mode !== "library") throw new Error("--forest-mode must be forest or library");
      args.forestMode = mode;
    } else if (flag === "--stress") {
      const rounds = Number(value());
      if (!Number.isInteger(rounds) || rounds < 0) throw new Error("--stress must be a whole number of rounds");
      args.stress = rounds;
    } else if (flag === "--screenshot") {
      const screenshot = value();
      if (screenshot !== undefined && /^[\\/]{2}/.test(screenshot)) throw new Error("--screenshot must be a local file, not a network or device path");
      if (screenshot !== undefined) args.screenshot = screenshot;
    }
  }
  return args;
}
