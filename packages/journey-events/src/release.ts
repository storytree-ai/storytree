/**
 * Capability 2 · PostHog delivery. Build-time stamp for shipped builds (the desktop main process and the released commands). Only
 * PostHog's public project token may be stamped in; the private personal key stays in Secret
 * Manager for administrator deletions and refuses the build if it is ever supplied here.
 */
export function journeyDefine(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const key = env.STORYTREE_JOURNEY_KEY?.trim();
  if (!key) return {};
  if (!/^phc_[A-Za-z0-9_]+$/.test(key)) throw new Error("STORYTREE_JOURNEY_KEY must be PostHog's public project token (phc_…); no other key may ship.");
  return { STORYTREE_JOURNEY_KEY: JSON.stringify(key) };
}
