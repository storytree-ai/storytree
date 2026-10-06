/** Capability 3 · First-run guide. */
import { homedir } from "node:os";
import path from "node:path";
import { CODEX_TRUST_STEP, codexHookTrust, readProjectChoice, runSetupCheck } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";
import { addProject, deleteProject, keepOnThisComputer, projectFolder, removeProject, whoLoses } from "../project/index.js";
import type { AgentConnection, SetupHelpBridge } from "./bridge.js";
import { openFeedbackDraft } from "./feedback.js";
import { readShippedLicense } from "./license.js";

/** Platform adapters come from the frame; diagnostics and recovery stay with the agent link. */
export function setupHelpActions(options: {
  licenseFile: string;
  storytreeHome: string;
  /** Codex's home. By default, CODEX_HOME or ~/.codex. */
  codexHome?: string;
  chooseFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  /** The app's open library, which Add project writes to and Remove reads. */
  library(): Storytree;
}): SetupHelpBridge {
  return {
    readSetupLicense: () => readShippedLicense(options.licenseFile),
    async agentConnections() {
      // Codex runs storytree's hooks only once the user trusts them; a hook that has run is the proof (agent link 3.18).
      const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex"));
      const trust = codexHookTrust({ storytreeHome: options.storytreeHome, codexHome });
      const connections: AgentConnection[] = [];
      if (trust === "running") connections.push({ agent: "Codex", state: "running", message: "Codex is connected, and runs storytree's hooks." });
      if (trust === "waiting") connections.push({ agent: "Codex", state: "waiting", message: "Codex is connected, with one step left: it runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work.", step: CODEX_TRUST_STEP });
      return connections;
    },
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
      if ("project" in found) {
        keepOnThisComputer(found.project, options.storytreeHome);
        return { status: "already a project", project: found.project, folder: found.folder };
      }
      // The folder's own name, unless a project has it already: a second folder never joins it silently (ADR-0757).
      const added = await addProject(found.folder, found.suggestion, { home: options.storytreeHome, library });
      if (added.status === "name refused" || added.status === "folder refused") throw new Error(added.message);
      return added;
    },
    async removeProject(name) {
      if (typeof name !== "string") throw new Error("There is no project with that name.");
      const removed = await removeProject(name, { home: options.storytreeHome, library: options.library() });
      if (removed.status === "no such project") throw new Error(removed.message);
      return removed;
    },
    async deletableProjects() {
      const shown = readProjectChoice(path.join(options.storytreeHome, "project-choice.json"));
      return (await options.library().listProjects()).filter((project) => project !== shown).map((project) => ({ project, warning: whoLoses(project, options.storytreeHome) }));
    },
    async deleteProject(name, typed, snapshot) {
      if (typeof name !== "string" || typeof typed !== "string" || typeof snapshot !== "boolean") throw new Error("There is no project with that name.");
      const deleted = await deleteProject(name, { confirm: typed, snapshot, home: options.storytreeHome, library: options.library() });
      if (deleted.status !== "deleted") throw new Error(deleted.message);
      return deleted;
    },
    openFeedbackDraft: (draft) => openFeedbackDraft(draft, options.openExternal),
    async copyHelpText(text) {
      if (typeof text !== "string") throw new Error("Only prepared text can be copied.");
      await options.copyText(text);
    },
  };
}
