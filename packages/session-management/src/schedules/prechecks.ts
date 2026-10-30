/**
 * Capability 18 · Scheduled processes: the cheap checks a process's `precheck` names (the library's fixed list,
 * PRECHECKS), each read here before its runner starts a subagent. Each says whether there is work, and what it found;
 * one that wrongly found nothing would hide work, so `schedule ran` records a skip only on a fresh reading.
 */
import type { Library, Precheck } from "@storytree/library";

/** What a precheck found: work to do, or nothing, in a line that says why. */
export type PrecheckReading = { readonly work: boolean; readonly found: string };

const READS: Readonly<Record<Precheck, (library: Library) => Promise<PrecheckReading>>> = {
  async "feedback-waiting"(library) {
    const waiting = (await library.list("feedback")).filter((note) => note.fields.status === "new").length;
    return waiting === 0 ? { work: false, found: "no feedback note waits to be routed" } : { work: true, found: `${waiting} feedback note${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} to be routed` };
  },
};

/** Read the precheck named, against `library`. */
export function readPrecheck(precheck: Precheck, library: Library): Promise<PrecheckReading> {
  return READS[precheck](library);
}
