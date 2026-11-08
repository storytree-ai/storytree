/**
 * Capability 2 · Storytree projects. A capture of islands the shared `code-rows` seed lacks: the committed seed is a
 * snapshot that falls behind the library, so a capture naming a newer island builds a fresh seed and code survey from
 * the library and this checkout into a scratch folder instead, leaving the committed pair as it was (2.52). Imported on
 * its own, like live.ts, so the kit's other captures do not reach the library.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { readCodeSurvey } from "@storytree/forest/code-survey";
import { sanitiseSeed } from "@storytree/forest/evidence-seed";
import { connect, type Change, type Storytree } from "@storytree/library";
import { openNamedProject, requireApproval, route } from "@storytree/project-and-caller";

import type { CaptureSeed, SeededCaptureOptions } from "./runner.js";
import { captureSeed } from "./seeds.js";

/** A seed and its code survey, as `captureSeed` returns them. */
export interface SeedPair {
  seed: CaptureSeed;
  survey: SeededCaptureOptions["survey"];
}

/** This checkout, whose code the survey reads and whose marker routes to the library. */
const checkout = path.resolve(import.meta.dirname, "../../../..");

/**
 * `project`'s seed read from `storytree`, folded as the committed one is (each record's creation and its last later
 * change; the cursor kept), and its code survey read from `checkout`, both written to `folder` (a fresh scratch
 * folder when not named) as seed.json.gz and survey.json. Writes nothing to the library.
 */
export async function freshSeed({ storytree, project, checkout, folder = mkdtempSync(path.join(tmpdir(), "storytree-capture-seed-")) }: {
  storytree: Storytree; project: string; checkout: string; folder?: string | undefined;
}): Promise<SeedPair & { folder: string }> {
  const library = await openNamedProject(storytree, project);
  const tree = await library.projectTree();
  const all = await library.changesSince(0);
  const kept = new Map<string, Change>();
  for (const change of all.changes) kept.set(`${change.recordId}:${change.action === "created" ? "c" : "u"}`, change);
  const changes = { ...all, changes: [...kept.values()].sort((a, b) => a.seq - b.seq) };
  const covers: CaptureSeed["covers"] = {};
  for (const story of tree.stories) {
    for (const id of [story.id, ...story.capabilities.map(capability => capability.id)]) {
      const shelf = await library.frontCovers(id);
      if (shelf.length > 0) covers[id] = shelf;
    }
  }
  const seed = sanitiseSeed({ projects: [project], tree, changes, lines: { lines: [], cursor: 0 }, covers,
    stats: { stories: tree.stories.length, taken: new Date().toISOString(), changesFolded: "each record: its created change and its last later change; cursor kept" } }) as unknown as CaptureSeed;
  const survey = await readCodeSurvey(checkout, seed.tree as Parameters<typeof readCodeSurvey>[1]);
  writeFileSync(path.join(folder, "seed.json.gz"), gzipSync(JSON.stringify(seed) + "\n", { level: 9 }));
  writeFileSync(path.join(folder, "survey.json"), JSON.stringify(survey, null, 1) + "\n");
  return { folder, seed, survey: survey as SeedPair["survey"] };
}

/** A fresh seed of storytree's own library, routed from this checkout as the command line routes, in a scratch folder (or `folder`). */
export async function freshFromCheckout(folder?: string): Promise<SeedPair & { folder: string }> {
  const where = route(checkout);
  if (where.status !== "routed") throw new Error(where.message);
  const storytree = await connect(where.library);
  try {
    // Only from an approved checkout of storytree, whatever project the folder's marker names (ADR-0942 D1).
    await requireApproval(storytree, "storytree", where.folder);
    return await freshSeed({ storytree, project: "storytree", checkout, folder });
  } finally {
    await storytree.close();
  }
}

/**
 * A seed holding every island `islands` names, by story id or title (any case): the committed `code-rows` pair when it holds them all, else a
 * fresh one built into a scratch folder. An island the fresh seed lacks too fails, naming the stories it has.
 */
export async function seedHolding(islands: readonly string[], { committed = () => captureSeed("code-rows"), fresh = () => freshFromCheckout() }: {
  committed?: () => SeedPair; fresh?: () => Promise<SeedPair>;
} = {}): Promise<SeedPair> {
  const missing = (pair: SeedPair) => islands.filter(island => !pair.seed.tree.stories.some(story => story.id === island || story.title.toLowerCase() === island.toLowerCase()));
  const shared = committed();
  if (missing(shared).length === 0) return shared;
  const built = await fresh();
  const absent = missing(built);
  if (absent.length > 0) throw new Error(`The library has no story titled or named ${absent.join(", ")}; its stories are ${built.seed.tree.stories.map(story => story.title).join(", ")}.`);
  return built;
}
