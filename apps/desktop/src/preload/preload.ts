// Capability 8 · Page bridge
import { contextBridge, ipcRenderer } from "electron";

import { FEEDBACK_IDENTITY_OFFERED } from "@storytree/app-setup/bridge";

import { createBridge } from "../bridge.js";
import { STAND_INS_OFFERED, type PageStandIns } from "../page-operations.js";

const feedbackIdentity = ipcRenderer.sendSync(FEEDBACK_IDENTITY_OFFERED) === true;
const standIns = ipcRenderer.sendSync(STAND_INS_OFFERED) as PageStandIns | undefined;
contextBridge.exposeInMainWorld("storytree", createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args), { feedbackIdentity, ...(standIns === undefined ? {} : { standIns }) }));
