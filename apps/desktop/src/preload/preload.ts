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
  checkForUpdates: (action) => ipcRenderer.invoke("storytree:missing-update-handler", action) as ReturnType<StorytreeBridge["checkForUpdates"]>,
  readSignIn: () => ipcRenderer.invoke(CHANNELS.readSignIn) as ReturnType<StorytreeBridge["readSignIn"]>,
  setSignIn: (on) => ipcRenderer.invoke(CHANNELS.setSignIn, on) as ReturnType<StorytreeBridge["setSignIn"]>,
  readInstallChoice: () => ipcRenderer.invoke(CHANNELS.readInstallChoice) as ReturnType<StorytreeBridge["readInstallChoice"]>,
  setInstallChoice: (choice) => ipcRenderer.invoke(CHANNELS.setInstallChoice, choice) as ReturnType<StorytreeBridge["setInstallChoice"]>,
  readSetupLicense: () => ipcRenderer.invoke(CHANNELS.readSetupLicense) as ReturnType<StorytreeBridge["readSetupLicense"]>,
  agentConnections: () => ipcRenderer.invoke(CHANNELS.agentConnections) as ReturnType<StorytreeBridge["agentConnections"]>,
  checkSetupFolder: () => ipcRenderer.invoke(CHANNELS.checkSetupFolder) as ReturnType<StorytreeBridge["checkSetupFolder"]>,
  addProject: () => ipcRenderer.invoke(CHANNELS.addProject) as ReturnType<StorytreeBridge["addProject"]>,
  removeProject: (name) => ipcRenderer.invoke(CHANNELS.removeProject, name) as ReturnType<StorytreeBridge["removeProject"]>,
  deletableProjects: () => ipcRenderer.invoke(CHANNELS.deletableProjects) as ReturnType<StorytreeBridge["deletableProjects"]>,
  deleteProject: (name, typed, snapshot) => ipcRenderer.invoke(CHANNELS.deleteProject, name, typed, snapshot) as ReturnType<StorytreeBridge["deleteProject"]>,
  openFeedbackDraft: (draft) => ipcRenderer.invoke(CHANNELS.openFeedbackDraft, draft) as ReturnType<StorytreeBridge["openFeedbackDraft"]>,
  copyHelpText: (text) => ipcRenderer.invoke(CHANNELS.copyHelpText, text) as ReturnType<StorytreeBridge["copyHelpText"]>,
  arcViews: (name) => ipcRenderer.invoke(CHANNELS.arcViews, name) as ReturnType<StorytreeBridge["arcViews"]>,
  holds: (name) => ipcRenderer.invoke(CHANNELS.holds, name) as ReturnType<StorytreeBridge["holds"]>,
  contextReadings: (name, sessions) => ipcRenderer.invoke(CHANNELS.contextReadings, name, sessions) as ReturnType<StorytreeBridge["contextReadings"]>,
  idleAfterMs: () => ipcRenderer.invoke(CHANNELS.idleAfterMs) as Promise<number>,
  leaveAfterMs: () => ipcRenderer.invoke(CHANNELS.leaveAfterMs) as Promise<number>,
  windowReading: (name, session) => ipcRenderer.invoke(CHANNELS.windowReading, name, session) as ReturnType<StorytreeBridge["windowReading"]>,
  windowReadings: (name, sessions) => ipcRenderer.invoke(CHANNELS.windowReadings, name, sessions) as ReturnType<StorytreeBridge["windowReadings"]>,

  listProjects: () => ipcRenderer.invoke(CHANNELS.listProjects) as Promise<string[]>,
  projectSelection: () => ipcRenderer.invoke(CHANNELS.projectSelection) as ReturnType<StorytreeBridge["projectSelection"]>,
  chooseProject: (name) => ipcRenderer.invoke(CHANNELS.chooseProject, name) as ReturnType<StorytreeBridge["chooseProject"]>,
  projectTree: (name) => ipcRenderer.invoke(CHANNELS.projectTree, name) as ReturnType<StorytreeBridge["projectTree"]>,
  changesSince: (name, cursor) => ipcRenderer.invoke(CHANNELS.changesSince, name, cursor) as ReturnType<StorytreeBridge["changesSince"]>,
  linesSince: (name, cursor) => ipcRenderer.invoke(CHANNELS.linesSince, name, cursor) as ReturnType<StorytreeBridge["linesSince"]>,
  frontCovers: (name, nodeId) => ipcRenderer.invoke(CHANNELS.frontCovers, name, nodeId) as ReturnType<StorytreeBridge["frontCovers"]>,
  relatedNotes: (name, noteId) => ipcRenderer.invoke(CHANNELS.relatedNotes, name, noteId) as ReturnType<StorytreeBridge["relatedNotes"]>,
  standingDelegations: (name) => ipcRenderer.invoke(CHANNELS.standingDelegations, name) as ReturnType<StorytreeBridge["standingDelegations"]>,
  codeSurvey: (name) => ipcRenderer.invoke(CHANNELS.codeSurvey, name) as ReturnType<StorytreeBridge["codeSurvey"]>,
};

contextBridge.exposeInMainWorld("storytree", bridge);
