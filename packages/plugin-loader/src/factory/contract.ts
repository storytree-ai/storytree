/**
 * Capability 5 · Factory plugins. What a plugin must contain, said by the storytree that loads it, so an agent with only
 * the installed app makes one of the right shape (friction_97e888ba1a89): the contract in words, a plugin started from a
 * skeleton this storytree loads, and a check that says whether this storytree would load a plugin, and why not, without
 * switching anything. The check loads a plugin as a host loads a stand-in, then reads the verb families it adds for
 * what a door mounts.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PLUGIN_INTERFACE, pluginLibrarian, pluginParts, pluginRecordKinds } from "./factory.js";

/** Each kind a factory plugin may stand in for a part with: the hosts that mount it, and what one declaration is. */
export const STAND_IN_KINDS: Readonly<Record<string, { readonly hosts: string; readonly shape: string }>> = {
  verbs: {
    hosts: "the command line and the MCP server",
    shape: "a command family { name, summary, order, verbs: [verb, …] }, order being its place in `storytree`'s list (any unused number)",
  },
  tools: { hosts: "the MCP server", shape: "a function (host) => { registerTools(define) } | undefined, handed the MCP server's tool host" },
  claimChecks: { hosts: "the MCP server", shape: "{ name, landing(capability, { library, folder }) => Promise<string[]> }: the problems, none when it may land" },
  pipelineJobs: { hosts: "the MCP server", shape: "{ name, needsHistory?, commands(ref, workspace) => string[] }: a job storytree adds to a project's CI" },
  projectRecords: { hosts: "the command line and the desktop app", shape: "{ name, forget(server, project) => Promise<void> }: records kept for a project outside its library" },
  surfaces: { hosts: "the desktop app", shape: "{ id, name, description, switchable, within?, follows?, settings: [] }: a surface of the window" },
  pageAnswers: { hosts: "the desktop app", shape: "an answer the window's page asks the app for, by channel" },
  pageChannels: { hosts: "the desktop app", shape: "a channel the window's page may ask the app on" },
};

/** The verbs module a new plugin starts with: one family, with one verb that needs no project and answers with text. */
function verbsModule(name: string): string {
  return `// The verbs this plugin adds: plain command families, as storytree's own parts declare them. Nothing of storytree's
// is imported; a host hands each verb's act its input and its place. The whole contract: storytree plugin contract
export const PLUGIN_FAMILIES = [
  {
    name: ${JSON.stringify(name)},
    summary: ${JSON.stringify(`what ${name} adds`)},
    order: 40,
    verbs: [
      {
        command: { family: ${JSON.stringify(name)}, name: "hello", summary: ${JSON.stringify(`say that ${name} is mounted`)} },
        tool: { absent: "only the command line runs it" },
        inputs: {},
        // It needs no project or library: a host hands it only its place, { folder, session? }.
        callerless: true,
        async act(_input, { folder }) {
          return { text: \`${name} is mounted, called in \${folder}\` };
        },
      },
    ],
  },
];
`;
}

/**
 * Plugin `name` started in factory folder `folder`: a package.json naming the plugin interface this storytree honours,
 * and a verbs module this storytree loads. A name taken, or one that is not one folder's, is refused, writing nothing.
 */
export function newPlugin(folder: string, name: string, part?: string): { readonly dir: string; readonly files: readonly string[] } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`${JSON.stringify(name)} is not a plugin's name: use lower-case letters, digits and dashes`);
  const dir = path.join(folder, "plugins", name);
  if (existsSync(dir)) throw new Error(`the factory has a plugin called ${name} already (${dir})`);
  const pkg = {
    name,
    type: "module",
    description: part === undefined ? "A storytree factory plugin" : `A storytree factory plugin standing in for ${part}`,
    exports: { "./verbs": "./verbs.js" },
    storytree: { interface: PLUGIN_INTERFACE, verbs: [{ from: "./verbs", export: "PLUGIN_FAMILIES" }] },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(path.join(dir, "verbs.js"), verbsModule(name));
  return { dir, files: ["package.json", "verbs.js"] };
}

const said = (value: unknown): boolean => typeof value === "string" && value !== "";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a door would refuse in verb `at` of family `family`, each said; none when it mounts. */
function verbProblems(family: string, verb: unknown, at: number): string[] {
  const where = `family ${family}'s verb ${at + 1}`;
  if (!isObject(verb)) return [`${where} is not an object`];
  const { command, tool, inputs, act } = verb;
  const problems: string[] = [];
  if (!isObject(command) || !(said(command.absent) || (said(command.family) && said(command.name) && said(command.summary)))) {
    problems.push(`${where}'s command is neither { family, name, summary } nor { absent: why }`);
  }
  if (!isObject(tool) || !(said(tool.absent) || (said(tool.name) && said(tool.description)))) problems.push(`${where}'s tool is neither { name, description } nor { absent: why }`);
  if (!isObject(inputs)) problems.push(`${where} has no inputs object ({} for none)`);
  if (typeof act !== "function") problems.push(`${where} has no act(input, place) function`);
  return problems;
}

/** What a door would refuse in declared verb family `at`, each said; none when it mounts. */
function familyProblems(family: unknown, at: number): string[] {
  if (!isObject(family)) return [`verbs declaration ${at + 1} is ${typeof family === "function" ? "a function" : "not an object"}, not a command family { name, summary, order, verbs }`];
  const name = said(family.name) ? String(family.name) : `${at + 1}`;
  const problems: string[] = [];
  if (!said(family.name)) problems.push(`family ${name} has no name`);
  if (!said(family.summary)) problems.push(`family ${name} has no summary`);
  if (typeof family.order !== "number") problems.push(`family ${name} has no order (a number: its place in storytree's list)`);
  if (!Array.isArray(family.verbs)) problems.push(`family ${name} has no verbs list`);
  else problems.push(...family.verbs.flatMap((verb, index) => verbProblems(name, verb, index)));
  return problems;
}

/** Whether this storytree would load a plugin: what it adds, by kind, and each problem when it would not. */
export interface PluginCheck {
  readonly loads: boolean;
  readonly adds: Readonly<Record<string, number>>;
  readonly problems: readonly string[];
}

/** Plugin `plugin` of factory folder `folder` loaded as a host loads a stand-in, of every kind, its verb families read as a door mounts them. */
export function checkPlugin(folder: string | undefined, plugin: string): PluginCheck {
  const adds: Record<string, number> = {};
  const problems: string[] = [];
  for (const kind of Object.keys(STAND_IN_KINDS)) {
    let declared: unknown[];
    try {
      declared = pluginParts(folder, plugin, kind);
    } catch (error) {
      const message = (error as Error).message;
      problems.push(message);
      // A kind's own module is said for that kind; a plugin, package or manifest that cannot be read, once.
      if (/manifest names|exports no list/.test(message)) continue;
      break;
    }
    if (declared.length > 0) adds[kind] = declared.length;
    if (kind === "verbs") problems.push(...declared.flatMap(familyProblems));
  }
  try {
    const kinds = pluginRecordKinds(folder, plugin);
    if (kinds.length > 0) adds.recordKinds = kinds.length;
  } catch (error) {
    // A plugin, package or manifest that cannot be read is said once, above.
    const message = (error as Error).message;
    if (!problems.includes(message)) problems.push(message);
  }
  try {
    if (pluginLibrarian(folder, plugin) !== undefined) adds.librarian = 1;
  } catch (error) {
    const message = (error as Error).message;
    if (!problems.includes(message)) problems.push(message);
  }
  if (problems.length === 0 && Object.keys(adds).length === 0) problems.push(`${plugin}'s storytree manifest names none of the kinds a part can be stood in with (${Object.keys(STAND_IN_KINDS).join(", ")})`);
  return { loads: problems.length === 0, adds, problems };
}

/** The contract, in words: what a plugin must contain for this storytree to load it in a part's place. */
export function contractSaid(): string {
  const kinds = Object.entries(STAND_IN_KINDS).map(([kind, { hosts, shape }]) => `  ${kind} (mounted by ${hosts}): ${shape}`);
  return [
    "A factory plugin is a folder in your factory's plugins folder, <factory>/plugins/<plugin>/, that stands in for one of storytree's parts while that part is switched off: `storytree settings set part <part> plugin <plugin>`. `storytree settings set part <part> on` restores storytree's own.",
    "",
    "Its package.json:",
    "  \"type\": \"module\",",
    "  \"exports\": { \"./verbs\": \"./verbs.js\" }: each module the manifest names, by a subpath inside the plugin's folder;",
    `  "storytree": { "interface": ${PLUGIN_INTERFACE}, "<kind>": [{ "from": "./verbs", "export": "PLUGIN_FAMILIES" }] }:`,
    `    interface is the version of storytree's plugin interface it is written for: this storytree honours ${PLUGIN_INTERFACE}, and leaves a plugin naming another, or none, unmounted;`,
    "    each kind lists { from, export }: an exported subpath, and the name that module exports a list of declarations under.",
    "",
    "Each module is ready-to-run JavaScript (an ES module with no top-level await) that imports nothing of storytree's: it exports plain declarations, and a host hands their work its context.",
    "",
    "The kinds a part can be stood in with, and one declaration of each:",
    ...kinds,
    "",
    "Its own kinds of record, which the library keeps while the plugin is mounted and keeps dormant, hidden but intact, while it is not:",
    "  \"recordKinds\": [{ \"kind\": \"<plugin>.<kind>\", \"version\": 1, \"fields\": <a JSON Schema of type \"object\">, \"writers\": [\"<database role>\", …],",
    "    \"upgrades\"?: [{ \"from\", \"name\", \"rename\"?: { old: new }, \"remove\"?: [field], \"set\"?: { field: value } }] }]",
    "Its own librarian, librarian-<plugin>, which keeps those records on its schedule as a database role storytree fences to the plugin's kinds:",
    "  \"librarian\": { \"role\": \"<database role>\", \"update\"?: true }: a role of its own, never one of its kinds' writers; update lets it change their records, not only add them",
    "",
    "A verb, in a family's verbs:",
    "  { command: { family, name, summary, usage? } | { absent: why },",
    "    tool: { name, description } | { absent: why },",
    "    inputs: { <input>: { kind: \"text\" | \"yes-no\" | \"switch\" | \"count\" | \"fields\", describe, word?, optional?, many? } },",
    "    callerless?: true, when it needs no project: its act is then handed only its place, { folder, session? },",
    "    act(input, place) => Promise<{ text, next?: [{ command?, tool?, why }], data? }> }",
    "  Without callerless, the place also holds the project's library, its name and the calling session.",
    "",
    "`storytree plugin new <plugin> --for <part>` starts one of this shape in your factory, and `storytree plugin check <plugin>` says whether this storytree would load it, and why not, switching nothing.",
  ].join("\n");
}
