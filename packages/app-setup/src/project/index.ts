/** Adding a project (ADR-0752): not built yet. */
export type ProjectFolder = { folder: string; project: string } | { folder: string; suggestion: string };
export function projectFolder(_folder: string): ProjectFolder { throw new Error("not built"); }
export async function addProject(_folder: string, _name: string, _options: { home?: string; open?: unknown } = {}): Promise<{ status: string }> { throw new Error("not built"); }
