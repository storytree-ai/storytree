-- What CI's health identity may do inside the library (ADR-0744 D4). Run once, after
-- `terraform apply`, as an account that may grant the role below: the instance's `postgres` user
-- (Cloud SQL Studio, in the Cloud Console) or whoever created that role. Safe to run again.
--
-- WHY A ROLE, NOT TABLE GRANTS. Recording health writes two tables of the project's database,
-- storytree_storytree (`record`, a contract's health entry; `record_event`, its history). But
-- storytree opens a project the same way for everyone: every open applies the project's schema
-- (CREATE TABLE / CREATE INDEX IF NOT EXISTS, packages/library/src/project/storytree.ts), which
-- Postgres allows only to the tables' owner, even when they already exist. Measured on a local
-- Postgres, 2026-09-29: a user holding SELECT/INSERT/UPDATE on those tables is refused at open
-- ("permission denied for schema public"; with CREATE on the schema, "must be owner of table
-- record"). So the account is let act as the role that owns the database, exactly as the laptop's
-- and the Mint box's accounts do (contract 8.3), and storytree's open takes that role on by itself.
--
-- WHAT THAT COSTS. The owning role is found below, not assumed; it is most likely
-- `storytree_creator`, through which projects are created on the instance, and which then owns every
-- project's database and may create databases: acting as it, the account could change any
-- project, not only write health. What bounds it: only this repository's workflows on main can
-- sign in as it (main.tf), and main changes only through a pull request that CI merged. Narrowing it to
-- the two tables needs storytree to open a project without applying its schema, a library change.
--
-- INHERIT FALSE: the account holds nothing of the role until it takes it on; SET TRUE: it may.

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = 'storytree_storytree';
  IF owner IS NULL THEN
    RAISE EXCEPTION 'there is no database storytree_storytree on this instance: is this the library''s instance?';
  END IF;
  EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET TRUE', owner, 'storytree-ci-health@storytree-498613.iam');
  RAISE NOTICE 'storytree-ci-health@storytree-498613.iam may now act as %', owner;
END
$$;

-- Check: one row, may_act = true.
SELECT pg_get_userbyid(datdba) AS owning_role,
       pg_has_role('storytree-ci-health@storytree-498613.iam', datdba, 'SET') AS may_act
  FROM pg_database WHERE datname = 'storytree_storytree';
