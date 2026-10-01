import { wireCopyControl } from "./copy-command.js";

const button = document.querySelector<HTMLButtonElement>("#copy-command");
const command = document.querySelector<HTMLElement>("#install-command");
const status = document.querySelector<HTMLElement>("#copy-status");
if (button && command && status && typeof navigator.clipboard?.writeText === "function") wireCopyControl(button, command, status, navigator.clipboard);
