/**
 * Capability 3 · Data schema. The shape of a story's code survey: what the map's code survey finds in a story's
 * package, and what the forest draws from it. It is defined here, the registry of shapes stories share (ADR-1017
 * D1): the map, which produces it, and the forest, which reads it, both take it from here. So is the shape of a
 * project's shared stores (ADR-1332 D1, D2 (1)), which the map reads and the forest draws beside the islands.
 */

/**
 * A surveyed source file. `capability` is absent for Unclaimed ground. A declared file also carries its
 * declared number and the capability numbers whose numbered tests reach it, lowest first.
 */
export type SurveyedFile = {
  readonly path: string;
  readonly lines: number;
  readonly capability?: string;
  readonly declared?: number;
  readonly reachedBy?: readonly number[];
};

/** An import from one source file to another. */
export type FileImport = { readonly from: string; readonly to: string };

/** A test or test helper, kept apart from source-line counts with its numbered identities and imports. */
export type SurveyedTest = {
  readonly kind: "test";
  readonly path: string;
  readonly titles: readonly { readonly number: string; readonly title: string; readonly package?: string }[];
  readonly imports: readonly FileImport[];
};

/**
 * One import behind a derived edge: the importing file, the file that defines what it takes (absent when it cannot be found), and whether it took types alone.
 * A forwarder's importing file declares nothing of its own and only passes on names from one other story (ADR-1085 D3).
 * `plumbing` is a build step or cleanup the checkout's storytree.check.json declares for that file and the package it reaches.
 */
export type EdgeFile = { readonly from: string; readonly to?: string; readonly typeOnly: boolean; readonly forwarder?: true; readonly plumbing?: "build step" | "cleanup" };

/**
 * An edge the code derives from a story to another (ADR-0991 D1, D2), or to itself between two of its capabilities: from
 * its capability to the other's, type-only when every import behind it is. A capability absent at either end makes it a
 * story edge with no capability edge under it; `files` names the imports, or the manifest parts loaded, that cause it.
 */
export type CodeEdge = { readonly story: string; readonly from?: string; readonly to?: string; readonly typeOnly: boolean; readonly files: readonly EdgeFile[] };

export type StorySurvey = {
  readonly files: readonly SurveyedFile[];
  readonly imports: readonly FileImport[];
  /** Numbered tests and helpers; absent only in older saved surveys. */
  readonly tests?: readonly SurveyedTest[];
  /** The edges its source files' imports and manifest loads derive, by capability (ADR-0991 D1, D2), its own story's included; absent in older saved surveys. */
  readonly edges?: readonly CodeEdge[];
  /** The stories whose packages this story's package depends on, through any field of its package.json; absent when it has none (ADR-0840 D2). */
  readonly dependsOn?: readonly string[];
  /**
   * Present for a mapped story (ADR-0993 D2): the folder this machine imports it from, its files' paths being
   * from there, and the stories round a loop of roads it is in, itself first, when it is in one.
   */
  readonly mapped?: { readonly folder: string; readonly loop?: readonly string[] };
};

/** A column of a table, its type as the migration wrote it, lower-cased and compacted. */
export type StoreColumn = { readonly name: string; readonly type: string };
/** A foreign key: the table's columns, the table they reference, and its columns there (empty when the key names none). */
export type StoreForeignKey = { readonly columns: readonly string[]; readonly table: string; readonly references: readonly string[] };
/** A table of a SQL store, and the migration files that made or changed it, in the order they were applied. */
export type StoreTable = { readonly name: string; readonly columns: readonly StoreColumn[]; readonly foreignKeys: readonly StoreForeignKey[]; readonly from: readonly string[] };
/** A piece of evidence for a store: the file, and what in it names the store. */
export type StoreEvidence = { readonly file: string; readonly says: string };
export type StoreMedium = "postgres" | "mysql" | "redis" | "mongodb";
/** A shared store: its address, its medium, the evidence naming it, and (for a SQL store) its tables. */
export type SharedStore = { readonly address: string; readonly medium: StoreMedium; readonly evidence: readonly StoreEvidence[]; readonly tables: readonly StoreTable[] };
