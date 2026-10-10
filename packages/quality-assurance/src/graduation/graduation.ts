/**
 * Capability 5 · Graduation (ADR-0956 D5): all of a quality control check, or the part of it that is a
 * fixed pattern, moves from the reviewer to a deterministic check in Guardrails, and the check's record
 * says which part graduated and which Guardrails check now enforces it.
 */
import { GRADUATED_CHECKS } from "@storytree/guardrails";
import type { Library } from "@storytree/library";

import type { Graduated } from "../checks/checks.js";

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
