/**
 * Capability 3 · First-run guide and capability 12 · Import an existing project.
 * `storytree project remove <project>`: take a project added by mistake off this computer's list.
 * `storytree project delete <project> --confirm <project>`: delete its records (ADR-0831).
 * `storytree import <folder>`: import an existing JavaScript or TypeScript project into this one, as mapped stories (ADR-0993).
 */
import { verb, VerbRefusal, type Verb, type VerbInputs } from "@storytree/library/verbs";

import type { ImportVerbContext, SetupVerbContext } from "../verbs.js";

const NO_TOOL = { absent: "a project is removed, deleted or imported into by the person at this computer, from the app or a terminal" };

const remove = verb({
  command: { family: "project", name: "remove", summary: "take a project added by mistake off this computer's list and free its folder here; its records stay in the library" },
  tool: NO_TOOL,
  callerless: true,
  inputs: { project: { kind: "text", word: 0, describe: "the project to take off this computer's list" } },
  async act({ project }, _context: SetupVerbContext) {
    const { removeProject } = await import("./index.js");
    const { MARKER_FILE } = await import("@storytree/project-and-caller/routing");
    const removed = await removeProject(project);
    if (removed.status === "no such project") throw new VerbRefusal(removed.message);
    const folder = removed.kept !== undefined
      ? ` Its folder ${removed.kept} still names it in ${MARKER_FILE}, which git tracks, so that file was left for you: delete it to free the folder; until then, adding the folder again brings the project back.`
      : removed.freed !== undefined
        ? ` Its folder ${removed.freed} is no longer a storytree project here: it can be set up afresh, or made this project's folder again on purpose with \`storytree doctor --join ${removed.project}\` there.`
        : "";
    return { text: `"${removed.project}" is off this computer's list of projects. Its records stay in the library.${folder}` };
  },
});

const deleting = verb({
  command: {
    family: "project", name: "delete", usage: "project delete <project> --confirm <project> [--no-snapshot]",
    summary: "delete a project's records from the library, for every computer using it, once its name is typed; a snapshot goes to this computer's backups first unless --no-snapshot",
  },
  tool: NO_TOOL,
  callerless: true,
  inputs: {
    project: { kind: "text", word: 0, describe: "the project whose records to delete" },
    confirm: { kind: "text", optional: true, describe: "the project's name again, typed to confirm" },
    "no-snapshot": { kind: "switch", describe: "skip the snapshot to this computer's backups" },
  },
  async act({ project, confirm, "no-snapshot": noSnapshot }, context: SetupVerbContext) {
    const { deleteProject, whoLoses } = await import("./index.js");
    if (confirm === undefined) {
      throw new VerbRefusal(`${whoLoses(project)}\nA snapshot goes to this computer's backups first; add --no-snapshot to skip it.\nTo delete it, type its name: storytree project delete ${project} --confirm ${project}`);
    }
    const { findProject, MARKER_FILE } = await import("@storytree/project-and-caller/routing");
    const inUse = findProject(context.folder).project;
    const deleted = await deleteProject(project, { confirm, snapshot: !noSnapshot, ...(inUse === undefined ? {} : { inUse }) });
    if (deleted.status !== "deleted") throw new VerbRefusal(deleted.message);
    const snapshot = deleted.snapshot === undefined ? " No snapshot was taken." : ` Its snapshot is at ${deleted.snapshot}, and restores it.`;
    const folder = deleted.kept !== undefined ? ` Its folder ${deleted.kept} still names it in ${MARKER_FILE}, which git tracks: delete that file to free the folder.` : "";
    return { text: `"${deleted.project}" is deleted: its records are gone from the library, for every computer using it.${snapshot}${folder}` };
  },
});

export const PROJECT_VERBS: readonly Verb<VerbInputs, SetupVerbContext>[] = [remove, deleting];

export const IMPORT = verb({
  command: {
    family: "import", name: "import",
    summary: "record the folder as imported by this project and map each package it declares to a mapped story; again, it adds new packages and drops gone ones; nothing is written into the folder",
  },
  tool: NO_TOOL,
  inputs: { folder: { kind: "text", word: 0, describe: "the folder of the project to import" } },
  async act({ folder }, context: ImportVerbContext) {
    const path = await import("node:path");
    const { importLines, importProject, ImportRefusedError } = await import("./importing.js");
    const imported = await importProject({ folder: path.resolve(context.folder, folder), library: context.library, storytree: context.server }).catch((error: unknown) => {
      throw error instanceof ImportRefusedError ? new VerbRefusal(error.message) : error;
    });
    const from = imported.repository === undefined ? "" : ` (${imported.repository} at ${imported.commit?.slice(0, 12) ?? "an unknown commit"})`;
    const lines = [
      `Imported ${imported.folder}${from}: ${imported.added.length} mapped ${imported.added.length === 1 ? "story" : "stories"} added, ${imported.retired.length} retired, ${imported.kept.length} kept as they stand.`,
      ...imported.added.map((story) => `  + ${story.id}  ${story.title}`),
      ...imported.retired.map((id) => `  - ${id}  retired: its package is gone`),
      ...importLines(imported),
    ];
    return { text: lines.join("\n"), next: [{ command: "tree", why: "see the mapped stories in the plan" }] };
  },
});
