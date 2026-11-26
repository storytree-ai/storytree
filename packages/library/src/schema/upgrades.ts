// Capability 3 · Record rules
import type { LibrarySchema, UpgradeStep } from "../records/index.js";
import { judgedState, RECORD_SCHEMAS, SCHEMA_VERSIONS } from "./types.js";

export const UPGRADES: readonly UpgradeStep[] = [
  {
    type: "arc",
    from: 1,
    name: "arc-intent-and-end-state",
    reads: ["description", "title"],
    up: (fields) => ({
      ...fields,
      intent: typeof fields["description"] === "string" && fields["description"] !== "" ? fields["description"] : fields["title"],
      endState: "Not recorded: this arc was written before arcs carried an end state.",
    }),
  },
  {
    type: "decision",
    from: 1,
    name: "decision-status",
    reads: [],
    up: (fields) => ({ ...fields, status: "accepted" }),
  },
  {
    type: "capability",
    from: 1,
    name: "capability-proposed",
    reads: [],
    up: (fields) => ({ ...fields, proposed: true }),
  },
  {
    type: "increment",
    from: 1,
    name: "increment-ready-retired",
    reads: ["status"],
    up: (fields) => (fields["status"] === "ready" ? { ...fields, status: "proposal" } : fields),
  },
  {
    type: "increment",
    from: 2,
    name: "increment-capabilities-list",
    reads: ["touches", "links"],
    up: ({ touches, ...fields }) => {
      if (!Array.isArray(touches)) return fields;
      const named = touches.filter((id): id is string => typeof id === "string");
      const capabilities = named.filter((id) => id.startsWith("capability_"));
      const others = named.filter((id) => !id.startsWith("capability_"));
      const links = [...new Set([...(Array.isArray(fields["links"]) ? (fields["links"] as string[]) : []), ...others])];
      return { ...fields, ...(capabilities.length === 0 ? {} : { capabilities }), ...(links.length === 0 ? {} : { links }) };
    },
  },
  {
    type: "friction",
    from: 1,
    name: "friction-state",
    reads: ["route", "dischargedBy"],
    up: (fields) => ({
      ...fields,
      state: typeof fields["route"] === "string"
        ? judgedState(fields["route"], typeof fields["dischargedBy"] === "string" ? fields["dischargedBy"] : undefined)
        : "open",
    }),
  },
];

export const LIBRARY_SCHEMA: LibrarySchema = { versions: SCHEMA_VERSIONS, schemas: RECORD_SCHEMAS, upgrades: UPGRADES };
