// Capability 3 · Record rules
import type { z } from "zod";

export interface RecordSchemas {}

export type RecordType = keyof RecordSchemas & string;

export type FieldsOf<T extends RecordType> = z.infer<RecordSchemas[T]>;

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
}
