import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeletionRequest, JourneyState } from "./bridge.js";
import { createPostHogTransport, JOURNEY_EVENTS, JOURNEY_VERSION, type DeliveryEvent } from "./posthog.js";

export type { JourneyState, JourneyBridge, DeletionRequest } from "./bridge.js";
export { JOURNEY_CHANNELS } from "./bridge.js";

/** No key ships yet. Configuration is supplied only after the owner's activation gate. */
export interface JourneyConfiguration {
  projectKey: string;
  retention: string;
  deletionContact: string;
}
export interface JourneyTransport {
  send(event: DeliveryEvent): Promise<void>;
  close(): Promise<void>;
}
const MAX_EVENTS = 500;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_LIMIT_MS = 3_000;

/** One computer-wide consent record and bounded queue, shared atomically by app and CLI. */
export function openJourney(options: { home: string; appVersion: string; configuration?: JourneyConfiguration }) {
  if (!JOURNEY_VERSION.test(options.appVersion)) throw new Error("Journey events need a release version.");
  const configuration = options.configuration;
  const available = configuration !== undefined && /^phc_[A-Za-z0-9_]+$/.test(configuration.projectKey)
    && configuration.retention.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuration.deletionContact);
  mkdirSync(options.home, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(options.home, "journey-events.sqlite"));
  db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;");
  db.exec(`CREATE TABLE IF NOT EXISTS consent (singleton INTEGER PRIMARY KEY CHECK(singleton=1), choice TEXT NOT NULL, epoch INTEGER NOT NULL, install_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (uuid TEXT PRIMARY KEY, event TEXT NOT NULL, version TEXT NOT NULL, at INTEGER NOT NULL, epoch INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS milestones (name TEXT PRIMARY KEY);`);
  db.prepare("INSERT OR IGNORE INTO consent VALUES (1, 'pending', 0, ?)").run(randomUUID());
  let closed = false;
  let flushing: Promise<number> | undefined;
  const consent = () => db.prepare("SELECT choice,epoch,install_id FROM consent WHERE singleton=1").get() as { choice: JourneyState["consent"]; epoch: number; install_id: string };
  const prune = () => db.prepare("DELETE FROM events WHERE at < ?").run(Date.now() - MAX_AGE_MS);
  function state(): JourneyState {
    prune();
    const current = consent();
    return { consent: current.choice, available, installId: current.install_id,
      queued: Number(db.prepare("SELECT count(*) AS count FROM events").get()!.count),
      ...(available ? { retention: configuration!.retention, deletionContact: configuration!.deletionContact } : {}),
    };
  }
  function choose(on: unknown): JourneyState {
    if (typeof on !== "boolean") throw new Error("Choose whether to share journey events.");
    if (on && !available) throw new Error("Journey sharing is not available in this build.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (consent().choice !== (on ? "on" : "off")) {
        db.prepare("UPDATE consent SET choice=?, epoch=epoch+1 WHERE singleton=1").run(on ? "on" : "off");
      }
      if (!on) db.exec("DELETE FROM events");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return state();
  }
  function record(event: unknown, fields: unknown = {}): boolean {
    if (typeof event !== "string" || !JOURNEY_EVENTS.has(event) || fields === null || typeof fields !== "object"
      || Array.isArray(fields) || Object.keys(fields).length !== 0) throw new Error("Only named journey milestones without additional content may be shared.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = consent();
      if (!available || current.choice !== "on") { db.exec("COMMIT"); return false; }
      const once = event === "app_version" ? `${event}:${options.appVersion}` : event;
      if (event !== "error") {
        const added = db.prepare("INSERT OR IGNORE INTO milestones VALUES (?)").run(once);
        if (added.changes === 0) { db.exec("COMMIT"); return false; }
      }
      prune();
      db.prepare("INSERT INTO events VALUES (?,?,?,?,?)").run(randomUUID(), event, options.appVersion, Date.now(), current.epoch);
      db.exec(`DELETE FROM events WHERE uuid IN (SELECT uuid FROM events ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ${MAX_EVENTS})`);
      db.exec("COMMIT");
      return true;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  async function sendPending(injected?: JourneyTransport): Promise<number> {
    const current = consent();
    if (!available || current.choice !== "on") return 0;
    const permitted = () => !closed && consent().choice === "on" && consent().epoch === current.epoch;
    const transport = injected ?? createPostHogTransport({ projectKey: configuration!.projectKey, permitted });
    let sent = 0;
    const deadline = Date.now() + FLUSH_LIMIT_MS;
    try {
      prune();
      const pending = db.prepare("SELECT * FROM events WHERE epoch=? ORDER BY at,rowid").all(current.epoch) as { uuid: string; event: string; version: string; at: number; epoch: number }[];
      for (const row of pending) {
        if (!permitted() || Date.now() >= deadline) break;
        await transport.send({ uuid: row.uuid, event: row.event, distinctId: current.install_id,
          timestamp: new Date(row.at).toISOString(), properties: { app_version: row.version } });
        db.prepare("DELETE FROM events WHERE uuid=?").run(row.uuid);
        sent++;
      }
    } catch { /* Offline or revoked: leave unacknowledged events for a later invocation. */ }
    finally { await transport.close().catch(() => {}); }
    return sent;
  }
  function flush(transport?: JourneyTransport): Promise<number> {
    return flushing ??= sendPending(transport).finally(() => { flushing = undefined; });
  }
  function prepareDeletion(): DeletionRequest {
    const after = choose(false);
    return { installId: after.installId, ...(after.deletionContact ? { contact: after.deletionContact } : {}) };
  }
  return { state, choose, record, flush, prepareDeletion,
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
