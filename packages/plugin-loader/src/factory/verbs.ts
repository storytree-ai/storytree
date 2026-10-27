/**
 * Capability 5 · Factory plugins. The `plugin` verbs, declared here (ADR-0969 D2) and named under `verbs` in the
 * package's manifest (ADR-1033), so the command line mounts them as its `plugin` family and the MCP server as tools: an
 * agent with only the installed app reads what a plugin must contain, starts one in this computer's factory folder, and
 * checks that this storytree would load it before switching it in (friction_97e888ba1a89). None of those needs a project.
 * The fourth removes a switched-off plugin's records from the project's library: a deliberate step, listed before it is
 * taken, which switching a plugin off never takes (ADR-1178 D4). The fifth fences, in the project's library, the database
 * roles each plugin this computer mounts declares (its kinds' writers, and its librarian): a deliberate step, run with an
 * account that may act as the project database's owner, which never makes a role (ADR-1178 D5).
 */
import { verb, VerbRefusal, type VerbContext, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";

const refused = (error: unknown): VerbRefusal => new VerbRefusal(error instanceof Error ? error.message : String(error));

const contract = verb({
  command: { family: "plugin", name: "contract", summary: "what a factory plugin must contain for this storytree to load it in a part's place" },
  tool: {
    name: "plugin_contract",
    description: "What a factory plugin must contain for this storytree to load it in the place of one of its parts: the package.json manifest, the plugin interface version this storytree honours, each kind a part can be stood in with, and a verb's shape and answer. Read it before writing a plugin.",
  },
  inputs: {},
  callerless: true,
  async act() {
    const { contractSaid } = await import("./contract.js");
    return { text: contractSaid(), next: [{ command: "plugin new <plugin> --for <part>", tool: "new_plugin", why: "start a plugin of this shape" }] };
  },
});

const create = verb({
  command: { family: "plugin", name: "new", summary: "start a plugin in this computer's factory folder that this storytree loads" },
  tool: {
    name: "new_plugin",
    description: "Start a factory plugin in this computer's factory folder: a package.json with storytree's manifest and a verbs module this storytree loads, to edit into a stand-in for one of storytree's parts. Then check_plugin, and switch it in with `storytree settings set part <part> plugin <plugin>`.",
  },
  inputs: {
    plugin: { kind: "text", word: 0, describe: "the plugin's name: its folder in the factory's plugins folder, in lower-case letters, digits and dashes" },
    for: { kind: "text", optional: true, describe: "the part it will stand in for, as `storytree settings show` names it" },
  },
  callerless: true,
  async act({ plugin, for: part }) {
    const [{ makeFactoryFolder }, { newPlugin }] = await Promise.all([import("@storytree/project-and-caller"), import("./contract.js")]);
    let made: { dir: string; files: readonly string[] };
    try {
      made = newPlugin(makeFactoryFolder().folder, plugin, part);
    } catch (error) {
      throw refused(error);
    }
    const next = [
      { command: `plugin check ${plugin}`, tool: "check_plugin", why: "check this storytree would load it, after each edit" },
      ...(part === undefined ? [] : [{ command: `settings set part ${part} plugin ${plugin}`, why: `switch ${part} off with ${plugin} in its place` }]),
      { command: "plugin contract", tool: "plugin_contract", why: "what a plugin may contain" },
    ];
    return { text: `Started ${plugin} in ${made.dir}: ${made.files.join(", ")}. Its verbs module adds a \`${plugin}\` family with one verb; make it the stand-in you need.`, next };
  },
});

const check = verb({
  command: { family: "plugin", name: "check", summary: "say whether this storytree would load a plugin in your factory, and why not, switching nothing" },
  tool: {
    name: "check_plugin",
    description: "Say whether this storytree would load a plugin in this computer's factory folder in a part's place, and why not: it loads the plugin as a host does and reads its verb families as a door mounts them, switching nothing.",
  },
  inputs: { plugin: { kind: "text", word: 0, describe: "the plugin's name: its folder in the factory's plugins folder" } },
  callerless: true,
  async act({ plugin }) {
    const [{ factoryFolder }, { checkPlugin }] = await Promise.all([import("@storytree/project-and-caller"), import("./contract.js")]);
    const checked = checkPlugin(factoryFolder().folder, plugin);
    if (!checked.loads) {
      return { text: `${plugin} would not load:\n${checked.problems.map((problem) => `  - ${problem}`).join("\n")}`, next: [{ command: "plugin contract", tool: "plugin_contract", why: "what a plugin must contain" }] };
    }
    const adds = Object.entries(checked.adds).map(([kind, count]) => `${kind} (${count})`).join(", ");
    const { pluginLibrarian } = await import("./factory.js");
    const librarian = checked.adds.librarian === undefined ? undefined : pluginLibrarian(factoryFolder().folder, plugin);
    const keeps = librarian === undefined ? "" : ` Its librarian, librarian-${plugin}, connects as the database role ${librarian.role}, which ${granted(librarian)}.`;
    return {
      text: `${plugin} would load: it adds ${adds}.${keeps}`,
      next: [
        { command: `settings set part <part> plugin ${plugin}`, why: "switch a part off with it in its place" },
        ...(checked.adds.recordKinds === undefined ? [] : [{ command: "plugin fence", tool: "fence_plugin", why: "fence its roles in this project's library, as the database's owner" }]),
      ],
    };
  },
});

const removeRecords = verb({
  command: { family: "plugin", name: "remove-records", summary: "list a switched-off plugin's records in this project, and with --yes remove exactly those" },
  tool: {
    name: "remove_plugin_records",
    description: "List a switched-off factory plugin's records in this project, by kind with how many and their ids, removing nothing; with yes, remove exactly those. Switching a plugin off never removes its records: they wait, hidden, in case it is switched back on. Take this step only when the owner asked for the plugin removed, not only switched off; otherwise ask the owner with raise_question. A plugin switched on is refused.",
  },
  inputs: {
    plugin: { kind: "text", word: 0, describe: "the plugin's name, the part before the dot in its kinds of record" },
    yes: { kind: "switch", describe: "remove the records listed; without it, nothing is removed" },
  },
  writes: true,
  async act({ plugin, yes }, { library, writer }: VerbContext) {
    const { readStandIns } = await import("@storytree/project-and-caller");
    const parts = Object.entries(readStandIns().plugins).filter(([, named]) => named === plugin).map(([part]) => part).sort();
    if (parts.length > 0) {
      throw new VerbRefusal(`${plugin} is switched on: it stands in for ${parts.join(", ")} on this computer. Its records are removed only once it is switched off, and switching it off removes none of them.`, {
        next: parts.map((part) => ({ command: `settings set part ${part} on`, why: `switch ${plugin} off, with ${part} back on` })),
      });
    }
    try {
      const listed = await library.pluginRecords(plugin);
      if (listed.kinds.length === 0) return { text: `${plugin} has no records in this project: there is nothing to remove.` };
      const lines = listed.kinds.map(({ kind, count, ids }) => `  ${kind} (${count}): ${ids.join(", ")}`).join("\n");
      if (!yes) {
        return {
          text: `${plugin}'s records in this project, none removed yet:\n${lines}`,
          data: { listed },
          next: [{ command: `plugin remove-records ${plugin} --yes`, tool: "remove_plugin_records", why: "remove exactly these, only when the owner asked for the plugin removed" }],
        };
      }
      await library.removePluginRecords(listed, `${plugin} was removed, so its records were (plugin remove-records, ADR-1178 D4)`, writer);
      return { text: `Removed ${plugin}'s records from this project:\n${lines}`, data: { removed: listed } };
    } catch (error) {
      throw refused(error);
    }
  },
});

/** What `grant` lets its role do, in words: "adds voice.note", or "adds and changes voice.note, voice.tag". */
function granted(grant: { readonly kinds: readonly string[]; readonly update?: boolean }): string {
  return `${grant.update === true ? "adds and changes" : "adds"} ${grant.kinds.join(", ")}`;
}

const fence = verb({
  command: { family: "plugin", name: "fence", summary: "fence, in this project's library, the database roles each plugin this computer mounts declares, as the database's owner" },
  tool: {
    name: "fence_plugin",
    description: "Fence, in this project's library, the database roles each factory plugin this computer mounts declares in its manifest: each kind's writers, to add records of its kinds and change none, and its librarian, to keep them as the manifest says. Run with an account that may act as the project database's owner; it makes no role (each role, its LOGIN and password are made apart). It says what each role was granted. Take this step when the owner asks for a plugin's roles to be fenced.",
  },
  inputs: {},
  writes: true,
  async act(_inputs, { project }: VerbContext) {
    const [{ readStandIns }, { locateLibrary }, { fenceProject }, { pluginFences, pluginLibrarian }] = await Promise.all([
      import("@storytree/project-and-caller"),
      import("@storytree/project-and-caller/routing"),
      import("@storytree/library/outside-writer"),
      import("./factory.js"),
    ]);
    const standIns = readStandIns();
    const plugins = [...new Set(Object.values(standIns.plugins))].sort();
    if (plugins.length === 0) return { text: "This computer mounts no factory plugin, so there is no role to fence.", next: [{ command: "settings set part <part> plugin <plugin>", why: "switch a part off with a plugin in its place" }] };
    const library = locateLibrary();
    if (!library.found) throw new VerbRefusal(library.message);
    const lines: string[] = [];
    for (const plugin of plugins) {
      let grants;
      try {
        grants = pluginFences(standIns.folder, plugin);
      } catch (error) {
        throw new VerbRefusal(`${[...lines, `${plugin}'s roles were not fenced: ${(error as Error).message}`].join("\n")}`, { next: [{ command: `plugin check ${plugin}`, tool: "check_plugin", why: "what is wrong with its manifest" }] });
      }
      if (grants.length === 0) {
        lines.push(`${plugin} declares no kinds of record, so no role to fence.`);
        continue;
      }
      try {
        await fenceProject(library.connect, project, grants);
      } catch (error) {
        throw refused(new Error([...lines, `${plugin}: ${(error as Error).message}`].join("\n")));
      }
      const librarian = pluginLibrarian(standIns.folder, plugin)?.role;
      lines.push(`${plugin}, fenced in ${project}'s library:`, ...grants.map((grant) => `  ${grant.role} ${granted(grant)}${grant.role === librarian ? ` (librarian-${plugin} connects as it)` : ""}`));
    }
    return { text: lines.join("\n") };
  },
});

/** The command line's `plugin` family, at its place after `settings`. */
export const PLUGIN_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "plugin", summary: "what a factory plugin must contain, start one, check this storytree would load it, fence its roles, or remove a switched-off one's records", order: 25.5, verbs: [contract, create, check, removeRecords as never, fence as never] },
];

/** What the MCP server's card says of these tools (ADR-1021: guidance travels with its part). */
export const pluginGuidance: readonly string[] = [
  "To make a plugin in the user's factory that stands in for one of storytree's parts, read `plugin_contract` first, start it with `new_plugin`, and call `check_plugin` after each edit: it says whether storytree would load it, and why not, before the part is switched to it. Switching a plugin off keeps its records; remove them with `remove_plugin_records` only when the user asked for the plugin removed, otherwise ask them first.",
];
