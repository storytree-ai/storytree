/**
 * Capability 14 · Reading the doors' use. Which step of the work each surface serves (ADR-0983 D2's door share per step): orient, search,
 * claim, write, land or close, as the hand door reading (increment_474e084c620d) put them, so the two
 * readings compare like for like (ADR-0983 D6). A surface no rule names is on "other", and the table
 * lists it there, so a new command or tool shows up rather than vanishing.
 */

/** The steps, in the order a reading lists them. */
export const STEPS = ["orient", "search", "claim", "write", "land", "close", "other"] as const;
export type Step = (typeof STEPS)[number];

const TOOLS: Readonly<Record<Exclude<Step, "other">, string>> = {
  orient: "check_setup show_plan open read_context focus list_all_runs stale_claims",
  search: "search_notes",
  claim: "claim make_workspace release attach_workspace",
  write: "plan_story plan_capability plan_contract plan_arc park_increment park park_arc edit_plan write_note correct correct_note "
    + "correct_question record_friction record_resteer raise_question set_wait clear_wait annotate link reinforce retire "
    + "retire_from_plan retire_question supersede settle_question graduate add_remedies name_session mark_built move_increment "
    + "move_question ready_increment report",
  land: "land worklist friction_drain health_worklist route",
  close: "close_increment close_out list_own_runs stop_own_run clear_own_runs",
};
const TOOL_STEP = new Map(Object.entries(TOOLS).flatMap(([step, tools]) => tools.split(" ").map((tool) => [tool, step as Step] as const)));

/** Command prefixes after `storytree `, the first that matches winning. */
const COMMANDS: readonly (readonly [Step, string])[] = [
  ["search", "library search"], ["search", "library phrase"],
  ["claim", "workspace"], ["claim", "noticeboard claim"],
  ["close", "arc increment close"], ["close", "session close-out"], ["close", "processes"],
  ["land", "friction drain"], ["land", "friction route"], ["land", "health worklist"],
  ["write", "library new"], ["write", "library edit"], ["write", "library retire"], ["write", "library link"],
  ["write", "arc increment"],
  ["write", "arc new"], ["write", "arc edit"], ["write", "arc park"], ["write", "arc wait"], ["write", "arc unwait"],
  ["write", "question new"], ["write", "question settle"], ["write", "question retire"], ["write", "question renew"],
  ["write", "friction new"], ["write", "friction reinforce"], ["write", "resteer"], ["write", "adr new"],
  ["write", "adr push"], ["write", "session name"], ["write", "capability"], ["write", "health ci"],
  ["orient", "library"], ["orient", "arc"], ["orient", "adr"], ["orient", "question"], ["orient", "map"],
  ["orient", "tree"], ["orient", "noticeboard"], ["orient", "session"], ["orient", "affected"],
  ["orient", "settings"], ["orient", "context"], ["orient", "health"], ["orient", "friction"],
];

/** The step a surface serves, by its door and the verb as that door names it. */
export function stepOf(door: "command" | "tool", verb: string): Step {
  if (door === "tool") return TOOL_STEP.get(verb) ?? "other";
  const words = verb.replace(/^storytree\s*/, "");
  return COMMANDS.find(([, prefix]) => words === prefix || words.startsWith(`${prefix} `))?.[0] ?? "other";
}
