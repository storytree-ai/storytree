// Capability 3 · The pool's dispatcher overflows into Claude Code cloud sessions while the box is saturated (ADR-1264).
import { readFile, writeFile } from "node:fs/promises";

import { blind, HANDED, pickPool, readOnly } from "./feed.mjs";

export const fireUrl = (trigger) => `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(trigger)}/fire`;
export const CLAIM_GRACE_MS = 30 * 60_000;
export const FIRE_BACKOFF_MS = 30 * 60_000;

const BOX_ONLY = /\binfra\/|\bsystemd\b|\bssh mint\b|\bmint box\b|\bthe box\b|\bwatcher\b|\bdispatcher\b|\blag runs?\b|\bgpu\b|\bdesktop app\b|\bapps\/desktop\b|\blaptop\b|\bwindows\b|\bmacos\b|\bfactory\b/i;
const ROLES = /\bagent roles?\b|\.claude\/agents\b|\bguidance\b|\bhabits card\b/i;

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

export const whyRefused = (config) => (config.enabled === true && config.reviews !== true
  ? "a cloud lane cannot run the change-reviewer (the cloud switch's reviews is not true: the cloud environment does not load the plugin that provides storytree quality)"
  : undefined);

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

export function cloudCounts({ lanes = [], fireErrors = 0 }) {
  const count = (state) => lanes.filter((lane) => lane.state === state).length;
  return `cloud lanes: ${lanes.length} fired, ${count("landed")} landed, ${count("failed")} failed, ${count("live")} live, ${count("handed")} with the watcher; ${fireErrors} fire error${fireErrors === 1 ? "" : "s"}`;
}

export async function cloudSecrets(file, read = (path) => readFile(path, "utf8")) {
  try {
    const secrets = JSON.parse(await read(file));
    return { token: secrets.CLOUD_TRIGGER_TOKEN || undefined, trigger: secrets.CLOUD_TRIGGER_ID || undefined };
  } catch { return {}; }
}

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
    wants: async () => config.enabled === true && !whyRefused(config) && now() >= until && (await load(), liveOnes().length < config.cap),
    overflow: async (found, { attempts, running = [] } = {}) => {
      if (!config.enabled) return;
      const refused = whyRefused(config);
      if (refused) { once(`cloud overflow is switched on, but ${refused}: firing nothing`); return; }
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
