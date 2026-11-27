// Capability 4 · Work model
export const CONTRACT_DEFINITION = "A contract is one behaviour seen from outside the code: what goes in (its inputs), what comes out (its outputs) and its errors. A guarantee that joins two such behaviours is two contracts, and one about how the code works inside is not a contract yet.";

export const CONTRACT_PLACEMENT = "A contract goes on the part whose behaviour it pins, and a guarantee about what passes between two parts goes on their edge, even when every test drives the whole service through one entry point: plan from where you found each fault, not from the list of tests, so each part or link at fault gets a contract of its own.";

export const LONG_CONTRACT_TITLE = 300;

export const planGuidance: readonly string[] = [
  "Plan before you build: a story for what the user will be able to do, a capability for each part of it, and a contract for each behaviour a test can check.",
  CONTRACT_DEFINITION,
  CONTRACT_PLACEMENT,
];
