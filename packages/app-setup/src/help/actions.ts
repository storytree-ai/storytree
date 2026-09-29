import { runSetupCheck } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";
import { addProject, projectFolder } from "../project/index.js";
import type { SetupHelpBridge } from "./bridge.js";
import { openFeedbackDraft } from "./feedback.js";
import { readShippedLicense } from "./license.js";

/** Platform adapters come from the frame; diagnostics and recovery stay with the agent link. */
export function setupHelpActions(options: {
  licenseFile: string;
  storytreeHome: string;
  chooseFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  /** The app's open library, which Add project writes to. */
  library(): Storytree;
}): SetupHelpBridge {
  return {
    readSetupLicense: () => readShippedLicense(options.licenseFile),
    async checkSetupFolder() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      // With no hook command supplied this is a diagnostic, not a second hook installer.
      // The returned fixes direct the user to their installed agent session for recovery.
      return (await runSetupCheck({ folder, storytreeHome: options.storytreeHome, openWaitMs: 2_000 })).lines;
    },
    async addProject() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      const library = options.library();
      const found = await projectFolder(folder, { library });
      if ("project" in found) return { status: "already a project", project: found.project, folder: found.folder };
      // The folder's own name, unless a project has it already: a second folder never joins it silently (ADR-0757).
      const added = await addProject(found.folder, found.suggestion, { home: options.storytreeHome, library });
      if (added.status === "name refused" || added.status === "folder refused") throw new Error(added.message);
      return added;
    },
    openFeedbackDraft: (draft) => openFeedbackDraft(draft, options.openExternal),
    async copyHelpText(text) {
      if (typeof text !== "string") throw new Error("Only prepared text can be copied.");
      await options.copyText(text);
    },
  };
}
