// Capability 3 · Data schema
import { z } from "zod";

import { HEALTH_KINDS } from "../../health/kinds.js";
import { DECISION_KINDS, DECISION_MARKED, DECISION_UPGRADES, DECISION_VERSIONS } from "../../knowledge/decisions/kinds.js";
import { NOTE_KINDS, NOTE_MARKED, NOTE_REFUSALS, NOTE_UPGRADES, NOTE_VERSIONS } from "../../knowledge/notes/kinds.js";
import { PLAN_KINDS, PLAN_UPGRADES, PLAN_VERSIONS } from "../../plan/kinds.js";
import { ARC_KINDS, ARC_UPGRADES, ARC_VERSIONS } from "../../work/arcs/kinds.js";
import { INBOX_KINDS } from "../../work/inbox/kinds.js";

export const RECORD_SCHEMAS = { ...ARC_KINDS, ...PLAN_KINDS, ...HEALTH_KINDS, ...DECISION_KINDS, ...NOTE_KINDS, ...INBOX_KINDS };

export type RecordType = keyof typeof RECORD_SCHEMAS;

export type FieldsOf<T extends RecordType> = z.infer<(typeof RECORD_SCHEMAS)[T]>;

export const SCHEMA_VERSIONS: { readonly [T in RecordType]: number } = {
  ...(Object.fromEntries(Object.keys(RECORD_SCHEMAS).map((type) => [type, 1])) as { [T in RecordType]: number }),
  ...ARC_VERSIONS,
  ...DECISION_VERSIONS,
  ...NOTE_VERSIONS,
  ...PLAN_VERSIONS,
};

export interface UpgradeStep {
  readonly type: string;
  readonly from: number;
  readonly name: string;
  readonly reads?: readonly string[];
  up(fields: Record<string, unknown>): Record<string, unknown>;
}

export interface LibrarySchema {
  readonly versions: Readonly<Record<string, number>>;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly upgrades: readonly UpgradeStep[];
  readonly refused?: Readonly<Record<string, string>>;
  readonly marked?: readonly string[];
}

export const LIBRARY_SCHEMA: LibrarySchema = {
  versions: SCHEMA_VERSIONS,
  schemas: RECORD_SCHEMAS,
  upgrades: [...ARC_UPGRADES, ...PLAN_UPGRADES, ...DECISION_UPGRADES, ...NOTE_UPGRADES],
  refused: NOTE_REFUSALS,
  marked: [...NOTE_MARKED, ...DECISION_MARKED],
};

export interface PluginUpgradeStep {
  readonly from: number;
  readonly name: string;
  readonly rename?: Readonly<Record<string, string>>;
  readonly remove?: readonly string[];
  readonly set?: Readonly<Record<string, unknown>>;
}

export interface PluginRecordKind {
  readonly kind: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly upgrades?: readonly PluginUpgradeStep[];
  readonly writers: readonly string[];
}

export function pluginSchema(kinds: readonly PluginRecordKind[], base: LibrarySchema = LIBRARY_SCHEMA): LibrarySchema {
  const versions: Record<string, number> = { ...base.versions };
  const schemas: Record<string, z.ZodType> = { ...base.schemas };
  const upgrades = [...base.upgrades];
  for (const { kind, version, fields, upgrades: steps = [] } of kinds) {
    const named = JSON.stringify(kind);
    if (!/^[^.]+\.[^.]+$/.test(kind)) throw new Error(`${named} is not named <plugin>.<kind>`);
    if (Object.hasOwn(versions, kind)) throw new Error(`${named} is declared twice`);
    if (fields["type"] !== "object") throw new Error(`${named}'s fields must be a JSON Schema of type "object"`);
    versions[kind] = version;
    schemas[kind] = z.fromJSONSchema(fields as Parameters<typeof z.fromJSONSchema>[0]);
    for (const step of steps) {
      upgrades.push({
        type: kind,
        from: step.from,
        name: step.name,
        reads: [...Object.keys(step.rename ?? {}), ...(step.remove ?? [])],
        up: (stored) => {
          const upgraded = { ...stored };
          for (const [from, to] of Object.entries(step.rename ?? {})) {
            if (Object.hasOwn(upgraded, from)) upgraded[to] = upgraded[from];
            delete upgraded[from];
          }
          for (const field of step.remove ?? []) delete upgraded[field];
          return { ...upgraded, ...step.set };
        },
      });
    }
  }
  return { ...base, versions, schemas, upgrades };
}
