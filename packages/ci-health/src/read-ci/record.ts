/**
 * Capability 3 · Reading the project's CI. How each contract's verdict is written to its VERIFIED column, whoever ran the
 * tests: a project's CI read from its logs (read-ci) or a run of the tests read from their junit report (Mick's dev
 * loop's recording of a test run, packages/dev-loop/src/test-run, storytree's own health among them, ADR-1066 D2 G),
 * which reaches it through this package's interface: base never depends on that plugin (ADR-1170 D2). The reported column is never touched: that is what an agent says.
 *
 * Not checked is written only when a contract's tests were skipped or crashed (ADR-0825 D2): with the kind of its skip,
 * and any earlier passing or failing it did not reproduce, carried as "not re-run" (history keeps the old verdict).
 * With no tests there is nothing to re-run, and a verdict from elsewhere stands.
 */
import { MissingReferenceError, type EarlierVerdict, type HealthSource, type Library, type SkipKind } from "@storytree/library";

/**
 * Who writes a verdict, and where it was seen: by a run on this computer (`local`) or read from CI (`ci`), written on
 * every entry so the map can say which (ADR-1193 D3), and the commit it ran on and the CI run that ran it, when known.
 */
export type Writer = { by: string; source: HealthSource; commit?: string; run?: string };

/** A contract's verdict as recording needs it: passing and failing carry their tally as `note`, not checked its `reason`. */
export type RecordedVerdict = {
  state: "passing" | "failing" | "not-checked";
  note?: string;
  reason?: string;
  skip?: SkipKind;
  /** Its tests' file produced no results: its process died before running any. */
  crashed?: true;
  /** Its skipped tests were never reached by the run of the platform they need (its scope left their package out). */
  unrun?: true;
};

/** The CI systems whose evidence credits a `platform:<os>` skip, by Node's platform name. */
export const CI_PLATFORMS: Readonly<Record<string, string>> = { win32: "Windows", darwin: "macOS" };

/** Whether `skip` is a CI platform's whose evidence this run did not see, so it could not re-run that platform's tests. */
export function unseenPlatform(skip: string | undefined, platformsSeen: ReadonlySet<string> | undefined): boolean {
  const platform = /^platform:(.+)$/.exec(skip ?? "")?.[1];
  return platformsSeen !== undefined && platform !== undefined && Object.hasOwn(CI_PLATFORMS, platform) && !platformsSeen.has(platform);
}

/** Where `writer` saw it, for a note: ` at commit <commit>, run <run>`, or as much of it as it knows. */
function seenAt(writer: Writer): string {
  return `${writer.commit === undefined ? "" : ` at commit ${writer.commit}`}${writer.run === undefined ? "" : `${writer.commit === undefined ? "" : ","} run ${writer.run}`}`;
}

/**
 * Write each verdict to its contract's VERIFIED column, by `writer`, with its tally and where it was seen as the note.
 * A not-checked verdict is written only when its tests were skipped or crashed; one whose column already says the same
 * is not written again, so its note keeps the commit it was first not re-run at. A run that saw no CI evidence for a
 * platform (one missing from `platformsSeen`) cannot re-run a test that only runs there, so a passing verdict from
 * elsewhere stands against its `platform:<os>` skip; so does one whose skipped tests that platform's run never reached.
 * A contract retired since the run read it is skipped, not written, and named in `retired` as `<number> (<id>)`.
 * @param contractIds contract number -> id
 * @param options the platforms whose CI evidence the run read; all, when absent
 */
export async function recordHealth(
  library: Pick<Library, "recordVerified" | "health">,
  contractIds: ReadonlyMap<string, string>,
  verdicts: ReadonlyMap<string, RecordedVerdict>,
  writer: Writer,
  { platformsSeen }: { platformsSeen?: ReadonlySet<string> } = {},
): Promise<{ passing: number; failing: number; notChecked: number; marked: number; retired?: string[] }> {
  const written = { passing: 0, failing: 0, notChecked: 0, marked: 0 };
  const retired: string[] = [];
  for (const [number, verdict] of verdicts) {
    const id = contractIds.get(number);
    if (verdict.state !== "not-checked" && id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    try {
      if (verdict.state === "not-checked") {
        if (id !== undefined && (await markNotChecked(library, id, verdict, writer, platformsSeen))) written.marked++;
        written.notChecked++;
        continue;
      }
      const at = seenAt(writer);
      const note = at === "" ? verdict.note : `${verdict.note ?? ""},${at}`;
      await library.recordVerified(id!, verdict.state, { by: writer.by, source: writer.source, ...(note === undefined || note === "" ? {} : { note }) });
      written[verdict.state]++;
    } catch (error) {
      // Retired on the library after the run read its plan (runs 40092872110, 40103014567): one contract gone sinks no run.
      if (!(error instanceof MissingReferenceError && error.field === "node" && error.id === id && error.found === undefined)) throw error;
      retired.push(`${number} (${id})`);
    }
  }
  return retired.length === 0 ? written : { ...written, retired };
}

/**
 * Mark contract `id` not checked when its tests were skipped or crashed: with its skip's kind, and the earlier verdict
 * it did not reproduce (carried over from a mark already standing). True if it wrote.
 */
async function markNotChecked(library: Pick<Library, "recordVerified" | "health">, id: string, verdict: RecordedVerdict, writer: Writer, platformsSeen: ReadonlySet<string> | undefined): Promise<boolean> {
  // Only a run that had tests for it, skipped or crashed, failed to reproduce a verdict: with none,
  // a verdict from elsewhere (an acceptance run, ADR-0825 D5) stands.
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
