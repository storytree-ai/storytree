// Capability 3 · Hooks

const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/;

export function patchEdits(patch: string): { path: string; text?: string }[] {
  const edits: { path: string; text?: string }[] = [];
  let adding: { path: string; text: string } | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("***")) adding = undefined;
    else if (adding !== undefined && line.startsWith("+")) adding.text += `${line.slice(1)}\n`;
    const file = PATCH_FILE.exec(line)?.[1]?.trimEnd();
    if (file === undefined || edits.some((edit) => edit.path === file)) continue;
    if (line.startsWith("*** Add File:")) edits.push((adding = { path: file, text: "" }));
    else edits.push({ path: file });
  }
  return edits;
}

export function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const file = PATCH_FILE.exec(line)?.[1]?.trimEnd();
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}
