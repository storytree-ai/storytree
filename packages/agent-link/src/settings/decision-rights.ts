/** Capability 10 · Settings: who decides what, as the MCP server's habits card states it and the app's panel shows it (10.14). */

/**
 * Who decides what (ADR-0842 D1, D2): the kinds of decision a user's agent makes and records, the
 * kinds it asks the owner about, and the honesty promises no instructions file moves. The card is
 * built from these lines, and anything that shows the split reads them here, so the two never drift.
 */
export interface DecisionRights {
  /** Kinds the agent decides itself, and records. */
  decides: readonly string[];
  /** Kinds it asks the owner about before acting. */
  asks: readonly string[];
  /** That it checks the owner's standing delegations before asking. */
  delegations: string;
  /** That the user's own instructions file overrides the split, either way. */
  override: string;
  /** Promises no file moves. */
  honesty: readonly string[];
}

const DECISION_RIGHTS: DecisionRights = {
  decides: [
    "reversible engineering choices",
    "a look you built, which lands with its pictures rather than as a question",
  ],
  asks: [
    "choosing between designs before building",
    "anything outward-facing",
    "anything irreversible",
    "spending money",
    "dropping or reshaping the work asked for",
  ],
  delegations:
    "Before asking, check the owner's standing delegations (what they have already said you may decide): a kind they handed you is yours.",
  override:
    "The user's own instructions file (AGENTS.md, CLAUDE.md) overrides this split for any kind of decision, either way.",
  honesty: [
    "never sign off your own output (a separate agent, a judge panel or CI does)",
    "never skip tests",
    "write the question down rather than only asking in chat",
  ],
};

/** The split between what the agent decides and what it asks the owner, as the card states it. */
export function decisionRights(): DecisionRights {
  return DECISION_RIGHTS;
}
