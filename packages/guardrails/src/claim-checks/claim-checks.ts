/**
 * Capability 2 · The allocation rule, as a claim check (ADR-1170 D2): Guardrails contributes it through its manifest's
 * `claimChecks`, and the claim front doors run every check the parts they mount contribute, so none of them imports
 * Guardrails for it, and with Guardrails switched off the check is simply not run. A landing is held until each source
 * file of the capability's story package that no numbered test reaches is placed (ADR-0911 D4). The check's shape is
 * the hosts' declared interface, restated rather than imported (ADR-1017 D2).
 */
import { packagesOf } from "@storytree/map/code-survey";

import { allocationProblems } from "../allocation-rule/allocation-rule.js";
import { checkoutOf } from "../check/check.js";

/** The plan as the check reads it: each story's id and title, with its capabilities' ids. */
interface PlanReader {
  projectTree(): Promise<{ readonly stories: readonly { readonly id: string; readonly title: string; readonly capabilities: readonly { readonly id: string }[] }[] }>;
}

/** A check a claim front door runs as a claim on `capability` lands: the problems that hold it, none to let it land. */
export interface ClaimCheck {
  readonly name: string;
  landing(capability: string, place: { readonly library: PlanReader; readonly folder: string }): Promise<readonly string[]>;
}

export const claimChecks: readonly ClaimCheck[] = [
  {
    name: "allocation",
    // The capability's story package in the checkout the session works in; none for a capability the plan lacks.
    async landing(capability, { library, folder }) {
      const story = (await library.projectTree()).stories.find((one) => one.capabilities.some((part) => part.id === capability));
      return story === undefined ? [] : allocationProblems(checkoutOf(folder), packagesOf(story));
    },
  },
];
