// Capability 2 · Storytree projects
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

export interface SeedPair {
  seed: CaptureSeed;
  survey: SeededCaptureOptions["survey"];
}

const checkout = path.resolve(import.meta.dirname, "../../../..");

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

export async function freshFromCheckout(folder?: string): Promise<SeedPair & { folder: string }> {
  const where = route(checkout);
  if (where.status !== "routed") throw new Error(where.message);
  const storytree = await connect(where.library);
  try {
    await requireApproval(storytree, "storytree", where.folder);
    return await freshSeed({ storytree, project: "storytree", checkout, folder });
  } finally {
    await storytree.close();
  }
}

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
