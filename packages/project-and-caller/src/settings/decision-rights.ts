// Capability 2 · Settings

export interface DecisionRights {
  decides: readonly string[];
  asks: readonly string[];
  delegations: string;
  override: string;
  honesty: readonly string[];
}

const DECISION_RIGHTS: DecisionRights = {
  decides: [
    "a reversible call with no trade-off (same outputs, no new dependency, no contract or user-facing change)",
    "a look you built, which lands with its pictures, not as a question",
  ],
  asks: [
    "a trade-off, such as choosing between designs before building",
    "anything outward-facing",
    "anything irreversible",
    "spending money",
    "dropping or reshaping the work asked for",
  ],
  delegations:
    "Before asking, check the owner's standing delegations: a kind they already handed you is yours.",
  override:
    "The user's own instructions file (AGENTS.md, CLAUDE.md) overrides this split either way.",
  honesty: [
    "never sign off your own output (another agent or CI does)",
    "never skip tests",
    "write the question down rather than only asking in chat",
  ],
};

export function decisionRights(): DecisionRights {
  return DECISION_RIGHTS;
}

export const decisionRightsGuidance: readonly string[] = [
  [
    "Who decides what.",
    `- Decide yourself, and record what you chose: ${DECISION_RIGHTS.decides.join("; ")}.`,
    `- Ask the owner before: ${DECISION_RIGHTS.asks.join("; ")}.`,
    `- ${DECISION_RIGHTS.delegations}`,
    `- ${DECISION_RIGHTS.override}`,
    `- No file moves these: ${DECISION_RIGHTS.honesty.join("; ")}.`,
  ].join("\n"),
];
