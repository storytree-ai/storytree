/** Capability 3 · First-run guide. */
import { homedir } from "node:os";
import path from "node:path";
import { codexHookTrust } from "@storytree/session-management";
import { factoryFolder, makeFactoryFolder, setFactory } from "@storytree/project-and-caller";

import { HARNESS_IDS, watchedHarness, type Harness } from "@storytree/project-and-caller/caller";

import { agentsOnThisComputer, connectAgents, type ConnectionOptions } from "../connect/index.js";
import { deliveredCommand, deliveredCommandIfAny } from "../connect/installed.js";
import { CODEX_TRUST_STEP, runSetupCheck } from "../setup/index.js";
import type { Library, Storytree } from "@storytree/library";
import { addProject, deleteProject, keepOnThisComputer, projectFolder, projectInView, removeProject, whoLoses, type ProjectRecords } from "../project/index.js";
import type { AgentConnection, ProjectSentence, SetupHelpBridge } from "./bridge.js";
import { openFeedbackDraft } from "../journey-events/feedback.js";
import { readShippedLicense } from "./license.js";

const SENTENCE_ACTOR = "storytree app (Settings → Projects)";
/** What the guide says in a copy the installer did not deliver, which has no tools of its own to connect an agent to. */
const NOT_INSTALLED = "Connecting your coding agents is for installed copies: this copy was not delivered by the storytree installer, so it has no tools of its own to connect them to. Install storytree to connect them, or, to try it from a checkout, use a dev home (`pnpm --filter @storytree/app-setup dev-home`, see packages/app-setup/src/connect/README.md).";

/** `work` on project `name`'s library, opened for it alone and closed after; a project not in the library is refused, never made. */
async function withProject<T>(storytree: Storytree, name: string, work: (library: Library) => Promise<T>): Promise<T> {
  const library = await storytree.openProject(name, { create: false });
  try {
    return await work(library);
  } finally {
    await library.close();
  }
}

/** The anchor's halves that are said, as Settings → Projects shows them. */
function sentenceOf(anchor: { what?: string | undefined; audience?: string | undefined } | undefined): ProjectSentence {
  return { ...(anchor?.what === undefined ? {} : { what: anchor.what }), ...(anchor?.audience === undefined ? {} : { audience: anchor.audience }) };
}

/** Platform adapters come from the frame; diagnostics and recovery stay with Session management. */
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
  /** The installed app's own agent tools, used when the installer has recorded none in delivery.json. */
  agentTools?: string;
  /** Where the agents are looked for and connected. By default, this user's home and environment. */
  connections?: Pick<ConnectionOptions, "home" | "env" | "run">;
  /** The project records the parts the frame mounts contribute, which Delete forgets with a project. */
  projectRecords?: readonly ProjectRecords[];
}): SetupHelpBridge {
  // First launch asks for no factory folder (ADR-1118): with none chosen, storytree's own is made as the app starts.
  makeFactoryFolder(options.storytreeHome);
  // The tools an agent is connected to: those the installer recorded, else the ones this app carries.
  const installed = () => deliveredCommand(options.storytreeHome, options.agentTools ?? options.storytreeHome);
  return {
    readSetupLicense: () => readShippedLicense(options.licenseFile),
    async agentConnections() {
      // Codex runs storytree's hooks only once the user trusts them; a hook that has run is the proof (Session management 3.18).
      const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex"));
      const trust = codexHookTrust({ storytreeHome: options.storytreeHome, codexHome });
      const connections: AgentConnection[] = [];
      if (trust === "running") connections.push({ agent: "Codex", state: "running", message: "Codex is connected, and runs storytree's hooks." });
      if (trust === "waiting") connections.push({ agent: "Codex", state: "waiting", message: "Codex is connected, with one step left: it runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work.", step: CODEX_TRUST_STEP });
      return connections;
    },
    async agentsToConnect() {
      // A development copy is told so, not handed the installer's error: its own tools stay out of the user's real home.
      const command = deliveredCommandIfAny(options.storytreeHome, options.agentTools ?? options.storytreeHome);
      if (command === undefined) return { notInstalled: NOT_INSTALLED };
      return (await agentsOnThisComputer({ ...options.connections, installed: command })).map(({ harness, agent, connected }) => ({ harness, agent, connected }));
    },
    async connectAgent(harness) {
      if (typeof harness !== "string" || !(HARNESS_IDS as readonly string[]).includes(harness)) throw new Error("Choose an agent this computer runs.");
      const [result] = await connectAgents({ ...options.connections, harnesses: [harness as Harness], installed: installed() });
      return { agent: watchedHarness(harness)?.label ?? harness, connected: result!.tools !== "not connected", next: result!.next };
    },
    async checkSetupFolder() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      // With no hook command supplied this is a diagnostic, not a second hook installer.
      // The returned fixes direct the user to their installed agent session for recovery.
      return (await runSetupCheck({ folder, storytreeHome: options.storytreeHome, openWaitMs: 2_000 })).lines;
    },
    async factoryFolder() {
      return factoryFolder(options.storytreeHome);
    },
    async chooseFactory() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      // Set up or validated as first launch does, and switched with no approval: the desktop app is recorded instead.
      const chosen = setFactory(folder, options.storytreeHome, { through: "desktop app" });
      return { status: chosen.status, folder: chosen.folder };
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
    async projectSentence(name) {
      if (typeof name !== "string") throw new Error("There is no project with that name.");
      return await withProject(options.library(), name, async (library) => sentenceOf(await library.anchor()));
    },
    async setProjectSentence(name, what, audience) {
      if (typeof name !== "string" || typeof what !== "string" || typeof audience !== "string") throw new Error("There is no project with that name.");
      return await withProject(options.library(), name, async (library) => {
        const halves = { what: what.trim() || undefined, audience: audience.trim() || undefined };
        if (halves.what !== undefined || halves.audience !== undefined || (await library.anchor()) !== undefined) await library.setAnchor(halves, { actor: SENTENCE_ACTOR });
        return sentenceOf(await library.anchor());
      });
    },
    async deletableProjects() {
      const library = options.library();
      const shown = await projectInView(library, options.storytreeHome);
      return (await library.listProjects()).filter((project) => project !== shown).map((project) => ({ project, warning: whoLoses(project, options.storytreeHome) }));
    },
    async deleteProject(name, typed, snapshot) {
      if (typeof name !== "string" || typeof typed !== "string" || typeof snapshot !== "boolean") throw new Error("There is no project with that name.");
      const deleted = await deleteProject(name, { confirm: typed, snapshot, home: options.storytreeHome, library: options.library(), records: options.projectRecords });
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
