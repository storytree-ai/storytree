/**
 * `storytree project remove <project>`: take a project added by mistake off this computer's list.
 * A front door only: the app setup owns removing a project, and keeps its records in the library.
 */
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
    summary: "take a project added by mistake off this computer's list; its records stay in the library",
    async act(args) {
      if (args.words.length !== 1 || args.names.length) throw new Refusal(`usage: storytree ${USAGE}`, { code: 2 });
      const removed = await removeProject(args.word(0, "a project", USAGE));
      if (removed.status === "no such project") throw new Refusal(removed.message);
      return {
        text: `"${removed.project}" is off this computer's list of projects. Its records stay in the library, and its folder is left as it is: adding that folder again (the app's Add project) brings it back.`,
      };
    },
  }],
};
