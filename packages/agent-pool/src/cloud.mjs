// Capability 3 · The pool's dispatcher overflows into Claude Code cloud sessions while the box is saturated (ADR-1264), a
// trial behind the machine file's `cloud` switch (pool-config.mjs), off by default. While ADR-1139 D2's saturation hold keeps
// ready work waiting, it fires the cloud task's API trigger for an eligible increment, up to the switch's cap; the cloud lane
// claims, builds and hands over through the library like any lane (4.30), and the dispatcher never claims for it. The fire's
// token is CLOUD_TRIGGER_TOKEN in ~/.storytree/secrets.json (the trigger may be CLOUD_TRIGGER_ID there instead of in the switch).
// Every fired lane is kept in the lanes folder's pool-cloud.json, so the trial's counts outlast the dispatcher.
import { readFile, writeFile } from "node:fs/promises";

import { blind, HANDED, pickPool, readOnly } from "./feed.mjs";

/** The cloud task's fire endpoint (platform.claude.com/docs/en/api/claude-code/routines-fire). */
export const fireUrl = (trigger) => `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(trigger)}/fire`;
/** A fired lane that has claimed its increment by now never will: it failed. */
export const CLAIM_GRACE_MS = 30 * 60_000;
/** After a fire error with no Retry-After, nothing is fired for this long: 100 fires an hour per account, and no retry storm. */
export const FIRE_BACKOFF_MS = 30 * 60_000;

/** Wording that names a need only the box, the laptop, a GPU or a desktop has, or the dispatcher's and watcher's own live behaviour. */
const BOX_ONLY = /\binfra\/|\bsystemd\b|\bssh mint\b|\bmint box\b|\bthe box\b|\bwatcher\b|\bdispatcher\b|\blag runs?\b|\bgpu\b|\bdesktop app\b|\bapps\/desktop\b|\blaptop\b|\bwindows\b|\bmacos\b|\bfactory\b/i;
/** Wording that names an edit to agent roles or the notes they stand on: a cloud container cannot run the guidance build (friction_8a0e4e03fbd3). */
const ROLES = /\bagent roles?\b|\.claude\/agents\b|\bguidance\b|\bhabits card\b/i;

/**
 * Why `one` (a pick, or a planning lane) may not go to a cloud session, else undefined: planning, another project's work, a
 * machine named, read-only or blind work (the cloud task briefs builds only), or wording that names a box-only need or an
 * edit to agent roles. Its body is read here because a wrong yes sends box work away, and a wrong no only keeps it home.
 */
export function whyNotCloud(one) {
  if (one.plan) return "a planning lane";
  if (one.project && one.project !== "storytree") return `${one.project}'s work: the cloud task is storytree's`;
  if (one.machine) return `it needs ${one.machine}`;
  if (readOnly(one.body ?? "") || blind(one.body ?? "")) return "read-only or blind work: the cloud task briefs builds only";
  const text = `${one.title ?? ""}\n${one.body ?? ""}`;
  const box = text.match(BOX_ONLY);
  if (box) return `box-only: it names ${box[0]}`;
  const role = text.match(ROLES);
  if (role) return `it may edit agent roles: it names ${role[0]}`;
  return undefined;
}

/** Fire the cloud task once for `text` (the increment's id): its session and its link, or an error carrying the status and Retry-After seconds. */
export async function fireCloud({ trigger, token, text, fetch = globalThis.fetch }) {
  const response = await fetch(fireUrl(trigger), {
    method: "POST", body: JSON.stringify({ text }), signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers?.get?.("retry-after"));
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) });
  }
  const body = await response.json();
  if (!body?.claude_code_session_id) throw new Error("the fire answered with no session");
  return { session: body.claude_code_session_id, url: body.claude_code_session_url };
}

/**
 * Each fired lane judged against a fresh survey. A lane is `live` from its fire until its increment's claim (one made after
 * the fire) is released, its holder reads idle, or CLAIM_GRACE_MS pass with no claim, each of which fails it; `handed` once
 * its pull request is with the watcher; and `landed` or `failed` once its increment closes, by how it closed.
 */
export function judgeLanes(lanes, found, now) {
  const byId = new Map(found.increments.map((one) => [one.id, one]));
  return lanes.map((lane) => {
    if (lane.state === "landed" || lane.state === "failed") return lane;
    const one = byId.get(lane.increment);
    if (!one) return { ...lane, state: "failed", why: "its increment is no longer in the survey" };
    if (one.status === "closed") return one.disposition === "landed" ? { ...lane, state: "landed" } : { ...lane, state: "failed", why: `its increment closed ${one.disposition ?? "with no outcome"}` };
    if (lane.state === "handed") return lane;
    if ((found.holds.waitsFor?.[one.id] ?? []).some((hold) => hold.holds && HANDED.test(hold.note))) return { ...lane, state: "handed" };
    const claim = found.claims.find((held) => held.increment === one.id && Date.parse(held.since) >= Date.parse(lane.at));
    if (claim?.holder === "live") return lane.claimed ? lane : { ...lane, claimed: claim.session };
    if (claim) return { ...lane, state: "failed", why: `its holder ${claim.session} reads idle` };
    if (lane.claimed) return { ...lane, state: "failed", why: "its claim was released with no hand-over" };
    if (now - Date.parse(lane.at) > CLAIM_GRACE_MS) return { ...lane, state: "failed", why: `no claim within ${CLAIM_GRACE_MS / 60_000} minutes of its fire` };
    return lane;
  });
}

/** The trial's readout: lanes fired, and how many landed, failed, are live or are with the watcher, and the fires that failed. */
export function cloudCounts({ lanes = [], fireErrors = 0 }) {
  const count = (state) => lanes.filter((lane) => lane.state === state).length;
  return `cloud lanes: ${lanes.length} fired, ${count("landed")} landed, ${count("failed")} failed, ${count("live")} live, ${count("handed")} with the watcher; ${fireErrors} fire error${fireErrors === 1 ? "" : "s"}`;
}

/** The token (and the trigger, when the switch names none) from ~/.storytree/secrets.json's CLOUD_TRIGGER_TOKEN and CLOUD_TRIGGER_ID; none when it is unreadable. */
export async function cloudSecrets(file, read = (path) => readFile(path, "utf8")) {
  try {
    const secrets = JSON.parse(await read(file));
    return { token: secrets.CLOUD_TRIGGER_TOKEN || undefined, trigger: secrets.CLOUD_TRIGGER_ID || undefined };
  } catch { return {}; }
}

/**
 * The dispatcher's overflow: `config` is the switch ({ enabled, cap, trigger }), `secrets` reads the token, `file` keeps the
 * fired lanes. `live(found)` judges them against a survey and names the live ones' increments, which the box never starts
 * meanwhile; `wants()` says whether a fire could happen now (switched on, under the cap, past any back-off), so a saturated
 * box surveys for it only then; `overflow(found, …)` fires for the pool's eligible picks up to the cap, each fire at most once
 * per increment (a cloud lane that failed leaves its increment to the box), each pick's body read by `body` only once it is
 * a candidate (the survey carries none, 2.32). A fire error leaves the increment ready, is said
 * once until a fire succeeds, and holds every fire until its Retry-After or FIRE_BACKOFF_MS. `watching()` names the increments
 * of the lanes not yet landed or failed, which a survey reads whatever their status, so each lane is judged by how it closed.
 */
export function cloudOverflow({ config, secrets, file, fire = fireCloud, now = Date.now, say, body = async (one) => one.body ?? "",
  read = (path) => readFile(path, "utf8"), write = (path, text) => writeFile(path, text) }) {
  const at = (ms) => new Date(ms).toISOString();
  let ledger, until = 0, said = new Set(), counted;
  const load = async () => (ledger ??= await read(file).then((text) => JSON.parse(text), () => undefined) ?? { lanes: [], fireErrors: 0 });
  const save = () => write(file, `${JSON.stringify(ledger, null, 2)}\n`);
  const once = (key, line = key) => { if (!said.has(key)) { said.add(key); say(line); } };
  const recount = () => { const line = cloudCounts(ledger); if (line !== counted) { counted = line; say(line); } };
  const liveOnes = () => ledger.lanes.filter((lane) => lane.state === "live");
  const live = async (found) => {
    await load();
    const judged = judgeLanes(ledger.lanes, found, now());
    if (JSON.stringify(judged) !== JSON.stringify(ledger.lanes)) {
      for (const [i, lane] of judged.entries()) if (lane.state !== ledger.lanes[i].state) say(`cloud lane for ${lane.increment} ${lane.state}${lane.why ? `: ${lane.why}` : ""}`);
      ledger.lanes = judged;
      await save();
      recount();
    }
    return liveOnes().map((lane) => lane.increment);
  };
  return {
    live,
    watching: async () => (await load()).lanes.filter((lane) => lane.state !== "landed" && lane.state !== "failed").map((lane) => lane.increment),
    wants: async () => config.enabled === true && now() >= until && (await load(), liveOnes().length < config.cap),
    overflow: async (found, { attempts, running = [] } = {}) => {
      if (!config.enabled) return;
      const flying = await live(found);
      const room = config.cap - flying.length;
      if (room <= 0 || now() < until) return;
      const { token, trigger: stored } = await secrets();
      const trigger = config.trigger ?? stored;
      if (!trigger || !token) { once("cloud overflow is switched on but has no trigger or token (CLOUD_TRIGGER_TOKEN in secrets.json): firing nothing"); return; }
      const fired = new Set(ledger.lanes.map((lane) => lane.increment));
      const { picks } = pickPool(found, { attempts, running: [...running, ...flying], max: Infinity, now: now() });
      let sent = 0;
      for (const pick of picks.filter((one) => !fired.has(one.id))) {
        if (sent >= room) break;
        let one;
        try { one = { ...pick, body: await body(pick) }; }
        catch (error) { once(`body unread: ${pick.id}`, `cloud overflow skipped ${pick.id}: its body is unread (${String(error.message).split("\n")[0]})`); continue; }
        if (whyNotCloud(one)) continue;
        sent += 1;
        try {
          const { session, url } = await fire({ trigger, token, text: one.id });
          ledger.lanes.push({ increment: one.id, session, url, at: at(now()), state: "live" });
          said = new Set();
          await save();
          say(`cloud lane fired for ${one.id} (box saturated): session ${session}${url ? ` ${url}` : ""}`);
        } catch (error) {
          until = now() + (error.retryAfter ? error.retryAfter * 1000 : FIRE_BACKOFF_MS);
          ledger.fireErrors = (ledger.fireErrors ?? 0) + 1;
          await save();
          const why = String(error.message).split("\n")[0];
          once(`fire failed: ${why}`, `cloud fire failed (${why}): ${one.id} stays ready for the box; no fire before ${at(until)}`);
          break;
        }
      }
      recount();
    },
  };
}
