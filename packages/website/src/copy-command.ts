/** Report success only once the browser has accepted the exact visible command. */
export async function copyCommand(command: string, clipboard: Pick<Clipboard, "writeText">): Promise<boolean> {
  try {
    await clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
}
