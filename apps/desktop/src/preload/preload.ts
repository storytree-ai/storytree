/**
 * Capability 1 · Lifecycle. The preload script: exposes the bridge's functions (bridge.ts) to the page through the context
 * bridge, and nothing else. The page runs sandboxed, with no Node and no Electron. Whether sign-in for feedback is
 * among them is the main process's answer, asked once before the page loads (app setup contract 5.6).
 */
import { contextBridge, ipcRenderer } from "electron";

import { FEEDBACK_IDENTITY_OFFERED } from "@storytree/app-setup/bridge";

import { createBridge } from "../bridge.js";

const feedbackIdentity = ipcRenderer.sendSync(FEEDBACK_IDENTITY_OFFERED) === true;
contextBridge.exposeInMainWorld("storytree", createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args), { feedbackIdentity }));
