/**
 * Capability 2 · Storytree projects. Switch to the project chosen in the gear's Projects (app 2.1): the list is held while it switches;
 * once switched the overlay closes (`chosen`); a failed choice shows its reason inside Projects
 * (`failed`) and leaves the overlay open. Either way the list is free again, so a failure can be retried.
 */
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
