/**
 * Capability 3 · QA ledger. The ledger's rows of a project, as a project-records contribution (ADR-1170 D2): this
 * package's manifest names it under `projectRecords`, and a host that deletes a project hands App setup every one the
 * parts it mounts contribute, so App setup forgets them without importing this package, and with code review switched
 * off there is no ledger to forget. The shape is the hosts' declared interface, restated rather than imported (ADR-1017 D2).
 */
import type { Storytree } from "@storytree/library";

import { forgetProjectQuality } from "./ledger.js";

/** Records a part keeps for a project outside its library, which go when the project is deleted. */
export interface ProjectRecords {
  readonly name: string;
  forget(server: Storytree, project: string): Promise<void>;
}

export const projectRecords: readonly ProjectRecords[] = [{ name: "QA ledger", forget: forgetProjectQuality }];
