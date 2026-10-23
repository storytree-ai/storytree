/** The voice door (story_28e1eb40e8c1, ADR-1132): claude.ai's voice mode reaching storytree read-only, through bounded children. */
export { ConfigError, loadConfig, voiceSession, type VoiceConfig } from "./config.js";
export { LIMITS, type Limits } from "./children.js";
export { startDoor, type Door, type DoorOptions } from "./door.js";
