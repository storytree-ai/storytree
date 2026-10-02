# Developer database lifecycle proof

Increment `increment_9f4da5f11e36`, allocation arc `arc_e9699edab22b`.
Connect an agent's existing contract 2.2 (`contract_fc67f82dc4b2`) covers the
developer home's connection to its own setup check. The former dev-home test
checked its database launch configuration but never executed that entry.

`src/connect/dev-database.test.ts` imports the actual developer database entry
in a separate Node process, using a fresh temporary home. After startup and
handler registration it checks the recorded owner PID and queries the real
Postgres server. SIGTERM and SIGINT must each exit successfully, remove the
ownership record and leave `pg_ctl status` reporting a stopped server. Failure
cleanup kills the child and independently stops any remaining test database.

The implementation already had this behavior. To establish test sensitivity,
the local mutation removed only `await server.stop()` from its stop handler.
Both cases went red on retained ownership ([red.log](red.log)); restoring the
unchanged implementation made both pass ([green.log](green.log)). The mutation
was discarded, never committed. No new product shutdown protocol was added.

On Unix the tests send native OS signals. On Windows a test-only bootstrap
delivers the signal event to the real handler because Node's programmatic kill
terminates unconditionally there. Windows therefore proves real database and
handler cleanup, **not native signal delivery or `removeDevHome()` cleanup**.
That separate concern is preserved as `increment_432c1045afd9` on the app-setup
arc, for native Windows reproduction and a product fix if needed.

`pnpm survey:coverage app-setup` ran all 17 numbered test files successfully
([coverage.log](coverage.log)) and regenerated the whole package map. Its
`src/connect/dev-database.ts` entry is measured child-process execution, not a
manual allocation. Production source is unchanged. Conduit's
`evidence/first-build/**` fence is untouched.

Live-plan `readCodeSurvey` on the same source baseline (`7e01a414`) measured
**5,229 / 66,550** unclaimed/total lines before, and **5,214 / 66,550** after
coverage regeneration. App setup moves from **15 unclaimed lines to zero**;
the rest of the allocation arc remains open. The snapshots are retained in
`/home/mickh/storytree-lanes/st03-allocation-appsetup-{before,after}.json`.
