// Capability 3 · Reading the project's CI.
import { MissingReferenceError, type EarlierVerdict, type HealthSource, type Library, type SkipKind } from "@storytree/library";

import type { Verdict } from "../verdicts/verdicts.js";

export type Writer = { by: string; source: HealthSource; commit?: string; run?: string };

export type RecordedVerdict = {
  state: "passing" | "failing" | "not-checked";
  note?: string;
  reason?: string;
  skip?: SkipKind;
  crashed?: true;
  unrun?: true;
  tests?: readonly string[];
  flaky?: readonly string[];
};

export const CI_PLATFORMS: Readonly<Record<string, string>> = { win32: "Windows", darwin: "macOS" };

export function unseenPlatform(skip: string | undefined, platformsSeen: ReadonlySet<string> | undefined): boolean {
  const platform = /^platform:(.+)$/.exec(skip ?? "")?.[1];
  return platformsSeen !== undefined && platform !== undefined && Object.hasOwn(CI_PLATFORMS, platform) && !platformsSeen.has(platform);
}

function seenAt(writer: Writer): string {
  return `${writer.commit === undefined ? "" : ` at commit ${writer.commit}`}${writer.run === undefined ? "" : `${writer.commit === undefined ? "" : ","} run ${writer.run}`}`;
}

export async function recordHealth(
  library: Pick<Library, "recordVerified" | "recordVerifiedAll" | "health">,
  contractIds: ReadonlyMap<string, string>,
  verdicts: ReadonlyMap<string, RecordedVerdict>,
  writer: Writer,
  { platformsSeen }: { platformsSeen?: ReadonlySet<string> } = {},
): Promise<{ passing: number; failing: number; notChecked: number; marked: number; retired?: string[]; untold?: string[] }> {
  const written = { passing: 0, failing: 0, notChecked: 0, marked: 0 };
  const retired: string[] = [];
  const untold: string[] = [];
  const judged = [...verdicts].flatMap(([number, verdict]) => {
    if (verdict.state === "not-checked") return [];
    const id = contractIds.get(number);
    if (id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    const at = seenAt(writer);
    const note = at === "" ? verdict.note : `${verdict.note ?? ""},${at}`;
    return [{ number, id, state: verdict.state, note, options: { by: writer.by, source: writer.source, ...(note === undefined || note === "" ? {} : { note }), ...(verdict.tests === undefined ? {} : { tests: verdict.tests }), ...(verdict.flaky === undefined ? {} : { flaky: verdict.flaky }) } }];
  });
  let together: readonly unknown[] = [];
  try {
    if (judged.length > 0) together = await library.recordVerifiedAll(judged.map(({ id, state, options }) => ({ contractId: id, state, options })));
  } catch (error) {
    if (!(error instanceof MissingReferenceError)) throw error;
  }
  for (const [index, { number, id, state, note, options }] of judged.entries()) {
    if (together[index] !== undefined) {
      written[state]++;
      continue;
    }
    try {
      try {
        await library.recordVerified(id, state, options);
      } catch (error) {
        if (!(isPrivilegeRefusal(error) && (await kept(library, id, state, writer.by, note)))) throw error;
        untold.push(`${number} (${id})`);
      }
      written[state]++;
    } catch (error) {
      if (!(error instanceof MissingReferenceError && error.field === "node" && error.id === id && error.found === undefined)) throw error;
      retired.push(`${number} (${id})`);
    }
  }
  for (const [number, verdict] of verdicts) {
    if (verdict.state !== "not-checked") continue;
    const id = contractIds.get(number);
    try {
      if (id !== undefined && (await markNotChecked(library, id, verdict, writer, platformsSeen))) written.marked++;
      written.notChecked++;
    } catch (error) {
      if (!(error instanceof MissingReferenceError && error.field === "node" && error.id === id && error.found === undefined)) throw error;
      retired.push(`${number} (${id})`);
    }
  }
  return { ...written, ...(retired.length === 0 ? {} : { retired }), ...(untold.length === 0 ? {} : { untold }) };
}

function isPrivilegeRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42501";
}

async function kept(library: Pick<Library, "health">, id: string, state: string, by: string, note: string | undefined): Promise<boolean> {
  const { verified } = await library.health(id);
  return verified.state === state && verified.by === by && (verified.note ?? "") === (note ?? "");
}

async function markNotChecked(library: Pick<Library, "recordVerified" | "health">, id: string, verdict: RecordedVerdict, writer: Writer, platformsSeen: ReadonlySet<string> | undefined): Promise<boolean> {
  if (verdict.skip === undefined && verdict.crashed !== true) return false;
  const earlier = (await library.health(id)).verified;
  if ((verdict.unrun === true || unseenPlatform(verdict.skip, platformsSeen)) && earlier.state === "passing") return false;
  const was: EarlierVerdict | undefined = earlier.state === "not-checked" ? earlier.was : { state: earlier.state, at: earlier.at! };
  const same = earlier.state === "not-checked" && earlier.skip === verdict.skip && earlier.was?.state === was?.state && earlier.was?.at === was?.at;
  if (same) return false;
  const at = seenAt(writer);
  const reason = verdict.reason ?? verdict.note ?? "";
  const note = was === undefined ? `${reason}${at === "" ? "" : `,${at}`}` : `not re-run${at}: ${reason}`;
  await library.recordVerified(id, "not-checked", { by: writer.by, source: writer.source, note, ...(verdict.skip === undefined ? {} : { skip: verdict.skip }), ...(was === undefined ? {} : { was }) });
  return true;
}

export async function recordUnclaimed(library: Pick<Library, "recordUnclaimed">, tree: Awaited<ReturnType<Library["projectTree"]>>, reached: ReadonlyMap<string, Verdict>, writer: Writer): Promise<void> {
  const at = seenAt(writer);
  const options = { by: writer.by, source: writer.source };
  for (const capability of tree.stories.flatMap(({ capabilities }) => capabilities)) {
    const verdict = reached.get(capability.id);
    if (verdict !== undefined) await library.recordUnclaimed(capability.id, verdict.state, { ...options, note: `${verdict.note}${at === "" ? "" : `,${at}`}` });
    else if (capability.unclaimed !== undefined && capability.unclaimed.state !== "not-checked") await library.recordUnclaimed(capability.id, "not-checked", { ...options, note: `no test that no contract claims reached it${at === "" ? "" : `,${at}`}` });
  }
}
