// Capability 8 · Lag instruments. The one seed both lag instruments read (`pnpm lag:reads` and `pnpm lag:desktop`), so their numbers
// compare (friction_19040467294d: a second seed is how the earlier lanes' numbers drifted apart). One fixed project, in named sizes
// (ADR-1001 D2): enough of everything for every catalogue action to have something to act on, the first story the catalogue's named
// island, and capabilities that differ from story to story so the fewest and the most islands are two. The seeded library stands
// still: no log line is added while a run measures, since a trickle's cost depends on where each line falls against the page's
// poll, and two runs would no longer make the same calls (increment_7f0c280cfe57's behaviour 5).

import { openActivityLog } from "@storytree/session-management";
import { NAMED_STORY } from "@storytree/forest/actions";

/**
 * The sizes, by name. `standard` is the size #391 measured. `large` is ten times as broad at the same depth (arcs, stories,
 * sessions and log lines; increments per arc, capabilities per story and contracts per capability unchanged): 250 arcs is past the
 * 211 storytree's own library held on 2026-10-12, so it is a size the owner's library reaches, and an action's settled time at
 * the two shows where it crosses 1 s.
 */
export const SIZES = {
  standard: { arcs: 25, incrementsPerArc: 8, stories: 5, capabilitiesPerStory: 3, contractsPerCapability: 2, sessions: 4, logLines: 40 },
  large: { arcs: 250, incrementsPerArc: 8, stories: 50, capabilitiesPerStory: 3, contractsPerCapability: 2, sessions: 40, logLines: 400 },
};

/** A size by name, or a size given in parts over the standard one; refused naming the sizes when the name is not one. */
export function seedSize(size = "standard") {
  if (typeof size === "object") return { ...SIZES.standard, ...size };
  if (!(size in SIZES)) throw new Error(`no seed size called ${size}; the sizes are ${Object.keys(SIZES).join(", ")}`);
  return SIZES[size];
}

/**
 * Story `s`'s capabilities: the mean, one more, two more, two fewer, one fewer, in turn, so stories differ, five of them average the
 * mean, and the first story (the named island) is neither the fewest nor the most.
 */
const capabilitiesOf = (seed, s) => Math.max(1, seed.capabilitiesPerStory + ((s + 2) % 5) - 2);

/**
 * Seed `project` in `storytree`'s library and the activity log on `url` at `size` (a name in SIZES, or parts over the standard):
 * stories with capabilities, contracts and a founding decision (a Library note, and the capability's front cover) each, the first
 * story NAMED_STORY; arcs with increments and a question each; and agent log lines across the sessions, each session's first line
 * its start.
 */
export async function seedLagProject(storytree, url, project, size = "standard") {
  const seed = seedSize(size);
  const library = await storytree.openProject(project);
  for (let s = 0; s < seed.stories; s++) {
    const story = await library.addStory({ title: s === 0 ? NAMED_STORY : `Story ${s + 1}` });
    for (let c = 0; c < capabilitiesOf(seed, s); c++) {
      const capability = await library.addCapability({ title: `Capability ${s + 1}.${c + 1}`, story: story.id });
      await library.recordDecision({ status: "accepted", title: `Founding ${s + 1}.${c + 1}`, text: "Why it is shaped so", frontCoverOf: capability.id });
      for (let k = 0; k < seed.contractsPerCapability; k++) {
        await library.addContract({ title: `Promise ${s + 1}.${c + 1}.${k + 1}`, capability: capability.id });
      }
    }
  }
  for (let a = 0; a < seed.arcs; a++) {
    const arc = await library.createArc({ title: `Arc ${a + 1}`, intent: "Ship it", endState: "It shipped" });
    for (let i = 0; i < seed.incrementsPerArc; i++) {
      await library.addIncrement({ arc: arc.id, title: `Increment ${a + 1}.${i + 1}`, objective: "Build it", body: "One piece, then the next." });
    }
    await library.raiseQuestion({ arc: arc.id, title: "Which way?", stakes: "Blocks the arc", statement: "Short or long?", context: "None yet", options: "Short or long" });
  }
  const log = await openActivityLog(url);
  try {
    for (let n = 0; n < seed.logLines; n++) {
      const line = n < seed.sessions ? { kind: "session-started" } : { kind: "file-edited", files: [`packages/p${n % 5}/src/file.ts`] };
      await log.append(project, { session: `lag-${n % seed.sessions}`, source: "hook", ...line });
    }
  } finally {
    await log.close();
  }
}

/** What `size` seeds, in one line. */
export function describeSize(size = "standard") {
  const seed = seedSize(size);
  const capabilities = Array.from({ length: seed.stories }, (_, s) => capabilitiesOf(seed, s)).reduce((sum, n) => sum + n, 0);
  return `${seed.arcs} arcs x ${seed.incrementsPerArc} increments, a question each; ${seed.stories} stories, ${capabilities} capabilities x ${seed.contractsPerCapability} contracts; ${seed.sessions} sessions, ${seed.logLines} log lines`;
}
