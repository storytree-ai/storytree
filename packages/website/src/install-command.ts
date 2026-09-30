/** The README owns the command. Refuse an unclear source rather than publish a guess. */
export function installCommand(readme: string): string {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  const starts = lines.flatMap((line, index) => /^##\s+Install\s*$/i.test(line) ? [index] : []);
  const fail = () => new Error("Cannot find one unambiguous, single-line install command in the README Install PowerShell block.");
  if (starts.length !== 1) throw fail();
  const start = starts[0]! + 1;
  const end = lines.findIndex((line, index) => index >= start && /^#{1,2}\s/.test(line));
  const section = lines.slice(start, end < 0 ? undefined : end).join("\n");
  const blocks = [...section.matchAll(/^```powershell[ \t]*\n([\s\S]*?)^```[ \t]*$/gmi)];
  const command = blocks[0]?.[1]?.trim();
  if (blocks.length !== 1 || !command || command.includes("\n")) throw fail();
  return command;
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
