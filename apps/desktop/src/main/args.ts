// Capability 1 · Lifecycle
export interface AppArgs {
  project?: string;
  smoke: boolean;
  startCheck: boolean;
  pageCheck: boolean;
  callbackCheck: boolean;
  background: boolean;
  quit: boolean;
  screenshot?: string;
  stress: number;
  forestMode?: "forest" | "library";
}

const DEVELOPER_FLAGS = new Set(["--smoke", "--screenshot", "--stress", "--start-check", "--page-check", "--callback-check", "--forest-mode"]);
const VALUE_FLAGS = new Set(["--screenshot", "--stress", "--forest-mode"]);

export interface ArgsContext {
  packaged?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

export function parseArgs(argv: readonly string[], { packaged = false, env = {} }: ArgsContext = {}): AppArgs {
  const args: AppArgs = { smoke: false, startCheck: false, pageCheck: false, callbackCheck: false, background: false, quit: false, stress: 0 };
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
