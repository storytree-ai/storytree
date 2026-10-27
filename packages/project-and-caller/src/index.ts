// Capability 2 · Settings, beside Capability 1 · Project routing. @storytree/project-and-caller: which project a folder is,
// and what the user set on this computer (the Project and caller story, ADR-1025). It stands on the library alone;
// Session management, the hooks and every host stand on it (ADR-1021 D2).
export { approvedHere, findProject, inMainCheckout, locateApp, locateLibrary, locateStorytree, MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, openNamedProject, requireApproval, route, storytreeHome, withConnectTimeout } from "./routing/index.js";
export { approveTrunk, forgetTrunk, importsOf, machineOf, ProjectFolderError, recordImport, registerTrunk, rememberApproval, TRUNKS_DATABASE, trunkedProjects, trunksOn, trunksPool } from "./routing/index.js";
export type { ImportedFolder, LocateOptions, Machine, ProjectLookup, Route, StorytreeAddress, Trunk } from "./routing/index.js";
export { keepOnThisComputer, projectOnShow, readProjectChoice, recordProjectChoice, recordRemovedProjects, removedProjects, type HiddenProject } from "./routing/project-choice.js";
export { partsSaid, switchedSaid, switchPart, type PartsSwitched, type StandInsNamed } from "./settings/parts.js";
export { switchSystem, systemSaid } from "./settings/system.js";
export { servicesSaid, switchService } from "./settings/services.js";
export { idleAfterMs, leaveAfterMs, readExperiment, readLibrary, readPartsOff, readServicesOn, readSettings, SERVICE_NAME, factoryFolder, makeFactoryFolder, readStandIns, readSetupApproval, readSurfaceChoices, readSystemSwitches, setFactory, setSetupApproval, type SetupApproval, type ChosenFactory, type FactorySwitched, type FactorySwitcher, type StandInSwitchedBack, setLibrary, setPartOff, setServiceOn, setSetting, setSurfaceChoice, setSystemSwitch, type SystemSwitches } from "./settings/settings.js";
export type { ExperimentArm, LibraryLocation, LibraryReading, SettingGroup, SettingReading, SettingsReading, SurfaceChoices } from "./settings/settings.js";
export { decisionRights, decisionRightsGuidance } from "./settings/decision-rights.js";
export type { DecisionRights } from "./settings/decision-rights.js";
export { STANDING_DELEGATION, standingDelegations } from "./settings/delegations.js";
