/**
 * Capability 3 · Data schema. A plugin's own kinds of record (ADR-1178 D3). A plugin's manifest names each as
 * `<plugin>.<kind>`, with its version, its fields' shape as JSON Schema, any upgrade steps and its writers, all as data:
 * a plugin imports no zod and no storytree types (ADR-1112). pluginSchema turns those declarations into the schema the
 * library runs on, beside the closed core kinds. A dotted kind no loaded plugin declares is dormant (records.ts).
 */
import { z } from "zod";

import type { LibrarySchema, UpgradeStep } from "./types.js";
import { LIBRARY_SCHEMA } from "./upgrades.js";

/** One step from `from` to `from + 1`, as data: fields renamed, then removed, then set where they are missing. */
export interface PluginUpgradeStep {
  readonly from: number;
  readonly name: string;
  readonly rename?: Readonly<Record<string, string>>;
  readonly remove?: readonly string[];
  readonly set?: Readonly<Record<string, unknown>>;
}

/** A kind of record a plugin declares in its manifest's `recordKinds`. */
export interface PluginRecordKind {
  /** `<plugin>.<kind>`, for example `voice.note`. */
  readonly kind: string;
  readonly version: number;
  /** The fields' shape: a JSON Schema of type "object". */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly upgrades?: readonly PluginUpgradeStep[];
  /** Who may write it: the database roles an outside writer connects as. */
  readonly writers: readonly string[];
}

/** Whether `type` is named as a plugin's kind is: `<plugin>.<kind>`. No core kind has a dot. */
export function isPluginKind(type: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(type);
}

/** `base` with each declared kind added; a declaration that cannot be read is refused, saying why. */
export function pluginSchema(kinds: readonly PluginRecordKind[], base: LibrarySchema = LIBRARY_SCHEMA): LibrarySchema {
  const versions: Record<string, number> = { ...base.versions };
  const schemas: Record<string, z.ZodType> = { ...base.schemas };
  const upgrades: UpgradeStep[] = [...base.upgrades];
  for (const declared of kinds) {
    const { kind, version, fields } = declared;
    const name = JSON.stringify(kind);
    if (typeof kind !== "string" || !isPluginKind(kind)) throw new Error(`the record kind ${name} is not named <plugin>.<kind>`);
    if (Object.hasOwn(versions, kind)) throw new Error(`the record kind ${name} is declared twice`);
    if (!Number.isInteger(version) || version < 1) throw new Error(`${name}'s version must be a whole number from 1`);
    if (typeof fields !== "object" || fields === null || fields.type !== "object") throw new Error(`${name}'s fields must be a JSON Schema of type "object"`);
    let shape: z.ZodType;
    try {
      shape = z.fromJSONSchema(fields as Parameters<typeof z.fromJSONSchema>[0]);
    } catch (error) {
      throw new Error(`${name}'s fields are not a JSON Schema this library reads: ${(error as Error).message}`);
    }
    versions[kind] = version;
    schemas[kind] = shape;
    upgrades.push(...(declared.upgrades ?? []).map((step) => upgradeStep(kind, step)));
  }
  return { versions, schemas, upgrades };
}

function upgradeStep(type: string, { from, name, rename = {}, remove = [], set = {} }: PluginUpgradeStep): UpgradeStep {
  return {
    type,
    from,
    name,
    up(fields) {
      const next: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(fields)) next[Object.hasOwn(rename, field) ? rename[field]! : field] = value;
      for (const field of remove) delete next[field];
      for (const [field, value] of Object.entries(set)) if (!Object.hasOwn(next, field)) next[field] = value;
      return next;
    },
  };
}
