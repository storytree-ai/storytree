/**
 * Capability 6 · CI times. Where a project's CI times are kept: a database of their own on the library's server
 * (`storytree-ci-times`, ADR-0735 D3), beside the projects, keyed by project. Runs and test times are measurements, about
 * 150 runs a day, so they are kept as rows here rather than as records in the library. Every write is an upsert, so any
 * machine may record at any time without counting anything twice.
 */
import type { Storytree } from "@storytree/library";

/** The database the CI times are kept in. */
export const CI_TIMES_DATABASE = "storytree-ci-times";

/** Its tables, in order, each idempotent; only ever appended to. */
export const CI_TIMES_SCHEMA: readonly string[] = [
  // One row per pull-request or merge-queue run, its latest attempt: queued (created), started and ended, its outcome, and the
  // system of its longest job (`bound`, once read; "unknown" when no job said). `timed`: its timing artifacts were read.
  `CREATE TABLE IF NOT EXISTS ci_runs (
    project     text NOT NULL,
    repository  text NOT NULL,
    run_id      bigint NOT NULL,
    attempt     integer NOT NULL,
    workflow    text NOT NULL,
    event       text NOT NULL,
    pull        integer,
    head_sha    text NOT NULL,
    created_at  timestamptz NOT NULL,
    started_at  timestamptz,
    ended_at    timestamptz,
    status      text NOT NULL,
    conclusion  text,
    bound       text,
    timed       boolean NOT NULL DEFAULT false,
    PRIMARY KEY (project, run_id)
  )`,
  // One row per merged pull request: when it was last made ready for review (else opened), and when it merged.
  `CREATE TABLE IF NOT EXISTS ci_pulls (
    project     text NOT NULL,
    repository  text NOT NULL,
    pull        integer NOT NULL,
    ready_at    timestamptz NOT NULL,
    merged_at   timestamptz NOT NULL,
    PRIMARY KEY (project, pull)
  )`,
  // One row per test unit per system of a passing merge-queue run, from that run's timing artifacts.
  `CREATE TABLE IF NOT EXISTS ci_unit_times (
    project     text NOT NULL,
    run_id      bigint NOT NULL,
    head_sha    text NOT NULL,
    platform    text NOT NULL,
    arch        text NOT NULL,
    unit        text NOT NULL,
    jobs        integer NOT NULL,
    result      text NOT NULL,
    ms          integer NOT NULL,
    timed_out   boolean NOT NULL,
    at          timestamptz NOT NULL,
    PRIMARY KEY (project, run_id, platform, arch, unit)
  )`,
  // When each project's CI times were last recorded, and from which repository.
  `CREATE TABLE IF NOT EXISTS ci_readings (
    project     text PRIMARY KEY,
    repository  text NOT NULL,
    read_at     timestamptz NOT NULL
  )`,
];

/** What the CI times are read and written through: the database's pool. */
export interface CiTimesDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** The CI times' database on `server`, its tables set up; a shared library takes them only once this file is merged (1.29). */
export function ciTimesPool(server: Pick<Storytree, "ownDatabase">): Promise<CiTimesDb> {
  return server.ownDatabase(CI_TIMES_DATABASE, { tables: CI_TIMES_SCHEMA, declaredIn: [import.meta.url] });
}
