# Spike: Postgres over WebSocket through a CONNECT proxy (ADR-1093 D4)

Run 2026-10-20 on the Mint box, against a throwaway Postgres 16.15 and never the real library.
Increment `increment_3df6ab8eea7d`. The findings and verdict are in the library: the research note
linked to ADR-1093. This file keeps the commands so leg 3 can be rerun from a cloud session.

Versions: `@neondatabase/serverless` 1.2.0, `ws` 8.22.0, `https-proxy-agent` 9.1.0, `pg` 8.23.1,
Node 24.19.0, neondatabase/wsproxy at commit 99ed92d (built with Go 1.23.4).

## The path, with stand-ins

```
spike.mjs ──HTTPS_PROXY CONNECT──▶ connect-proxy.mjs ──TLS──▶ access-gate.mjs ──▶ wsproxy ──▶ Postgres
(Neon Pool,      (stands in for the       (stands in for Access + cloudflared:  (127.0.0.1  (127.0.0.1
 AccessWebSocket)  agent proxy; allowlist)  checks CF-Access-* headers, logs them) :58080)     :55433)
```

## Set up

```sh
# Postgres 16, SCRAM on TCP, loopback only
initdb -D pgdata -U spike --auth-local=trust --auth-host=scram-sha-256 --pwfile=<(echo spikepw)
pg_ctl -D pgdata -o "-p 55433 -k $PWD -c listen_addresses=127.0.0.1" -l pg.log start
psql -h 127.0.0.1 -p 55433 -U spike -d postgres -c "create database spike" \
  -c "create role storytree_actor nologin" -c "grant storytree_actor to spike"
psql -h 127.0.0.1 -p 55433 -U spike -d spike -c "grant all on schema public to storytree_actor"

# wsproxy: both listeners on loopback, and only the one Postgres address allowed
git clone https://github.com/neondatabase/wsproxy && (cd wsproxy && go build -o ../wsproxy-bin .)
LISTEN_PORT=127.0.0.1:58080 PROMETHEUS_BIND=127.0.0.1:52112 \
  ALLOW_ADDR_REGEX='^127\.0\.0\.1:55433$' ./wsproxy-bin &

openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"
npm i @neondatabase/serverless ws https-proxy-agent pg
node access-gate.mjs & node connect-proxy.mjs &

HTTPS_PROXY=http://127.0.0.1:53128 NODE_EXTRA_CA_CERTS=$PWD/cert.pem \
  CF_ACCESS_CLIENT_ID=spike-id.access CF_ACCESS_CLIENT_SECRET=spike-secret node spike.mjs
```

## Leg 3, from a cloud session

Replace the two stand-ins with the real thing: expose `access-gate.mjs` (or, once the owner's side
is ready, the real Access application in front of cloudflared and wsproxy) at a public HTTPS
hostname on the environment's Allowed domains, set `GATE=<hostname>` (no scheme, no path), unset
`NODE_EXTRA_CA_CERTS` unless the agent proxy needs its own authority, and run `node spike.mjs` in
the cloud session with the environment's own `HTTPS_PROXY`. Pass: 19/19 ok, and the gate's log shows
the `cf-access-client-id` header.

## The client (the part `packages/library` would take)

```js
import { Pool, Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
const headers = { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
                  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET };
// The driver calls `new webSocketConstructor(url)` with the URL only, so a subclass adds the rest.
neonConfig.webSocketConstructor = class extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers, agent }); }
};
neonConfig.wsProxy = () => `${GATE}/v1?address=127.0.0.1:5432`; // wsproxy serves /v1, not /v2
neonConfig.pipelineConnect = false; // the default "password" sends the password unasked; SCRAM refuses it
// NeonPool overwrites `options.Client` with its own; subclass the pool to keep a custom client.
class LibraryPool extends Pool { constructor(o) { super(o); this.Client = LibraryClient; } }
```

## Scripts

### access-gate.mjs

```js
// Stands in for Cloudflare Access + cloudflared: TLS on the outside, checks the
// service-token headers, logs what arrived, then hands the upgrade to wsproxy on loopback.
import https from "node:https"; import net from "node:net"; import fs from "node:fs";
const ID = "spike-id.access", SECRET = "spike-secret";
const srv = https.createServer({ key: fs.readFileSync("key.pem"), cert: fs.readFileSync("cert.pem") },
  (req, res) => { res.writeHead(426); res.end("upgrade required\n"); });
srv.on("upgrade", (req, sock, head) => {
  const id = req.headers["cf-access-client-id"], secret = req.headers["cf-access-client-secret"];
  console.log(`[gate] ${req.method} ${req.url} cf-access-client-id=${id ?? "-"} cf-access-client-secret=${secret ? "<" + secret.length + " chars>" : "-"} upgrade=${req.headers.upgrade}`);
  if (id !== ID || secret !== SECRET) { sock.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n"); console.log("[gate] 403"); return; }
  const up = net.connect(58080, "127.0.0.1", () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head); up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
srv.listen(58443, "127.0.0.1", () => console.log("[gate] listening 127.0.0.1:58443"));
```

### connect-proxy.mjs

```js
// Stands in for the cloud session's agent proxy: HTTP CONNECT only, with an allowed-hosts list.
import http from "node:http"; import net from "node:net";
const ALLOWED = (process.env.ALLOWED ?? "localhost").split(",");
const srv = http.createServer((req, res) => { res.writeHead(405); res.end(); });
srv.on("connect", (req, sock, head) => {
  const [host, port] = req.url.split(":");
  const ok = ALLOWED.includes(host);
  console.log(`[proxy] CONNECT ${req.url} ${ok ? "allowed" : "DENIED"}`);
  if (!ok) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const up = net.connect(Number(port), host === "localhost" ? "127.0.0.1" : host, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) up.write(head); up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
srv.listen(53128, "127.0.0.1", () => console.log("[proxy] listening 127.0.0.1:53128"));
```

### spike.mjs

```js
// ADR-1093 D4 spike: does @neondatabase/serverless's Pool cover what packages/library does with pg,
// over a custom WebSocket that carries Access headers through an HTTPS_PROXY CONNECT agent?
import { Pool, Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import net from "node:net";

const PROXY = process.env.HTTPS_PROXY;
const HEADERS = { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "", "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "" };
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;

class AccessWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers: HEADERS, agent }); }
}
neonConfig.webSocketConstructor = AccessWebSocket;
neonConfig.wsProxy = () => `${process.env.GATE ?? "localhost:58443"}/v1?address=127.0.0.1:55433`;
neonConfig.pipelineConnect = false; // SCRAM, not cleartext: the default "password" pipelining assumes cleartext auth
const URL_ = "postgres://spike:spikepw@library.example/spike";

const results = [];
async function check(name, fn) {
  try { const r = await fn(); results.push([name, "ok", r]); console.log(`OK   ${name}: ${JSON.stringify(r)}`); }
  catch (e) { results.push([name, "FAIL", e.message]); console.log(`FAIL ${name}: ${e.code ?? ""} ${e.message}`); }
}
const code = async (p) => { try { await p; return "no error"; } catch (e) { return e.code ?? e.message; } };

const pool = new Pool({ connectionString: URL_, application_name: "storytree spike", idle_in_transaction_session_timeout: 10_000,
  statement_timeout: 1500, options: "-c role=storytree_actor", connectionTimeoutMillis: 3000, max: 3 });
pool.on("error", () => {}); pool.on("connect", (c) => c.on("error", () => {}));

await check("round trip", async () => (await pool.query("select version() v, current_user u, session_user s")).rows[0]);
await check("startup params (application_name, idle_in_tx, statement_timeout, options role)", async () => {
  const r = await pool.query("select current_setting('application_name') a, current_setting('idle_in_transaction_session_timeout') i, current_setting('statement_timeout') s, current_user u");
  return r.rows[0];
});
await check("statement_timeout fires (57014)", () => code(pool.query("select pg_sleep(3)")));
await check("params: $n, text[] ANY, bytea Buffer unnest, bigint, timestamptz, jsonb", async () => {
  await pool.query("create table if not exists t (id text primary key, v bytea, n bigint, at timestamptz default now(), j jsonb)");
  await pool.query("truncate t");
  await pool.query("insert into t (id, v, n) select * from unnest($1::text[], $2::bytea[], $3::bigint[])",
    [["a", "b"], [Buffer.from([1, 2, 3]), Buffer.from([255])], ["9007199254740993", "2"]]);
  await pool.query("update t set j = $1 where id = 'a'", [{ x: 1 }]);
  const r = await pool.query("select id, v, n, at, j from t where id = any($1::text[]) order by id", [["a", "b"]]);
  return r.rows.map((x) => ({ id: x.id, v: Buffer.isBuffer(x.v) ? [...x.v] : x.v, n: x.n, nType: typeof x.n, atIsDate: x.at instanceof Date, j: x.j }));
});
await check("transaction BEGIN/advisory xact lock/SET LOCAL/COMMIT + ROLLBACK", async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("select pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
    await c.query("SET LOCAL lock_timeout = 200"); await c.query("insert into t (id) values ('tx')"); await c.query("COMMIT");
    await c.query("BEGIN"); await c.query("insert into t (id) values ('rolled')"); await c.query("ROLLBACK");
    return (await c.query("select array_agg(id order by id) ids from t where id in ('tx','rolled')")).rows[0];
  } finally { c.release(); }
});
await check("lock contention: try lock false, then lock_timeout 55P03", async () => {
  const a = await pool.connect(), b = await pool.connect();
  try {
    await a.query("BEGIN"); await a.query("select pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
    await b.query("BEGIN");
    const tried = (await b.query("select pg_try_advisory_xact_lock(hashtext('storytree.record-writes')) got")).rows[0].got;
    await b.query("SET LOCAL lock_timeout = 200");
    const c = await code(b.query("select pg_advisory_xact_lock(hashtext('storytree.record-writes'))"));
    await b.query("ROLLBACK"); await a.query("COMMIT");
    return { tried, lockTimeoutCode: c };
  } finally { a.release(); b.release(); }
});
await check("SET ROLE / RESET ROLE", async () => {
  const c = await pool.connect();
  try { await c.query('SET ROLE "spike"'); const u1 = (await c.query("select current_user u")).rows[0].u; await c.query("RESET ROLE");
    return { afterSet: u1, afterReset: (await c.query("select current_user u")).rows[0].u }; } finally { c.release(); }
});
await check("error codes 23505 / 42P01 / 42P04", async () => ({
  dup: await code(pool.query("insert into t (id) values ('a')")),
  noTable: await code(pool.query("select * from nope")),
  dupDb: await code(pool.query("create database spike")),
}));
await check("idle_in_transaction_session_timeout is set per session (25P03 path not waited)", async () => (await pool.query("show idle_in_transaction_session_timeout")).rows[0]);
await check("release(true) destroys the client", async () => {
  const c = await pool.connect(); const pid = (await c.query("select pg_backend_pid() p")).rows[0].p; c.release(true);
  await new Promise((r) => setTimeout(r, 300));
  const alive = (await pool.query("select count(*)::int n from pg_stat_activity where pid = $1", [pid])).rows[0].n;
  return { pid, stillAlive: alive };
});
await check("terminated backend surfaces 57P01 and pool recovers", async () => {
  const c = await pool.connect(); const pid = (await c.query("select pg_backend_pid() p")).rows[0].p;
  const errP = new Promise((r) => c.once("error", (e) => r(e.code ?? e.message)));
  const other = new Pool({ connectionString: URL_, max: 1 }); await other.query("select pg_terminate_backend($1)", [pid]); await other.end();
  const viaQuery = await code(c.query("select 1")); const viaEvent = await Promise.race([errP, new Promise((r) => setTimeout(() => r("no event"), 1000))]);
  c.release(true); return { viaQuery, viaEvent, after: (await pool.query("select 1 one")).rows[0].one };
});
await check("concurrency: 12 queries through max 3", async () => {
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => pool.query("select $1::int i, pg_backend_pid() p", [i])));
  return { rows: rs.length, distinctBackends: new Set(rs.map((r) => r.rows[0].p)).size, total: pool.totalCount };
});
await check("multi-statement simple query", async () => {
  const r = await pool.query("select 1 a; select 2 b"); return Array.isArray(r) ? r.map((x) => x.rows[0]) : r.rows;
});
await check("custom Client subclass via Pool's Client option (LocalClient/RemoteClient shape)", async () => {
  const seen = [];
  class Spy extends Client {
    _handleAuthSASLFinal(msg) { seen.push("SASLFinal"); return super._handleAuthSASLFinal(msg); }
    _handleReadyForQuery(msg) { seen.push("ReadyForQuery"); return super._handleReadyForQuery(msg); }
    _handleAuthCleartextPassword(msg) { seen.push("Cleartext"); return super._handleAuthCleartextPassword(msg); }
  }
  const p = new Pool({ connectionString: URL_, Client: Spy, max: 1 });
  const r = (await p.query("select 1 one")).rows[0]; await p.end();
  const viaOption = [...new Set(seen)]; seen.length = 0;
  class SpyPool extends Pool { constructor(o) { super(o); this.Client = Spy; } }
  const p2 = new SpyPool({ connectionString: URL_, max: 1 });
  await p2.query("select 1 one"); await p2.end();
  return { r, viaOption, viaSubclassedPool: [...new Set(seen)], protoHas: ["_handleAuthSASLFinal", "_handleReadyForQuery", "_handleAuthCleartextPassword", "_handleAuthMD5Password"].filter((m) => typeof Client.prototype[m] === "function") };
});
await check("pg ssl option is ignored over the socket (forceDisablePgSSL)", async () => {
  const p = new Pool({ connectionString: URL_, ssl: { rejectUnauthorized: true, ca: "not a cert" }, max: 1 });
  const r = (await p.query("select 1 one")).rows[0]; await p.end(); return r;
});
await check("wrong password 28P01", async () => { const p = new Pool({ connectionString: URL_.replace("spikepw", "wrong"), max: 1 }); const c = await code(p.query("select 1")); await p.end(); return c; });
await check("missing database 3D000", async () => { const p = new Pool({ connectionString: URL_.replace(/\/spike$/, "/nodb"), max: 1 }); const c = await code(p.query("select 1")); await p.end(); return c; });
await check("connectionTimeoutMillis against a gate that never answers", async () => {
  const hang = net.createServer(() => {}).listen(58444, "127.0.0.1");
  const saved = neonConfig.wsProxy; neonConfig.wsProxy = () => "localhost:58444/v1?address=127.0.0.1:55433";
  const p = new Pool({ connectionString: URL_, connectionTimeoutMillis: 1000, max: 1 }); p.on("error", () => {});
  const t0 = Date.now(); const c = await code(p.query("select 1")); const ms = Date.now() - t0;
  neonConfig.wsProxy = saved; await p.end().catch(() => {}); hang.close(); return { error: c, ms };
});
await pool.end();
await check("pool.end() then query refuses", () => code(pool.query("select 1")));
console.log(`\n${results.filter((r) => r[1] === "ok").length}/${results.length} ok`);
process.exit(0);
```

### extra.mjs

```js
// Two edge checks: the driver's default pipelined connect against SCRAM, and wsproxy's address allowlist.
import { Pool, neonConfig } from "@neondatabase/serverless"; import WebSocket from "ws"; import { HttpsProxyAgent } from "https-proxy-agent";
const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
neonConfig.webSocketConstructor = class extends WebSocket { constructor(u, p) { super(u, p, { agent, headers: { "CF-Access-Client-Id": "spike-id.access", "CF-Access-Client-Secret": "spike-secret" } }); } };
const URL_ = "postgres://spike:spikepw@library.example/spike";
async function t(name, addr, pipeline) {
  neonConfig.wsProxy = () => `localhost:58443/v1?address=${addr}`; neonConfig.pipelineConnect = pipeline;
  const p = new Pool({ connectionString: URL_, max: 1, connectionTimeoutMillis: 3000 }); p.on("error", () => {});
  try { const r = await p.query("select 1 one"); console.log(name, "->", r.rows[0]); } catch (e) { console.log(name, "->", e.code ?? "", e.message); }
  await p.end().catch(() => {});
}
await t("default pipelineConnect='password' with SCRAM", "127.0.0.1:55433", "password");
await t("address outside ALLOW_ADDR_REGEX (127.0.0.1:22)", "127.0.0.1:22", false);
```
