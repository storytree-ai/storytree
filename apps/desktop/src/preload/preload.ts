/**
 * The preload script: exposes the bridge's functions (bridge.ts) to the page through the context
 * bridge, and nothing else. The page runs sandboxed, with no Node and no Electron.
 */
import { contextBridge, ipcRenderer } from "electron";

import { CHANNELS, type StorytreeBridge } from "../bridge.js";

const bridge: StorytreeBridge = {
  readSetupLicense: () => ipcRenderer.invoke(CHANNELS.readSetupLicense) as ReturnType<StorytreeBridge["readSetupLicense"]>,
  checkSetupFolder: () => ipcRenderer.invoke(CHANNELS.checkSetupFolder) as ReturnType<StorytreeBridge["checkSetupFolder"]>,
  openFeedbackDraft: (draft) => ipcRenderer.invoke(CHANNELS.openFeedbackDraft, draft) as ReturnType<StorytreeBridge["openFeedbackDraft"]>,
  copyHelpText: (text) => ipcRenderer.invoke(CHANNELS.copyHelpText, text) as ReturnType<StorytreeBridge["copyHelpText"]>,
  arcView: (name, id) => ipcRenderer.invoke(CHANNELS.arcView, name, id) as ReturnType<StorytreeBridge["arcView"]>,
  waitHolds: (name, id) => ipcRenderer.invoke(CHANNELS.waitHolds, name, id) as ReturnType<StorytreeBridge["waitHolds"]>,
  heldOnQuestion: (name, id) => ipcRenderer.invoke(CHANNELS.heldOnQuestion, name, id) as ReturnType<StorytreeBridge["heldOnQuestion"]>,

  listProjects: () => ipcRenderer.invoke(CHANNELS.listProjects) as Promise<string[]>,
  projectSelection: () => ipcRenderer.invoke(CHANNELS.projectSelection) as ReturnType<StorytreeBridge["projectSelection"]>,
  chooseProject: (name) => ipcRenderer.invoke(CHANNELS.chooseProject, name) as ReturnType<StorytreeBridge["chooseProject"]>,
  projectTree: (name) => ipcRenderer.invoke(CHANNELS.projectTree, name) as ReturnType<StorytreeBridge["projectTree"]>,
  changesSince: (name, cursor) => ipcRenderer.invoke(CHANNELS.changesSince, name, cursor) as ReturnType<StorytreeBridge["changesSince"]>,
  linesSince: (name, cursor) => ipcRenderer.invoke(CHANNELS.linesSince, name, cursor) as ReturnType<StorytreeBridge["linesSince"]>,
  frontCovers: (name, nodeId) => ipcRenderer.invoke(CHANNELS.frontCovers, name, nodeId) as ReturnType<StorytreeBridge["frontCovers"]>,
  relatedNotes: (name, noteId) => ipcRenderer.invoke(CHANNELS.relatedNotes, name, noteId) as ReturnType<StorytreeBridge["relatedNotes"]>,
};

contextBridge.exposeInMainWorld("storytree", bridge);
