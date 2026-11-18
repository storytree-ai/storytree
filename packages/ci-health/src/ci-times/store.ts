// Capability 6 · CI times.
import type { Storytree } from "@storytree/library";

export const CI_TIMES_DATABASE = "storytree-ci-times";

export const CI_TIMES_SCHEMA: readonly string[] = [
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
  `CREATE TABLE IF NOT EXISTS ci_pulls (
    project     text NOT NULL,
    repository  text NOT NULL,
    pull        integer NOT NULL,
    ready_at    timestamptz NOT NULL,
    merged_at   timestamptz NOT NULL,
    PRIMARY KEY (project, pull)
  )`,
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
  `CREATE TABLE IF NOT EXISTS ci_readings (
    project     text PRIMARY KEY,
    repository  text NOT NULL,
    read_at     timestamptz NOT NULL
  )`,
  `ALTER TABLE ci_unit_times ADD COLUMN IF NOT EXISTS artifact text`,
  `CREATE TABLE IF NOT EXISTS ci_pull_scopes (
    project     text NOT NULL,
    pull        integer NOT NULL,
    head_sha    text NOT NULL,
    every       boolean NOT NULL,
    dirs        text[] NOT NULL,
    read_at     timestamptz NOT NULL,
    PRIMARY KEY (project, pull)
  )`,
];

export interface CiTimesDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export function ciTimesPool(server: Pick<Storytree, "ownDatabase">): Promise<CiTimesDb> {
  return server.ownDatabase(CI_TIMES_DATABASE, { tables: CI_TIMES_SCHEMA, declaredIn: [import.meta.url] });
}
