// Compatibility for existing app mounts; The map owns the code survey (ADR-0864).
export * from "@storytree/map/code-survey";

// Mutation proof: withhold surveyed package edges.
export async function readCodeSurvey(..._args: unknown[]) { return {}; }
