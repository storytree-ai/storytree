/**
 * `storytree project remove <project>`: take a project added by mistake off this computer's list.
 * A front door only: the app setup owns removing a project, and keeps its records in the library.
 */
import { MARKER_FILE } from "@storytree/agent-link";
import { removeProject } from "@storytree/app-setup";

import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

const USAGE = "project remove <project>";

export const projectFamily: Family = {
  name: "project",
  summary: "take a project off this computer's list",
  verbs: [{
    name: "remove",
    usage: USAGE,
    summary: "take a project added by mistake off this computer's list and free its folder here; its records stay in the library",
    async act(args) {
      if (args.words.length !== 1 || args.names.length) throw new Refusal(`usage: storytree ${USAGE}`, { code: 2 });
      const removed = await removeProject(args.word(0, "a project", USAGE));
      if (removed.status === "no such project") throw new Refusal(removed.message);
      const folder = removed.kept !== undefined
        ? ` Its folder ${removed.kept} still names it in ${MARKER_FILE}, which git tracks, so that file was left for you: delete it to free the folder; until then, adding the folder again brings the project back.`
        : removed.freed !== undefined
          ? ` Its folder ${removed.freed} is no longer a storytree project here: it can be set up afresh, or made this project's folder again on purpose with \`storytree doctor --join ${removed.project}\` there.`
          : "";
      return { text: `"${removed.project}" is off this computer's list of projects. Its records stay in the library.${folder}` };
    },
  }],
};
