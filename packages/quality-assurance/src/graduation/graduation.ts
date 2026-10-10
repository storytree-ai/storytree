/**
 * Capability 5 · Graduation (ADR-0956 D5): all of a quality control check, or the part of it that is a
 * fixed pattern, moves from the reviewer to a deterministic check in Guardrails, and the check's record
 * says which part graduated and which Guardrails check now enforces it. What those Guardrails checks find
 * on a change is recorded with the review of it, under the check each graduated from.
 */
import { GRADUATED_CHECKS, graduatedChecks } from "@storytree/guardrails";
import type { Library } from "@storytree/library";

import { checks, type Graduated } from "../checks/checks.js";

/**
 * Write on check `id`'s record that `graduated.part` is now enforced by Guardrails' `graduated.enforcedBy`,
 * beside any part graduated before. A Guardrails check that does not exist, or an id that is not a live
 * check, is refused and nothing is written.
 */
export async function graduate(library: Library, id: string, graduated: Graduated): Promise<void> {
  if (!(GRADUATED_CHECKS as readonly string[]).includes(graduated.enforcedBy)) {
    throw new Error(`Guardrails has no graduated check "${graduated.enforcedBy}"; it has ${GRADUATED_CHECKS.join(", ")}.`);
  }
  if (graduated.part.trim() === "") throw new Error("Name the part of the check that graduated.");
  const check = await library.get(id);
  if (check === null || check.type !== "check") throw new Error(`${id} is not a live quality control check.`);
  const earlier = (check.fields as { graduated?: Graduated[] }).graduated ?? [];
  await library.editNote(id, { graduated: [...earlier, { part: graduated.part, enforcedBy: graduated.enforcedBy }] });
}

/** What Guardrails' graduated checks found on a change, under the check each graduated from; not run says why, and is never a pass. */
export type GraduatedFindings =
  | { readonly ran: true; readonly checks: readonly { readonly check: string; readonly hits: readonly { readonly file: string; readonly line: number; readonly found: string }[] }[] }
  | { readonly ran: false; readonly reason: string };

/**
 * Run Guardrails' graduated checks on the change in `checkout` (its branch against origin/main) and put each trip
 * under the live checks of `library` that graduated to the Guardrails check that tripped (contract 5.3): each such
 * check ran, with a hit for each trip, saying which part it enforces. A trip of a Guardrails check no live check
 * graduated to is not any check's, so it is not kept.
 */
export async function graduatedFindings(library: Library, checkout: string): Promise<GraduatedFindings> {
  const report = graduatedChecks(checkout);
  if (!report.ran) return report;
  const found: { check: string; hits: { file: string; line: number; found: string }[] }[] = [];
  for (const check of await checks(library)) {
    if (check.graduated === undefined) continue;
    const hits = check.graduated.flatMap(({ part, enforcedBy }) => report.trips
      .filter((trip) => trip.check === enforcedBy)
      .map(({ file, line }) => ({ file, line, found: `Guardrails' ${enforcedBy}: ${part}` })));
    found.push({ check: check.id, hits });
  }
  return { ran: true, checks: found };
}
