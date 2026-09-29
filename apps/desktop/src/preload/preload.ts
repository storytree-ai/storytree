/**
 * The preload script: exposes the bridge's functions (bridge.ts) to the page through the context
 * bridge, and nothing else. The page runs sandboxed, with no Node and no Electron.
 */
import { contextBridge, ipcRenderer } from "electron";
import { SETTINGS_CHANNELS, type SettingsBridge } from "@storytree/agent-link/view";
import { SURFACES_CHANNELS, type SurfacesBridge } from "@storytree/app/surfaces";

import { CHANNELS, type StorytreeBridge } from "../bridge.js";

const bridge: StorytreeBridge & SettingsBridge & SurfacesBridge = {
  readSettings: () => ipcRenderer.invoke(SETTINGS_CHANNELS.readSettings),
  saveSetting: (name, values) => ipcRenderer.invoke(SETTINGS_CHANNELS.saveSetting, name, values),
  readSurfaces: () => ipcRenderer.invoke(SURFACES_CHANNELS.readSurfaces),
  saveSurface: (words) => ipcRenderer.invoke(SURFACES_CHANNELS.saveSurface, words),
  checkForUpdates: (action) => ipcRenderer.invoke(CHANNELS.checkForUpdates, action) as ReturnType<StorytreeBridge["checkForUpdates"]>,
  readSetupLicense: () => ipcRenderer.invoke(CHANNELS.readSetupLicense) as ReturnType<StorytreeBridge["readSetupLicense"]>,
  checkSetupFolder: () => ipcRenderer.invoke(CHANNELS.checkSetupFolder) as ReturnType<StorytreeBridge["checkSetupFolder"]>,
  addProject: () => ipcRenderer.invoke(CHANNELS.addProject) as ReturnType<StorytreeBridge["addProject"]>,
  openFeedbackDraft: (draft) => ipcRenderer.invoke(CHANNELS.openFeedbackDraft, draft) as ReturnType<StorytreeBridge["openFeedbackDraft"]>,
  copyHelpText: (text) => ipcRenderer.invoke(CHANNELS.copyHelpText, text) as ReturnType<StorytreeBridge["copyHelpText"]>,
  arcView: (name, id) => ipcRenderer.invoke(CHANNELS.arcView, name, id) as ReturnType<StorytreeBridge["arcView"]>,
  holds: (name) => ipcRenderer.invoke(CHANNELS.holds, name) as ReturnType<StorytreeBridge["holds"]>,
  contextReadings: (name, sessions) => ipcRenderer.invoke(CHANNELS.contextReadings, name, sessions) as ReturnType<StorytreeBridge["contextReadings"]>,
  idleAfterMs: () => ipcRenderer.invoke(CHANNELS.idleAfterMs) as Promise<number>,
  leaveAfterMs: () => ipcRenderer.invoke(CHANNELS.leaveAfterMs) as Promise<number>,
  windowReading: (name, session) => ipcRenderer.invoke(CHANNELS.windowReading, name, session) as ReturnType<StorytreeBridge["windowReading"]>,

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
