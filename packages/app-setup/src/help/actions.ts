// Capability 3 · First-run guide.
import { homedir } from "node:os";
import path from "node:path";
import { codexHookTrust } from "@storytree/session-management";
import { factoryFolder, makeFactoryFolder, readStandIns, setFactory } from "@storytree/project-and-caller";
import { unnamedPlugins } from "@storytree/plugin-loader/factory";

import { HARNESS_IDS, watchedHarness, type Harness } from "@storytree/project-and-caller/caller";

import { agentsOnThisComputer, connectAgents, type ConnectionOptions } from "../connect/index.js";
import { deliveredCommand, deliveredCommandIfAny } from "../connect/installed.js";
import { CODEX_TRUST_STEP, runSetupCheck } from "../setup/index.js";
import type { Library, Storytree } from "@storytree/library";
import { addProject, deleteProject, projectFolder, projectInView, removeProject, whoLoses, type ProjectRecords } from "../project/index.js";
import { AGENT_SEARCH_SECONDS, type AgentConnection, type ProjectSentence, type SetupHelpBridge } from "./bridge.js";
import { openFeedbackDraft } from "../journey-events/feedback.js";
import { readShippedLicense } from "./license.js";

const SENTENCE_ACTOR = "storytree app (Settings → Projects)";
const NOT_INSTALLED = "Connecting your coding agents is for installed copies: this copy was not delivered by the storytree installer, so it has no tools of its own to connect them to. Install storytree to connect them, or, to try it from a checkout, use a dev home (`pnpm --filter @storytree/app-setup dev-home`, see packages/app-setup/src/connect/README.md).";

async function withProject<T>(storytree: Storytree, name: string, work: (library: Library) => Promise<T>): Promise<T> {
  const library = await storytree.openProject(name, { create: false });
  try {
    return await work(library);
  } finally {
    await library.close();
  }
}

function sentenceOf(anchor: { what?: string | undefined; audience?: string | undefined } | undefined): ProjectSentence {
  return { ...(anchor?.what === undefined ? {} : { what: anchor.what }), ...(anchor?.audience === undefined ? {} : { audience: anchor.audience }) };
}

export function setupHelpActions(options: {
  licenseFile: string;
  storytreeHome: string;
  codexHome?: string;
  chooseFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  library(): Storytree;
  agentTools?: string;
  connections?: Pick<ConnectionOptions, "home" | "env" | "run"> & { probeTimeoutMs?: number };
  projectRecords?: readonly ProjectRecords[];
}): SetupHelpBridge {
  makeFactoryFolder(options.storytreeHome);
  const installed = () => deliveredCommand(options.storytreeHome, options.agentTools ?? options.storytreeHome);
  return {
    readSetupLicense: () => readShippedLicense(options.licenseFile),
    async agentConnections() {
      const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex"));
      const trust = codexHookTrust({ storytreeHome: options.storytreeHome, codexHome });
      const connections: AgentConnection[] = [];
      if (trust === "running") connections.push({ agent: "Codex", state: "running", message: "Codex is connected, and runs storytree's hooks." });
      if (trust === "waiting") connections.push({ agent: "Codex", state: "waiting", message: "Codex is connected, with one step left: it runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work.", step: CODEX_TRUST_STEP });
      return connections;
    },
    async agentsToConnect() {
      const command = deliveredCommandIfAny(options.storytreeHome, options.agentTools ?? options.storytreeHome);
      if (command === undefined) return { notInstalled: NOT_INSTALLED };
      const found = await agentsOnThisComputer({ probeTimeoutMs: AGENT_SEARCH_SECONDS * 1000, ...options.connections, installed: command });
      return found.map(({ harness, agent, connected, note }) => note === undefined ? { harness, agent, connected } : { harness, agent, connected, note });
    },
    async connectAgent(harness) {
      if (typeof harness !== "string" || !(HARNESS_IDS as readonly string[]).includes(harness)) throw new Error("Choose an agent this computer runs.");
      const [result] = await connectAgents({ ...options.connections, harnesses: [harness as Harness], installed: installed() });
      return { agent: watchedHarness(harness)?.label ?? harness, connected: result!.tools !== "not connected", next: result!.next, ...(result!.where === undefined ? {} : { where: result!.where }) };
    },
    async checkSetupFolder() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      return (await runSetupCheck({ folder, storytreeHome: options.storytreeHome, openWaitMs: 2_000, unnamedPlugins: () => unnamedPlugins(readStandIns(options.storytreeHome)) })).lines;
    },
    async factoryFolder() {
      return factoryFolder(options.storytreeHome);
    },
    async chooseFactory() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      const chosen = setFactory(folder, options.storytreeHome, { through: "desktop app" });
      return { status: chosen.status, folder: chosen.folder };
    },
    async addProject() {
      const folder = await options.chooseFolder();
      if (folder === undefined) return null;
      const library = options.library();
      const found = await projectFolder(folder, { library });
      const added = await addProject(found.folder, "project" in found ? found.project : found.suggestion, { home: options.storytreeHome, library });
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
