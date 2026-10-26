/**
 * Capability 17 · Aggregate journey reading. Anyone with the shipped public token can write events, so event text is outside
 * data: an administrative caller reads PostHog only through here, as counts of allow-listed milestones for install IDs
 * storytree recorded. The query-read key comes from POSTHOG_QUERY_APIKEY or the secret posthog_query_apikey, never printed.
 *
 *   tsx src/journey-events/aggregate.ts --project <id> [--days 7] <install-id>…
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { JOURNEY_EVENTS } from "./posthog.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error("Journey aggregates unavailable");

export interface JourneyAggregates {
  /** How many install IDs the caller named. */
  installs: number;
  /** How many of them have at least one allow-listed event in the window. */
  reporting: number;
  /** Count per allow-listed event name, summed over the named installs. */
  events: Record<string, number>;
}

export async function readJourneyAggregates(options: {
  projectId: string;
  queryKey: string;
  installIds: readonly string[];
  days?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<JourneyAggregates> {
  const days = options.days ?? 30;
  if (!/^[1-9][0-9]*$/.test(options.projectId) || !/^phx_[A-Za-z0-9_-]+$/.test(options.queryKey)
    || options.installIds.length === 0 || !options.installIds.every((id) => UUID.test(id))
    || !Number.isInteger(days) || days < 1 || days > 366) throw unavailable();
  const known = new Set(options.installIds.map((id) => id.toLowerCase()));
  const list = (values: Iterable<string>) => [...values].map((value) => `'${value}'`).join(", ");
  const query = `select distinct_id, event, count() from events where timestamp > now() - interval ${days} day`
    + ` and distinct_id in (${list(known)}) and event in (${list(JOURNEY_EVENTS)}) group by distinct_id, event`;
  const fetch = options.fetch ?? globalThis.fetch;
  let rows: unknown;
  try {
    const response = await fetch(`https://us.posthog.com/api/projects/${options.projectId}/query/`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${options.queryKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    if (!response.ok) throw unavailable();
    rows = ((await response.json()) as { results?: unknown }).results;
  } catch { throw unavailable(); }
  if (!Array.isArray(rows)) throw unavailable();
  // The query already filters; this re-checks every row, so nothing but a known ID, a named event and a count passes.
  const events: Record<string, number> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) continue;
    const [id, event, count] = row as unknown[];
    if (typeof id !== "string" || !known.has(id.toLowerCase()) || typeof event !== "string" || !JOURNEY_EVENTS.has(event)
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) continue;
    events[event] = (events[event] ?? 0) + count;
    seen.add(id.toLowerCase());
  }
  return { installs: known.size, reporting: seen.size, events };
}

const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };

/** The cloud project the secret is read in: STORYTREE_GCP_PROJECT, else the Google credentials' own, else none (gcloud's). */
export function secretProject(env: Record<string, string | undefined>, read: (file: string) => string | undefined = readText): string | undefined {
  const named = env.STORYTREE_GCP_PROJECT?.trim();
  if (named) return named;
  const file = env.GOOGLE_APPLICATION_CREDENTIALS || (env.HOME ? path.join(env.HOME, ".config/gcloud/application_default_credentials.json") : undefined);
  try {
    const project = file === undefined ? undefined : (JSON.parse(read(file) ?? "{}") as { project_id?: unknown }).project_id;
    return typeof project === "string" && project.trim() ? project.trim() : undefined;
  } catch { return undefined; }
}

/** POSTHOG_QUERY_APIKEY, else the secret posthog_query_apikey read through the box's Google credentials. */
export async function journeyQueryKey(env: Record<string, string | undefined> = process.env): Promise<string> {
  const fromEnv = env.POSTHOG_QUERY_APIKEY?.trim();
  if (fromEnv) return fromEnv;
  const project = secretProject(env);
  try {
    const { stdout } = await promisify(execFile)("gcloud", ["secrets", "versions", "access", "latest", "--secret=posthog_query_apikey", ...(project ? [`--project=${project}`] : [])], { timeout: 20_000 });
    return stdout.trim();
  } catch { throw new Error("No query-read key: set POSTHOG_QUERY_APIKEY or the secret posthog_query_apikey."); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const take = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args.splice(at, 2)[1]; };
  const projectId = take("--project") ?? process.env.POSTHOG_PROJECT_ID ?? "";
  const days = take("--days");
  try {
    const result = await readJourneyAggregates({ projectId, queryKey: await journeyQueryKey(), installIds: args, ...(days ? { days: Number(days) } : {}) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
