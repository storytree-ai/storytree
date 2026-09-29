// The app setup (story_b91056a06337): the desktop carries OS actions; this package owns help.
export { setupHelpActions } from "./help/actions.js";
export type { SetupHelpBridge } from "./help/bridge.js";
export { openFeedbackDraft, feedbackText } from "./help/feedback.js";
export type { FeedbackDraft, DraftResult } from "./help/feedback.js";
export { readShippedLicense } from "./help/license.js";
export * from "./deliver/index.js";
export * from "./connect/index.js";
export * from "./project/index.js";
