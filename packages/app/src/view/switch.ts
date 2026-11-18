// Capability 2 · Storytree projects
export async function switchProject(name: string, steps: {
  choose(name: string): Promise<void>;
  chosen(): void | Promise<void>;
  failed(message: string, error: unknown): void;
  busy(on: boolean): void;
}): Promise<void> {
  steps.busy(true);
  try {
    await steps.choose(name);
    await steps.chosen();
  } catch (error) {
    steps.failed(`Couldn’t switch project: ${error instanceof Error ? error.message : String(error)}`, error);
  } finally {
    steps.busy(false);
  }
}
