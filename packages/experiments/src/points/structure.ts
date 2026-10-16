/**
 * Capability 5 · Per-merge points and curves: the structure measure (ADR-1064 D4). A point's imports crossing capability
 * lines are the Map's code survey of the arm's tree at the merge, read against the arm's own library's plan: each import
 * whose two source files the survey places in different capabilities, inside a story's package or from one story's
 * package into another's, counted once per pair of files. The source lines the survey counts come with it, so a curve
 * can read crossings per thousand lines. A file the survey places in no capability crosses no line, and tests' imports
 * are none.
 *
 * The arm's repository is cloned once per record and each merge checked out from it in turn, beside a temporary folder
 * removed when the record is done.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AnnotatedTree, Storytree } from "@storytree/library";
import { codeSurveyReader, type ProjectSurvey } from "@storytree/map/code-survey";

import type { Gh } from "../repositories.js";

/** A tree's structure measure: imports crossing capability lines, and the source lines they are counted over. */
export interface StructureMeasure {
  readonly crossImports: number;
  readonly lines: number;
}

/** Reads the structure of an arm's tree at each merge commit asked for; closed when the record is done. */
export interface Structure {
  at(commit: string): Promise<StructureMeasure>;
  close(): Promise<void>;
}

/** The imports crossing capability lines in a survey, and its source lines. */
export function structureOf(survey: ProjectSurvey): StructureMeasure {
  let crossImports = 0;
  let lines = 0;
  for (const story of Object.values(survey)) {
    const owner = new Map(story.files.flatMap((file) => (file.capability === undefined ? [] : [[file.path, file.capability] as const])));
    lines += story.files.reduce((sum, file) => sum + file.lines, 0);
    const within = story.imports.filter(({ from, to }) => owner.has(from) && owner.has(to) && owner.get(from) !== owner.get(to));
    crossImports += new Set(within.map(({ from, to }) => `${from}\0${to}`)).size;
    // Another story's capability is always another capability; an end the survey places nowhere crosses no line.
    for (const edge of story.edges ?? []) {
      if (edge.from !== undefined && edge.to !== undefined) crossImports += new Set(edge.files.map(({ from, to }) => `${from}\0${to}`)).size;
    }
  }
  return { crossImports, lines };
}

/**
 * The structure of the arm `armProject` (its repository `repository`, cloned through `gh`, and its library on `server`
 * of the same name). Nothing is read until a commit is asked for.
 */
export function armStructure(server: Pick<Storytree, "openProject">, armProject: string, repository: string, gh: Gh): Structure {
  let ready: Promise<{ folder: string; clone: string; tree: AnnotatedTree }> | undefined;
  const prepare = async () => {
    const library = await server.openProject(armProject, { create: false });
    let tree: AnnotatedTree;
    try {
      tree = await library.projectTree();
    } finally {
      await library.close();
    }
    const folder = await mkdtemp(path.join(tmpdir(), "arm-structure-"));
    const clone = path.join(folder, "repository");
    gh(["repo", "clone", repository, clone, "--", "--quiet", "--no-checkout"]);
    return { folder, clone, tree };
  };
  return {
    async at(commit) {
      const { folder, clone, tree } = await (ready ??= prepare());
      const checkout = path.join(folder, commit);
      execFileSync("git", ["worktree", "add", "--quiet", "--detach", checkout, commit], { cwd: clone, stdio: "ignore" });
      try {
        // The arm's packages are named after its own stories only, never after storytree's own exceptions.
        return structureOf(await codeSurveyReader({ checkout: "current", alsoOwned: {} }).read(checkout, tree));
      } finally {
        execFileSync("git", ["worktree", "remove", "--force", checkout], { cwd: clone, stdio: "ignore" });
      }
    },
    async close() {
      if (ready === undefined) return;
      const { folder } = await ready.catch(() => ({ folder: undefined }));
      if (folder !== undefined) await rm(folder, { recursive: true, force: true });
    },
  };
}
