const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error("Journey event deletion unavailable");

/** Administrator-only. A successful response acknowledges a request, not completed erasure. */
export async function deleteJourneyEvents(options: {
  projectId: string;
  personalKey: string;
  distinctId: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ status: "requested" | "not-found" }> {
  if (!/^[1-9][0-9]*$/.test(options.projectId) || !/^phx_[A-Za-z0-9_-]+$/.test(options.personalKey)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(options.distinctId)) throw unavailable();
  const fetch = options.fetch ?? globalThis.fetch;
  const base = `https://us.posthog.com/api/projects/${options.projectId}/persons/`;
  const headers = { Authorization: `Bearer ${options.personalKey}`, "Content-Type": "application/json" };
  try {
    const lookup = await fetch(`${base}?distinct_id=${encodeURIComponent(options.distinctId)}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!lookup.ok) throw unavailable();
    const data: unknown = await lookup.json();
    if (!isObject(data) || !Array.isArray(data.results) || data.next != null) throw unavailable();
    if (data.results.length === 0) return { status: "not-found" };
    if (data.results.length !== 1) throw unavailable();
    const person: unknown = data.results[0];
    if (!isObject(person) || typeof person.uuid !== "string" || !UUID.test(person.uuid)
      || !Array.isArray(person.distinct_ids) || !person.distinct_ids.includes(options.distinctId)) throw unavailable();
    // PostHog's documented bulk endpoint accepts the person's UUID (not its numeric database id).
    const deletion = await fetch(`${base}bulk_delete/`, {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ ids: [person.uuid], delete_events: true }),
    });
    if (deletion.status !== 202) throw unavailable();
    const receipt: unknown = await deletion.json();
    if (!isObject(receipt) || receipt.persons_found !== 1 || receipt.events_queued_for_deletion !== true
      || receipt.persons_queued_for_deletion !== 1 || !Array.isArray(receipt.deletion_errors)
      || receipt.deletion_errors.length !== 0) throw unavailable();
    return { status: "requested" };
  } catch { throw unavailable(); }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
