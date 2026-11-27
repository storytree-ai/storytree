// Capability 4 · Work model
import { isDeepStrictEqual } from "node:util";

import { referTo, SchemaError, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../storage/rules/index.js";
import { capabilityNumber, contractNumber, said } from "./numbers.js";
import { edgesFrom, readPlan, storyOfContract } from "./snapshot.js";

type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;

export interface PluginPlan {
  readonly story: {
    readonly title: string;
    readonly description?: string;
    readonly text?: string;
  };
  readonly capabilities: readonly PluginPlanCapability[];
}

export interface PluginPlanCapability {
  readonly title: string;
  readonly description?: string;
  readonly text?: string;
  readonly proposed?: boolean;
  readonly dependsOn?: string[];
  readonly contracts: readonly {
    readonly title: string;
    readonly description?: string;
    readonly proof?: Readonly<ContractProof>;
  }[];
}

export interface ImportedPluginPlan {
  readonly story: string;
  readonly added: string[];
  readonly edited: string[];
  readonly retired: string[];
  readonly kept: string[];
  readonly left: string[];
  readonly stood: string[];
}

export interface PluginPlanHeld {
  readonly capabilities: readonly number[];
  readonly contracts: readonly string[];
  readonly versions?: readonly unknown[];
}

export interface PluginImportOptions extends WriteOptions {
  readonly adopt?: string;
  readonly held?: PluginPlanHeld;
}

type Fields = Record<string, unknown>;

export async function importPluginPlan(records: SchemaRecords, plugin: string, plan: PluginPlan, options: PluginImportOptions = {}): Promise<ImportedPluginPlan> {
  checkNumbers(plan);
  const writing: WriteOptions = options.actor === undefined ? {} : { actor: options.actor };
  const live = await readPlan(records);
  const versions = options.held?.versions as readonly PluginPlan[] | undefined;
  const result = { added: [] as string[], edited: [] as string[], retired: [] as string[], kept: [] as string[], left: [] as string[], stood: [] as string[] };

  const sync = async <T extends "story" | "capability" | "contract">(record: SchemaRecord<T>, wanted: Fields, held: (field: string) => unknown[] | undefined): Promise<boolean> => {
    const changes: Fields = {};
    let stood = false;
    for (const [field, value] of Object.entries(wanted)) {
      const now = (record.fields as Fields)[field];
      if (isDeepStrictEqual(now, value)) continue;
      const values = held(field);
      if (values === undefined || values.some((one) => isDeepStrictEqual(one, now))) changes[field] = value;
      else stood = true;
    }
    if (stood) result.stood.push(record.id);
    if (Object.keys(changes).length === 0) return false;
    await records.edit(record.id, changes as never, writing);
    return true;
  };
  const inVersions = (pick: (version: PluginPlan) => Fields | undefined) => (field: string): unknown[] | undefined =>
    versions?.map((version) => pick(version)?.[field]);
  const capabilityIn = (version: PluginPlan, number: number) => version.capabilities.find((capability) => capabilityNumber(capability.title) === number);
  const contractIn = (version: PluginPlan, number: string) =>
    version.capabilities.flatMap((capability) => capability.contracts).find((contract) => numberOf(contract.title) === number);

  let story = [...live.stories.values()].find((candidate) => candidate.fields.plugin === plugin);
  if (story === undefined && options.adopt !== undefined) {
    const adopted = await referTo(records, "adopt", options.adopt, "story");
    if (adopted.fields.mapped !== undefined) refuse("story", "mapped", `${adopted.id} is imported from ${adopted.fields.mapped.from}: an imported story is its import's, never a plugin's`);
    if (adopted.fields.plugin !== undefined) refuse("story", "plugin", `${adopted.id} is ${adopted.fields.plugin}'s plan's, not ${plugin}'s`);
    story = adopted;
  }
  const storyFields = { title: plan.story.title, description: plan.story.description, text: plan.story.text, plugin };
  if (story === undefined) {
    story = await records.create("story", present(storyFields) as FieldsOf<"story">, writing);
    result.added.push(story.id);
  } else {
    result[(await sync(story, storyFields, inVersions((version) => ({ ...version.story, plugin })))) ? "edited" : "kept"].push(story.id);
  }
  const home = story.id;

  const liveCapabilities = [...live.capabilities.values()].filter((capability) => capability.fields.story === home);
  const liveContracts = live.contracts.filter((contract) => storyOfContract(live, contract.fields) === home);
  const matched = new Set<string>();

  for (const capability of plan.capabilities) {
    const number = capabilityNumber(capability.title)!;
    const wantedDepends = capability.dependsOn ?? [];
    const same = [...new Set(wantedDepends.filter((id) => live.capabilities.get(id)?.fields.story === home))];
    const others = wantedDepends.filter((id) => !same.includes(id));
    const existing = liveCapabilities.find((candidate) => capabilityNumber(candidate.fields.title) === number);
    let id: string;
    if (existing === undefined) {
      const created = await records.create("capability", present({
        title: capability.title,
        story: home,
        description: capability.description,
        text: capability.text,
        proposed: capability.proposed ?? true,
        dependsOn: others.length === 0 ? undefined : others,
      }) as FieldsOf<"capability">, writing);
      for (const to of same) await records.create("edge", { from: created.id, to }, writing);
      result.added.push(created.id);
      id = created.id;
    } else {
      id = existing.id;
      matched.add(id);
      const wanted = { title: capability.title, description: capability.description, text: capability.text, proposed: capability.proposed ?? existing.fields.proposed };
      let edited = await sync(existing, wanted, inVersions((version) => capabilityIn(version, number) as Fields | undefined));
      const edges = edgesFrom(live, id);
      const stored = existing.fields.dependsOn ?? [];
      if (!isDeepStrictEqual(new Set(edges.map((edge) => edge.fields.to)), new Set(same)) || !isDeepStrictEqual(stored, others)) {
        for (const edge of edges) if (!same.includes(edge.fields.to)) await records.retire(edge.id, `${plugin}'s plan no longer names this dependency`, writing);
        for (const to of same) if (!edges.some((edge) => edge.fields.to === to)) await records.create("edge", { from: id, to }, writing);
        if (!isDeepStrictEqual(stored, others)) await records.edit(id, { dependsOn: others.length === 0 ? undefined : others }, writing);
        edited = true;
      }
      result[edited ? "edited" : "kept"].push(id);
    }
    for (const contract of capability.contracts) {
      const key = numberOf(contract.title)!;
      const found = liveContracts.find((candidate) => numberOf(candidate.fields.title) === key);
      const wanted = { title: contract.title, capability: id, edge: undefined, description: contract.description, proof: contract.proof };
      if (found === undefined) {
        result.added.push((await records.create("contract", present(wanted) as FieldsOf<"contract">, writing)).id);
        continue;
      }
      matched.add(found.id);
      const edited = await sync(found, wanted, inVersions((version) => contractIn(version, key) as Fields | undefined));
      result[edited ? "edited" : "kept"].push(found.id);
    }
  }

  const held = options.held;
  const mayRetire = (number: string | number | undefined, title: string, titleIn: (version: PluginPlan) => string | undefined): boolean => {
    if (held === undefined) return true;
    const numbers: readonly (string | number)[] = typeof number === "number" ? held.capabilities : held.contracts;
    if (number === undefined || !numbers.includes(number)) return false;
    return versions === undefined || versions.some((version) => titleIn(version) === title);
  };
  const retire = async (id: string): Promise<void> => {
    await records.retire(id, `${plugin}'s plan no longer holds it`, writing);
    result.retired.push(id);
  };
  const gone = new Set<string>();
  for (const capability of liveCapabilities) {
    if (matched.has(capability.id)) continue;
    const number = capabilityNumber(capability.fields.title);
    if (!mayRetire(number, capability.fields.title, (version) => (number === undefined ? undefined : capabilityIn(version, number)?.title))) {
      result.left.push(capability.id);
      continue;
    }
    gone.add(capability.id);
    for (const contract of liveContracts) if (contract.fields.capability === capability.id && !matched.has(contract.id)) {
      matched.add(contract.id);
      await retire(contract.id);
    }
    for (const edge of live.edges) if (edge.fields.from === capability.id || edge.fields.to === capability.id) await records.retire(edge.id, `${capability.id} left ${plugin}'s plan`, writing);
    await retire(capability.id);
  }
  for (const contract of liveContracts) {
    if (matched.has(contract.id)) continue;
    const number = numberOf(contract.fields.title);
    if (mayRetire(number, contract.fields.title, (version) => (number === undefined ? undefined : contractIn(version, number)?.title))) await retire(contract.id);
    else result.left.push(contract.id);
  }
  return { story: home, ...result };
}

function checkNumbers(plan: PluginPlan): void {
  const capabilities = new Set<number>();
  const contracts = new Set<string>();
  for (const capability of plan.capabilities) {
    const number = capabilityNumber(capability.title);
    if (number === undefined) refuse("capability", "title", `${JSON.stringify(capability.title)} in the plugin's plan carries no number`);
    if (capabilities.has(number)) refuse("capability", "title", `the plugin's plan numbers two capabilities ${number}`);
    capabilities.add(number);
    for (const contract of capability.contracts) {
      const found = contractNumber(contract.title);
      if (found === undefined) refuse("contract", "title", `${JSON.stringify(contract.title)} in the plugin's plan carries no number`);
      if (found.capability !== number) refuse("contract", "title", `${JSON.stringify(contract.title)} is numbered under capability ${found.capability}, not ${number}`);
      if (contracts.has(said(found))) refuse("contract", "title", `the plugin's plan numbers two contracts ${said(found)}`);
      contracts.add(said(found));
    }
  }
}

function numberOf(title: string): string | undefined {
  const found = contractNumber(title);
  return found === undefined ? undefined : said(found);
}

function present(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function refuse(type: string, field: string, problem: string): never {
  throw new SchemaError(type, [{ field, problem: `${JSON.stringify(field)}: ${problem}` }]);
}

