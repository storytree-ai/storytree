/**
 * Capability 4 · Experiment record and freeze (ADR-1064 D5). An experiment is written down before it runs as the
 * library's `experiment` record: its arms, hypotheses, measures, criteria, budget and stop rules. Freezing stamps the
 * time; from then on the library refuses every change but an outcome, and a run reads only a frozen record.
 */
import type { FieldsOf, Library, WriteOptions } from "@storytree/library";

/** An experiment as written down: the library's own fields for the kind. */
export type Experiment = FieldsOf<"experiment">;

/** Why an experiment cannot be frozen or run, naming it. */
export class ExperimentRefusal extends Error {}

/** The live experiment `id`, or a refusal naming it when it is none. */
async function experimentOf(library: Library, id: string): Promise<Experiment> {
  const record = await library.get(id);
  if (record === null || record.type !== "experiment") throw new ExperimentRefusal(`${id} is no live experiment in this library: write one with \`storytree library new experiment\``);
  return record.fields as Experiment;
}

/**
 * Freeze the experiment `id` at `now`: its pre-registration. A second freeze is refused, keeping the first time; the
 * library itself refuses it inside the write, so two freezes at once leave one stamp.
 */
export async function freeze(library: Library, id: string, writer: WriteOptions, now = new Date()): Promise<string> {
  const { frozen } = await experimentOf(library, id);
  if (frozen !== undefined) throw new ExperimentRefusal(`experiment ${id} is already frozen at ${frozen}`);
  const stamp = now.toISOString();
  await library.editNote(id, { frozen: stamp }, writer);
  return stamp;
}

/** The frozen experiment `id`, as a run reads it; an unfrozen one is refused, so nothing runs before it is written down. */
export async function frozenExperiment(library: Library, id: string): Promise<Experiment> {
  const experiment = await experimentOf(library, id);
  if (experiment.frozen === undefined) throw new ExperimentRefusal(`experiment ${id} is not frozen: freeze it with \`storytree experiment freeze ${id}\` before it runs`);
  return experiment;
}
