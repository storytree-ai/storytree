/** Capability 1 · Portable user identity. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface ProviderIdentity {
  readonly provider: "google" | "github" | "microsoft";
  readonly subject: string;
}
export interface StorytreeUser {
  readonly id: string;
  readonly firstVerifiedEmail: string;
  readonly workosUserId: string;
  readonly identities: readonly ProviderIdentity[];
}
export class IdentityConflictError extends Error {
  constructor() { super("Identity conflict: these accounts cannot be joined automatically. Contact Storytree support."); }
}

/** Called explicitly at server startup, using the server's own database role. */
export async function initialize(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(874, 1)");
    await client.query(`CREATE TABLE IF NOT EXISTS storytree_users (
      id uuid PRIMARY KEY,
      first_verified_email text NOT NULL,
      workos_user_id text NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS storytree_user_identities (
      provider text NOT NULL CHECK (provider IN ('google', 'github', 'microsoft')),
      subject text NOT NULL CHECK (length(subject) > 0),
      user_id uuid NOT NULL REFERENCES storytree_users(id),
      PRIMARY KEY (provider, subject)
    );
    CREATE INDEX IF NOT EXISTS storytree_user_identities_user ON storytree_user_identities(user_id)`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Internal: accepts only the evidence the public token-verifying boundary has established. */
export async function remember(pool: Pool, evidence: {
  workosUserId: string; email: string; identities: readonly ProviderIdentity[];
}): Promise<StorytreeUser> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The first cohort's tiny mapping transaction is serialized across server processes.
    // The unique pair remains a database invariant; an overlapping first sign-in never forks a user.
    await client.query("SELECT pg_advisory_xact_lock(874, 2)");
    const pairs = evidence.identities.map(({ provider, subject }) => ({ provider, subject }));
    const existing = await client.query<{ user_id: string }>(`
      SELECT DISTINCT saved.user_id FROM storytree_user_identities saved
      JOIN jsonb_to_recordset($1::jsonb) AS incoming(provider text, subject text)
        ON saved.provider = incoming.provider AND saved.subject = incoming.subject`, [JSON.stringify(pairs)]);
    if (existing.rows.length > 1) throw new IdentityConflictError();
    const id = existing.rows[0]?.user_id ?? randomUUID();
    if (existing.rows.length === 0) {
      await client.query("INSERT INTO storytree_users (id, first_verified_email, workos_user_id) VALUES ($1, $2, $3)",
        [id, evidence.email, evidence.workosUserId]);
    } else {
      await client.query("UPDATE storytree_users SET workos_user_id = $2 WHERE id = $1", [id, evidence.workosUserId]);
    }
    // Retain all previously proved identities so changing broker/email never loses a durable key.
    await client.query(`INSERT INTO storytree_user_identities (provider, subject, user_id)
      SELECT provider, subject, $2::uuid FROM jsonb_to_recordset($1::jsonb) AS incoming(provider text, subject text)
      ON CONFLICT (provider, subject) DO NOTHING`, [JSON.stringify(pairs), id]);
    const { rows: users } = await client.query<{ id: string; first_verified_email: string; workos_user_id: string }>(
      "SELECT id, first_verified_email, workos_user_id FROM storytree_users WHERE id = $1", [id]);
    const { rows: identities } = await client.query<ProviderIdentity>(
      'SELECT provider, subject FROM storytree_user_identities WHERE user_id = $1 ORDER BY provider COLLATE "C", subject COLLATE "C"', [id]);
    const user = users[0]!;
    await client.query("COMMIT");
    return { id: user.id, firstVerifiedEmail: user.first_verified_email, workosUserId: user.workos_user_id, identities };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof IdentityConflictError || (typeof error === "object" && error !== null && "code" in error && error.code === "23505")) {
      throw new IdentityConflictError();
    }
    throw new Error("Storytree could not save your identity. Try again later.");
  } finally { client.release(); }
}
