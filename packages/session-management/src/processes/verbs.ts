// Capability 14 · See what remains
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";

function callerOf(place: VerbPlace): { session: string; harness?: string } | undefined {
  return place.session === undefined ? undefined : { session: place.session, ...(place.harness === undefined ? {} : { harness: place.harness }) };
}

async function owner(place: VerbPlace, command: string): Promise<{ session: string; harness?: string }> {
  const caller = callerOf(place);
  if (caller !== undefined) return caller;
  const { NAME_A_SESSION } = await import("@storytree/project-and-caller/caller");
  throw new VerbRefusal(`storytree ${command} needs a session identity: ${NAME_A_SESSION}; use storytree processes --all to inspect work.`);
}

async function sharedWork() {
  const { locateStorytree } = await import("@storytree/project-and-caller/routing");
  const { appDatabaseWork } = await import("./listing/index.js");
  return [appDatabaseWork(locateStorytree().running)];
}

const list = verb({
  command: { family: "processes", name: "processes", summary: "list this session’s work, or every recorded session with --all", usage: "processes [--all]" },
  tool: { absent: "Session management's own list_own_runs and list_all_runs tools" },
  inputs: { all: { kind: "switch", describe: "every recorded session's work" } },
  callerless: true,
  async act({ all }, place: VerbPlace) {
    const caller = all ? callerOf(place) : await owner(place, "processes");
    const { listRuns, renderInventory } = await import("./listing/index.js");
    const inventory = await listRuns({
      scope: all ? "all" : "self",
      ...(caller === undefined ? {} : { owner: caller }),
      stopAction: (run) => ({ command: `storytree processes stop ${run}` }),
      shared: await sharedWork(),
    });
    return { text: renderInventory(inventory) };
  },
});

const stop = verb({
  command: { family: "processes", name: "stop", summary: "stop named registered runs within this caller’s authority", usage: "processes stop <run…>" },
  tool: { absent: "Session management's own stop_own_run tool" },
  inputs: { runs: { kind: "text", word: 0, many: true, describe: "the runs to stop" } },
  callerless: true,
  async act({ runs }, place: VerbPlace) {
    const self = await owner(place, "processes stop");
    const { stopOwned } = await import("./stopping/index.js");
    const stopped = await stopOwned({ owner: self, targets: [...runs] });
    const text = JSON.stringify(stopped, null, 2);
    if (!stopped.ok) throw new VerbRefusal(text);
    return { text };
  },
});

const clear = verb({
  command: { family: "processes", name: "clear", summary: "remove only your confirmed-gone records, then read what remains on this computer" },
  tool: { absent: "Session management's own clear_own_runs tool" },
  inputs: {},
  callerless: true,
  async act(_input, place: VerbPlace) {
    const self = await owner(place, "processes clear");
    const { clearOwned, readClosing } = await import("./closing/index.js");
    const cleared = await clearOwned({ owner: self });
    const closing = await readClosing({ owner: self, knownGaps: cleared.gaps, shared: await sharedWork() });
    const text = JSON.stringify({ clear: cleared, closing }, null, 2);
    if (cleared.failed.length || cleared.gaps.length) throw new VerbRefusal(text);
    return { text };
  },
});

export const PROCESSES_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "processes", aliases: ["own"], summary: "see recorded work on this computer and stop your own runs", order: 24, bare: list, verbs: [stop, clear] },
];
