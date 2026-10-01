# Library by Postgres address: the settings panel (10.13, ADR-0846 D1)

The Library tab offers a third location beside "On this computer" and "Google Cloud SQL":
**Postgres address**. Choosing it shows one field, the address (postgres://user@host:port/database,
with ?sslmode=… where the server needs it), and a line saying the password is not given here but
saved once as the key `postgres` (`storytree auth set postgres`). It saves through the same writer
as the command line, so an address carrying a password is refused with the writer's own reason.

- [Saved: an address without a password, set by you](address-saved.png)
- [Refused: an address carrying a password](address-refused.png)

Captured by `capture.mjs` through the real panel code (`mountSettings`, bundled for the browser)
and the real settings writers on a throwaway storytree home, in headless Chromium:

```sh
node --import tsx packages/agent-link/evidence/library-address/capture.mjs
```
