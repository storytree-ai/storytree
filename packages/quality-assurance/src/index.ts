// Capability 1 · Quality control checks. @storytree/quality-assurance: the quality assurance story (ADR-0956). It
// reaches the library only through the library's public API.
export { checks, checksText } from "./checks/checks.js";
export type { Check, Enforced } from "./checks/checks.js";
export { qualityTools } from "./checks/tools.js";
