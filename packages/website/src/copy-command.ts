/** Report success only once the browser has accepted the exact visible command. */
export async function copyCommand(command: string, clipboard: Pick<Clipboard, "writeText">): Promise<boolean> {
  try {
    await clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
}

/** Show the optional copy `button`, copying the visible `command` on a click and saying how it went in `status`. */
export function wireCopyControl(
  button: Pick<HTMLButtonElement, "hidden" | "textContent" | "dataset" | "setAttribute" | "removeAttribute" | "addEventListener">,
  command: Pick<HTMLElement, "textContent">,
  status: Pick<HTMLElement, "textContent">,
  clipboard: Pick<Clipboard, "writeText">,
): void {
  button.hidden = false;
  button.addEventListener("click", async () => {
    if (button.dataset.copyState === "pending") return;
    button.setAttribute("aria-disabled", "true");
    button.dataset.copyState = "pending";
    button.textContent = "Copying…";
    status.textContent = "Copying…";
    const copied = await copyCommand(command.textContent ?? "", clipboard);
    button.dataset.copyState = copied ? "copied" : "failed";
    button.textContent = copied ? "Copied" : "Copy command";
    status.textContent = copied ? "Copied. Paste into PowerShell." : "Could not copy. Select the command above and copy it manually.";
    button.removeAttribute("aria-disabled");
  });
}
