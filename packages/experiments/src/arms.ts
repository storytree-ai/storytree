/**
 * Capability 1 · Arm switch (ADR-1064 D2). An arm is a named switch the doors enforce: the verbs it denies, by door.
 * A lane's storytree home names its experiment, its arm and what that arm denies in settings.json (Project and caller's
 * `experiment` setting), copied there from the frozen experiment record by `carryDenies` when a run starts; the command
 * line and the MCP server ask `verdictOf` before running a verb, refuse a denied one and log it `denied-by-arm`. The
 * labels on the lane's lines are the activity log's own stamp of the same setting.
 *
 * Denying in the doors works the same for every harness and closes the shell route to a command, which a harness's
 * deny list does not. No arm is held in code: an experiment names its own arms in its record.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readExperiment } from "@storytree/project-and-caller";

/** What an arm turns off: tools by the name the MCP server serves them under, commands by family, as the command line names them. */
export interface Denies {
  readonly tools: readonly string[];
  readonly commands: readonly string[];
}

/** Whether a door may run a verb in this home: allowed, or denied by the experiment arm the home names, with why. */
export type Verdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly experiment: string; readonly arm: string; readonly message: string };

/**
 * The verdict on `verb`, as `door` names it (`focus`, `storytree map refresh`), for a caller whose storytree home is `home`.
 * A home naming an arm but not what it denies is refused, so a lane started before its run carried them never runs as if unswitched.
 */
export function verdictOf(door: "tool" | "command", verb: string, home?: string): Verdict {
  const experiment = readExperiment(home);
  if (experiment === undefined) return { allowed: true };
  const { denies } = experiment;
  if (denies === undefined) {
    throw new Error(`This storytree home runs arm "${experiment.arm}" of experiment "${experiment.name}" but its settings.json does not say what the arm denies: \`storytree experiment run\` copies that from the frozen experiment record when it starts, so run the arm's lanes through it.`);
  }
  const denied = door === "tool"
    ? denies.tools.includes(verb)
    : denies.commands.some((family) => verb === family || verb.startsWith(`${family} `));
  if (!denied) return { allowed: true };
  const what = door === "tool" ? `the ${verb} tool` : verb;
  return {
    allowed: false,
    experiment: experiment.name,
    arm: experiment.arm,
    message: `This lane runs experiment "${experiment.name}", arm "${experiment.arm}", which denies ${what}: work without it.`,
  };
}

/**
 * Writes `denies` into the experiment setting of the arm home `home`, which must already name `experiment` and `arm`;
 * the home's other settings stay as they are. Refused, writing nothing, when the home names no arm or another one.
 */
export function carryDenies(home: string, experiment: string, arm: string, denies: Denies): void {
  const named = readExperiment(home);
  if (named?.name !== experiment || named.arm !== arm) {
    throw new Error(`${home} is not the home of arm "${arm}" of experiment "${experiment}": make it with \`storytree experiment arm make ${experiment} ${arm}\` first`);
  }
  const file = path.join(home, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  settings.experiment = { name: experiment, arm, denies: { tools: [...denies.tools], commands: [...denies.commands] } };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
