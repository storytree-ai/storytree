// Capability 4 · Work model
export const CONTRACT_DEFINITION = "A contract is one behaviour seen from outside the code: what goes in (its inputs), what comes out (its outputs) and its errors. A guarantee that joins two such behaviours is two contracts, and one about how the code works inside is not a contract yet.";

export const CONTRACT_PLACEMENT = "A contract goes on the part whose behaviour it pins, and a guarantee about what passes between two parts goes on their edge, even when every test drives the whole service through one entry point: plan from where you found each fault, not from the list of tests, so each part or link at fault gets a contract of its own.";

export const LONG_CONTRACT_TITLE = 300;

export const planGuidance: readonly string[] = [
  "When the user asks you to build or change something, plan it in storytree before you build it, even when they never mention storytree and the work is small: a story for what they will be able to do (`plan_story`), a capability for each part of it (`plan_capability`), a contract for each behaviour a test can check (`plan_contract`), and an edge where one capability of a story depends on another (`plan_edge`). `show_plan` reads the plan back with each part's health, `focus` narrows it to the files you will change, `edit_plan` corrects a record and `retire_from_plan` retires one with its reason.",
  CONTRACT_DEFINITION,
  CONTRACT_PLACEMENT,
  "Work goes in arcs of increments: `plan_arc` starts an arc for a goal and `park_arc` parks one for later. Park the change's increment with `park_increment` and `claim` it before you build, never afterwards to record work already done. A small fix, one that adds or changes no contract, is one increment with a one-line objective on this project's standing small-fixes arc \"small-fixes\": it plans no new story, capability or contract, and anything bigger goes on an arc of its own. `move_increment` moves an increment to another arc, `set_wait` says what it waits on and `clear_wait` clears that, and `add_remedies` names the friction it fixes. `health_worklist` gives the capabilities that are not healthy, oldest first, with each one's reason and who moves it.",
  "A choice only the user can make is a question on its arc: `raise_question` writes it, `present_question` marks it as being put to them, `correct_question` corrects its wording, `settle_question` records their answer in their words, `move_question` moves it to another arc and `retire_question` retires one that was wrong to ask.",
];
