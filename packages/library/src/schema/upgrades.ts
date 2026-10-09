/**
 * Capability 3 · Data schema. The library's upgrade steps, and the schema it runs on.
 *
 * Every user has their own local library, so a record written by an older storytree stays in a
 * database nobody else can reach. When a type changes so that such a record no longer fits, its
 * version goes up (SCHEMA_VERSIONS) and a step goes here that brings the record's fields from the
 * old version to the new one. Reads apply the steps in order, and the next write of the record
 * stores it upgraded, in place. A step is never removed: the history keeps records on every
 * version ever written.
 */
import { RECORD_SCHEMAS, SCHEMA_VERSIONS, type LibrarySchema, type UpgradeStep } from "./types.js";

export const UPGRADES: readonly UpgradeStep[] = [
  {
    // Capability 10 (ADR-0640 D1): an arc is whole, with a required intent and end state. An arc
    // written before had a title and perhaps a description, which said what it was for.
    type: "arc",
    from: 1,
    name: "arc-intent-and-end-state",
    up: (fields) => ({
      ...fields,
      intent: typeof fields["description"] === "string" && fields["description"] !== "" ? fields["description"] : fields["title"],
      endState: "Not recorded: this arc was written before arcs carried an end state.",
    }),
  },
  {
    // Capability 13 (ADR-0640 D1): a decision carries a required status. One written before was
    // recorded as decided, so it reads accepted.
    type: "decision",
    from: 1,
    name: "decision-status",
    up: (fields) => ({ ...fields, status: "accepted" }),
  },
  {
    // Capability 4 (ADR-0744 D2): a capability carries a proposed flag, on until the agent says it
    // is built. One written before had no flag, and nobody had said so, so it reads proposed.
    type: "capability",
    from: 1,
    name: "capability-proposed",
    up: (fields) => ({ ...fields, proposed: true }),
  },
  {
    // Capability 10 (ADR-0909 D4): an increment's ready step is retired. One stored as ready was a
    // proposal somebody had marked able to start, which gated nothing, so it reads as a proposal and
    // keeps the date it was parked.
    type: "increment",
    from: 1,
    name: "increment-ready-retired",
    up: (fields) => (fields["status"] === "ready" ? { ...fields, status: "proposal" } : fields),
  },
  {
    // Capability 10 (ADR-0949 D2): an increment's `touches`, stories and capabilities alike, is
    // retired for a capabilities-only list. Its capabilities move to that list, in order, and
    // everything else it named (its stories) to its links, kept after any links it had. An id's
    // type is its prefix, as every stored id carries one.
    type: "increment",
    from: 2,
    name: "increment-capabilities-list",
    up: ({ touches, ...fields }) => {
      if (!Array.isArray(touches)) return fields;
      const named = touches.filter((id): id is string => typeof id === "string");
      const capabilities = named.filter((id) => id.startsWith("capability_"));
      const others = named.filter((id) => !id.startsWith("capability_"));
      const links = [...new Set([...(Array.isArray(fields["links"]) ? (fields["links"] as string[]) : []), ...others])];
      return { ...fields, ...(capabilities.length === 0 ? {} : { capabilities }), ...(links.length === 0 ? {} : { links }) };
    },
  },
];

/** The schema the library runs on. */
export const LIBRARY_SCHEMA: LibrarySchema = { versions: SCHEMA_VERSIONS, schemas: RECORD_SCHEMAS, upgrades: UPGRADES };
