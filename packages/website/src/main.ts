import { copyCommand } from "./copy-command.js";

const button = document.querySelector<HTMLButtonElement>("#copy-command");
const command = document.querySelector<HTMLElement>("#install-command");
const status = document.querySelector<HTMLElement>("#copy-status");
if (button && command && status && typeof navigator.clipboard?.writeText === "function") {
  button.hidden = false;
  button.addEventListener("click", async () => {
    if (button.dataset.copyState === "pending") return;
    button.setAttribute("aria-disabled", "true");
    button.dataset.copyState = "pending";
    button.textContent = "Copying…";
    status.textContent = "Copying…";
    const copied = await copyCommand(command.textContent ?? "", navigator.clipboard);
    button.dataset.copyState = copied ? "copied" : "failed";
    button.textContent = copied ? "Copied" : "Copy command";
    status.textContent = copied ? "Copied. Paste into PowerShell." : "Could not copy. Select the command above and copy it manually.";
    button.removeAttribute("aria-disabled");
  });
}
