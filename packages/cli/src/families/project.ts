/**
 * Capability 3 · Library. `storytree project remove <project>`: take a project added by mistake off this computer's list.
 * `storytree project delete <project> --confirm <project>`: delete its records (ADR-0831).
 * `storytree import <folder>`: import an existing JavaScript or TypeScript project into this one, as mapped stories (ADR-0993).
 * A front door only: the app setup owns removing, deleting and importing into a project.
 */
import path from "node:path";

import { findProject, MARKER_FILE } from "@storytree/session-management/routing";

import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

const USAGE = "project remove <project>";
const DELETE_USAGE = "project delete <project> --confirm <project> [--no-snapshot]";

export const projectFamily: Family = {
  name: "project",
  summary: "take a project off this computer's list, or delete its records",
  verbs: [{
    name: "remove",
    usage: USAGE,
    summary: "take a project added by mistake off this computer's list and free its folder here; its records stay in the library",
    async act(args) {
      if (args.words.length !== 1 || args.names.length) throw new Refusal(`usage: storytree ${USAGE}`, { code: 2 });
      const { removeProject } = await import("@storytree/app-setup");
      const removed = await removeProject(args.word(0, "a project", USAGE));
      if (removed.status === "no such project") throw new Refusal(removed.message);
      const folder = removed.kept !== undefined
        ? ` Its folder ${removed.kept} still names it in ${MARKER_FILE}, which git tracks, so that file was left for you: delete it to free the folder; until then, adding the folder again brings the project back.`
        : removed.freed !== undefined
          ? ` Its folder ${removed.freed} is no longer a storytree project here: it can be set up afresh, or made this project's folder again on purpose with \`storytree doctor --join ${removed.project}\` there.`
          : "";
      return { text: `"${removed.project}" is off this computer's list of projects. Its records stay in the library.${folder}` };
    },
  }, {
    name: "delete",
    usage: DELETE_USAGE,
    summary: "delete a project's records from the library, for every computer using it, once its name is typed; a snapshot goes to this computer's backups first unless --no-snapshot",
    switches: ["no-snapshot"],
    async act(args, context) {
      if (args.words.length !== 1 || args.names.some((name) => name !== "confirm" && name !== "no-snapshot")) throw new Refusal(`usage: storytree ${DELETE_USAGE}`, { code: 2 });
      const project = args.word(0, "a project", DELETE_USAGE);
      const confirm = args.text("confirm");
      const { deleteProject, whoLoses } = await import("@storytree/app-setup");
      if (confirm === undefined) {
        throw new Refusal(`${whoLoses(project)}\nA snapshot goes to this computer's backups first; add --no-snapshot to skip it.\nTo delete it, type its name: storytree project delete ${project} --confirm ${project}`);
      }
      const inUse = findProject(context.cwd).project;
      const deleted = await deleteProject(project, { confirm, snapshot: !args.has("no-snapshot"), ...(inUse === undefined ? {} : { inUse }) });
      if (deleted.status !== "deleted") throw new Refusal(deleted.message);
      const snapshot = deleted.snapshot === undefined ? " No snapshot was taken." : ` Its snapshot is at ${deleted.snapshot}, and restores it.`;
      const folder = deleted.kept !== undefined ? ` Its folder ${deleted.kept} still names it in ${MARKER_FILE}, which git tracks: delete that file to free the folder.` : "";
      return { text: `"${deleted.project}" is deleted: its records are gone from the library, for every computer using it.${snapshot}${folder}` };
    },
  }],
};

const IMPORT_USAGE = "import <folder>";

export const importFamily: Family = {
  name: "import",
  summary: "import an existing JavaScript or TypeScript project into this one: one mapped story per package it declares",
  verbs: [],
  bare: {
    name: "import",
    usage: IMPORT_USAGE,
    summary: "record the folder as imported by this project and map each package it declares to a mapped story; again, it adds new packages and drops gone ones; nothing is written into the folder",
    async act(args, context) {
      if (args.words.length !== 1 || args.names.length) throw new Refusal(`usage: storytree ${IMPORT_USAGE}`, { code: 2 });
      const { importLines, importProject, ImportRefusedError } = await import("@storytree/app-setup");
      const folder = path.resolve(context.cwd, args.word(0, "a folder", IMPORT_USAGE));
      const imported = await importProject({ folder, library: await context.library(), storytree: await context.server() }).catch((error: unknown) => {
        throw error instanceof ImportRefusedError ? new Refusal(error.message) : error;
      });
      const from = imported.repository === undefined ? "" : ` (${imported.repository} at ${imported.commit?.slice(0, 12) ?? "an unknown commit"})`;
      const lines = [
        `Imported ${imported.folder}${from}: ${imported.added.length} mapped ${imported.added.length === 1 ? "story" : "stories"} added, ${imported.retired.length} retired, ${imported.kept.length} kept as they stand.`,
        ...imported.added.map((story) => `  + ${story.id}  ${story.title}`),
        ...imported.retired.map((id) => `  - ${id}  retired: its package is gone`),
        ...importLines(imported),
      ];
      return { text: lines.join("\n"), next: [{ command: "storytree tree", why: "see the mapped stories in the plan" }] };
    },
  },
};
