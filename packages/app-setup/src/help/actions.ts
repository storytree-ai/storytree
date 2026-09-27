import { runSetupCheck } from "@storytree/agent-link";
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
    openFeedbackDraft: (draft) => openFeedbackDraft(draft, options.openExternal),
    async copyHelpText(text) {
      if (typeof text !== "string") throw new Error("Only prepared text can be copied.");
      await options.copyText(text);
    },
  };
}
