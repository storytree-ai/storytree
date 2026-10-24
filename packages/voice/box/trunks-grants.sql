-- What the voice door's role, storytree_voice, may do inside the trunks' database, storytree-trunks:
-- read which folders are approved checkouts, so the door's copy is found approved (contract 4.3).
-- The copy's approval itself is written by the box's own account (confine.sh), never by the role.
-- Safe to run again.
--
-- RUN IT connected to storytree-trunks as an account that may act as the role owning it (on the
-- box: the local superuser; confine.sh runs it).
-- The approval is trunk-approval.sql.

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF current_database() <> 'storytree-trunks' THEN
    RAISE EXCEPTION 'connected to %, not storytree-trunks: connect to the trunks'' database and run this again', current_database();
  END IF;
  BEGIN
    EXECUTE format('SET ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns storytree-trunks: sign in as an account that may and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree-trunks" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT ON storytree_setup, trunks, imports TO storytree_voice;
-- Machines' short names (ADR-0982) sit here too, once a machine has been named.
DO $$
BEGIN
  IF to_regclass('public.machines') IS NOT NULL THEN
    GRANT SELECT ON machines TO storytree_voice;
  END IF;
END
$$;

RESET ROLE;
