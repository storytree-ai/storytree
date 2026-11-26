// Capability 5 · Health record
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../storage/rules/index.js";
import type { WorkInFlight } from "../work/arcs/index.js";
import type { Turn } from "./reading.js";
import type { FlakeSeen, HealthEntry } from "./types.js";

export type Flight = Pick<WorkInFlight, "releaseOnVerdict" | "holds" | "createArc" | "addIncrement" | "editIncrement">;

export interface Done {
  readonly released: string[];
  readonly investigated: string[];
  readonly told: boolean;
}

export interface Telling {
  readonly asOf?: number;
  readonly told: boolean;
  readonly investigate: boolean;
}

export class Teller {
  readonly #records: SchemaRecords;
  readonly #flight: Flight | undefined;

  constructor(records: SchemaRecords, flight: Flight | undefined) {
    this.#records = records;
    this.#flight = flight;
  }

  async act(contract: SchemaRecord<"contract">, entry: HealthEntry, turn: Turn | undefined, telling: Telling, options: WriteOptions): Promise<Done> {
    if (turn === undefined) return { released: [], investigated: [], told: false };
    const write = writer(options);
    const failing = entry.state === "failing";
    const released = failing && this.#flight !== undefined
      ? await this.#flight.releaseOnVerdict(contract.id, contract.fields.capability, verdictSaid(contract, entry), write, telling.asOf)
      : [];
    const investigated: string[] = [];
    if (failing && telling.investigate) {
      const story = await this.#storyOf(contract);
      for (const test of entry.flaky ?? []) {
        const id = await this.investigateFlake(flakeOf(contract, entry, test, story), write);
        if (id !== undefined && !investigated.includes(id)) investigated.push(id);
      }
    }
    const told = !telling.told && (turn !== "still" || released.length > 0);
    if (told) await this.#tell(contract, entry, turn, released, investigated, write);
    return { released, investigated, told };
  }

  async investigateFlake(flake: FlakeSeen, write: WriteOptions = {}): Promise<string | undefined> {
    const flight = this.#flight;
    if (flight === undefined) return undefined;
    const title = `Investigate the flaky test ${flake.test}`;
    const same = (await this.#records.list("increment", { where: { title } })).filter(({ fields }) => fields.title === title);
    const at = flake.at ?? new Date().toISOString();
    for (const done of same.filter(({ fields }) => fields.status === "closed" && fields.outcome?.disposition === "landed")) {
      if (Date.parse(at) < Date.parse(await this.#closedAt(done))) return undefined;
    }
    const line = `- ${flake.evidence} (${flake.seen}, by ${flake.by})`;
    const open = same.find(({ fields }) => fields.status !== "closed");
    if (open !== undefined) {
      if (!open.fields.body.split("\n").includes(line)) await flight.editIncrement(open.id, { body: `${open.fields.body}\n${line}` }, write);
      return open.id;
    }
    const arc = await this.#arcOf(flight, flake, write);
    const parked = await flight.addIncrement({
      arc: arc.id,
      title,
      objective: `Find why ${flake.test} fails at random and fix the test, or raise a question for the owner when the fix is his to choose`,
      body: `${flake.found}. Parked by ${flake.by}.\n\nEvidence:\n${line}`,
      ...(flake.contract === undefined ? {} : { links: [flake.contract] }),
    }, write);
    return parked.id;
  }

  async #tell(contract: SchemaRecord<"contract">, entry: HealthEntry, turn: Turn, released: readonly string[], investigated: readonly string[], write: WriteOptions): Promise<void> {
    const title = contract.fields.title;
    const by = entry.by === undefined ? "" : ` by ${entry.by}`;
    const note = entry.note === undefined ? "" : `: ${entry.note}`;
    const doing = turn === "green" ? "" : ` ${await this.#doing(contract, released, investigated)}`;
    const what = turn === "green"
      ? `${title} is passing again${by}${note}.`
      : turn === "red"
        ? `${title} turned failing${by}${note}.${doing}`
        : `${title} is still failing${by}${note}, after the work that waited on it.${doing}`;
    await this.#records.create("fyi", { title: headingOf(turn, title), what, at: entry.at, about: contract.id, by: entry.by ?? write.actor ?? "storytree" }, write);
  }

  async #doing(contract: SchemaRecord<"contract">, released: readonly string[], investigated: readonly string[]): Promise<string> {
    const about = (await this.#records.list("increment")).filter(({ id, fields }) =>
      fields.status !== "closed" && ((fields.links ?? []).includes(contract.id) || (contract.fields.capability !== undefined && (fields.capabilities ?? []).includes(contract.fields.capability)) || investigated.includes(id)));
    if (about.length === 0) return "Nothing is being done yet: nothing routed works on it.";
    return `Being done: ${about.map(({ id, fields }) => `${id} "${fields.title}"${released.includes(id) ? ", released from its wait" : ""}`).join("; ")}.`;
  }

  async #closedAt(increment: SchemaRecord<"increment">): Promise<string> {
    const entries = await this.#records.history({ id: increment.id });
    return entries.find(({ record }) => record.fields["status"] === "closed")?.at ?? increment.updatedAt;
  }

  async #arcOf(flight: Flight, flake: FlakeSeen, write: WriteOptions): Promise<SchemaRecord<"arc">> {
    const title = `Flaky test: ${flake.test}`;
    const found = (await this.#records.list("arc", { where: { title } })).find(({ fields }) => fields.title === title);
    if (found !== undefined) return found;
    const story = flake.story ?? (flake.contract === undefined ? undefined : await this.#storyOf(await this.#records.get(flake.contract)));
    return await flight.createArc({
      title,
      intent: `Find out why the test ${flake.test} fails at random, and make it steady`,
      endState: `${flake.test} passes on every run, or the owner has decided what to do about it`,
      ...(story === undefined ? {} : { stories: [story] }),
    }, write);
  }

  async #storyOf(contract: SchemaRecord | null): Promise<string | undefined> {
    if (contract?.type !== "contract" || contract.fields.capability === undefined) return undefined;
    const capability = await this.#records.get(contract.fields.capability);
    return capability?.type === "capability" ? capability.fields.story : undefined;
  }
}

export function headingOf(turn: Turn, title: string): string {
  return `${turn === "green" ? "Green again" : turn === "red" ? "Red" : "Still red after a fix"}: ${title}`;
}

function verdictSaid(contract: SchemaRecord<"contract">, entry: HealthEntry): string {
  return `VERDICT: ${contract.fields.title} verified ${entry.state}${entry.by === undefined ? "" : ` by ${entry.by}`}${entry.note === undefined ? "" : `: ${entry.note}`}.`;
}

function flakeOf(contract: SchemaRecord<"contract">, entry: HealthEntry, test: string, story: string | undefined): FlakeSeen {
  const commit = /at commit ([0-9a-f]{7,40})/.exec(entry.note ?? "")?.[1];
  return {
    test,
    ...(story === undefined ? {} : { story }),
    contract: contract.id,
    seen: commit === undefined ? entry.at : `commit ${commit}`,
    evidence: entry.note ?? `${contract.fields.title} failed`,
    found: `Own health saw ${test} fail ${contract.fields.title}`,
    by: entry.by ?? "storytree",
    at: entry.at,
  };
}

function writer(options: WriteOptions): WriteOptions {
  return options.actor === undefined ? {} : { actor: options.actor };
}
