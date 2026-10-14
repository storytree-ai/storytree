/**
 * Capability 3 · Data schema. The shape of a story's code survey: what the map's code survey finds in a story's
 * package, and what the forest draws from it. It is defined here, the registry of shapes stories share (ADR-1017
 * D1): the map, which produces it, and the forest, which reads it, both take it from here.
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

/** One import behind a derived edge: the importing file, the file that defines what it takes (absent when it cannot be found), and whether it took types alone. */
export type EdgeFile = { readonly from: string; readonly to?: string; readonly typeOnly: boolean };

/**
 * An edge the code derives from a story to another (ADR-0991 D1, D2): from its capability to the other
 * story's, type-only when every import behind it is. A capability absent at either end makes it a story
 * edge with no capability edge under it; `files` names the imports that cause it.
 */
export type CodeEdge = { readonly story: string; readonly from?: string; readonly to?: string; readonly typeOnly: boolean; readonly files: readonly EdgeFile[] };

export type StorySurvey = {
  readonly files: readonly SurveyedFile[];
  readonly imports: readonly FileImport[];
  /** Numbered tests and helpers; absent only in older saved surveys. */
  readonly tests?: readonly SurveyedTest[];
  /** The edges its source files' imports of other stories' packages derive, by capability (ADR-0991 D1, D2); absent in older saved surveys. */
  readonly edges?: readonly CodeEdge[];
  /** The stories whose packages this story's package depends on, through any field of its package.json; absent when it has none (ADR-0840 D2). */
  readonly dependsOn?: readonly string[];
  /**
   * Present for a mapped story (ADR-0993 D2): the folder this machine imports it from, its files' paths being
   * from there, and the stories round a loop of roads it is in, itself first, when it is in one.
   */
  readonly mapped?: { readonly folder: string; readonly loop?: readonly string[] };
};
