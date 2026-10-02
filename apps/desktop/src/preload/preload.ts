/**
 * The preload script: exposes the bridge's functions (bridge.ts) to the page through the context
 * bridge, and nothing else. The page runs sandboxed, with no Node and no Electron.
 */
import { contextBridge, ipcRenderer } from "electron";

import { createBridge } from "../bridge.js";

contextBridge.exposeInMainWorld("storytree", createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
