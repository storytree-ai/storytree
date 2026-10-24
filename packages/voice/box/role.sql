-- The voice door's database role, storytree_voice, and the door's own database, storytree-voice.
-- RUN IT with psql as the box's superuser, connected to postgres, with the psql variable password
-- set to the role's password (confine.sh does both, generating the password once, keeping it only in
-- the door's storytree home, and setting it on standard input). Safe to run again: a rerun sets the same password and settings.
--
-- The role signs in with that password over 127.0.0.1 only (confine.sh's pg_hba lines): the storytree
-- command line reaches a library by a postgres:// address naming a host, so it cannot use the local
-- socket's peer sign-in. It owns nothing, may not create databases or roles, bypasses no row policy,
-- and inherits no other role's rights; what it may read is the grant files' alone.

SELECT 'CREATE ROLE storytree_voice'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storytree_voice') \gexec
ALTER ROLE storytree_voice LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 24 PASSWORD :'password';
-- Limits only a superuser may set: a runaway sort spills at most this much to disk, every statement
-- the door's children run is logged, and none runs longer than the door would wait for it.
ALTER ROLE storytree_voice SET temp_file_limit = '512MB';
ALTER ROLE storytree_voice SET log_statement = 'all';
ALTER ROLE storytree_voice SET statement_timeout = '60s';

-- The door's own database, owned like the library's databases by storytree_library: empty but for its
-- lock until writes exist (door-database.sql).
SELECT 'CREATE DATABASE "storytree-voice" OWNER storytree_library'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'storytree-voice') \gexec
