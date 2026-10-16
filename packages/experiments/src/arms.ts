/**
 * Capability 1 · Arm switch (ADR-1064 D2). An arm is a named switch the doors enforce: the verbs it denies, by door.
 * A lane's storytree home names its experiment and arm in settings.json (Project and caller's `experiment` setting);
 * the command line and the MCP server ask `verdictOf` before running a verb, refuse a denied one and log it
 * `denied-by-arm`. The labels on the lane's lines are the activity log's own stamp of the same setting.
 *
 * Denying in the doors works the same for every harness and closes the shell route to a command, which a harness's
 * deny list does not. The arms are held here until the experiment record (capability 4) carries its own.
 */
import { readExperiment } from "@storytree/project-and-caller";

/** What an arm turns off: tools by the name the MCP server serves them under, commands by family, as the command line names them. */
export interface ArmRecord {
  readonly denies: { readonly tools: readonly string[]; readonly commands: readonly string[] };
}

/** The arms the kit holds, by name. */
export const ARMS: Readonly<Record<string, ArmRecord>> = {
  /** The control: the factory as it runs. */
  "map-reads-on": { denies: { tools: [], commands: [] } },
  /** The factory with Map reads denied: the focus tool and the map command family, nothing else; the plan, claims and gates stay. */
  "map-reads-off": { denies: { tools: ["focus"], commands: ["storytree map"] } },
};

/** Whether a door may run a verb in this home: allowed, or denied by the experiment arm the home names, with why. */
export type Verdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly experiment: string; readonly arm: string; readonly message: string };

/**
 * The verdict on `verb`, as `door` names it (`focus`, `storytree map refresh`), for a caller whose storytree home is `home`.
 * A home naming an arm the kit does not hold is refused, so a misnamed lane never runs as if unswitched.
 */
export function verdictOf(door: "tool" | "command", verb: string, home?: string): Verdict {
  const experiment = readExperiment(home);
  if (experiment === undefined) return { allowed: true };
  const record = Object.hasOwn(ARMS, experiment.arm) ? ARMS[experiment.arm] : undefined;
  if (record === undefined) {
    throw new Error(`This storytree home runs arm "${experiment.arm}" of experiment "${experiment.name}", which the experiment kit does not hold: its arms are ${Object.keys(ARMS).join(", ")}. Fix the experiment setting in this home's settings.json.`);
  }
  const denied = door === "tool"
    ? record.denies.tools.includes(verb)
    : record.denies.commands.some((family) => verb === family || verb.startsWith(`${family} `));
  if (!denied) return { allowed: true };
  const what = door === "tool" ? `the ${verb} tool` : verb;
  return {
    allowed: false,
    experiment: experiment.name,
    arm: experiment.arm,
    message: `This lane runs experiment "${experiment.name}", arm "${experiment.arm}", which denies ${what}: work without it.`,
  };
}
