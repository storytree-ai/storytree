/** The agent runner's declared interface (ADR-1216 D3), as its TypeScript dependents import it. */

/** The agent runner's part name, as the part switch names it. */
export declare const PART: "agent-pool";

/** The entries the agent runner declares as its interface. */
export declare const DECLARED: readonly string[];

/** The file that answers the agent runner's declared entry `from` on the computer whose storytree home is `home`. */
export declare function agentRunnerEntry(from: "./launch" | "./runner", home?: string): string;
