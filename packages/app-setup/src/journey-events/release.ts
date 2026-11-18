// Capability 14 · PostHog delivery.
export function journeyDefine(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const key = env.STORYTREE_JOURNEY_KEY?.trim();
  if (!key) return {};
  if (!/^phc_[A-Za-z0-9_]+$/.test(key)) throw new Error("STORYTREE_JOURNEY_KEY must be PostHog's public project token (phc_…); no other key may ship.");
  return { STORYTREE_JOURNEY_KEY: JSON.stringify(key) };
}
