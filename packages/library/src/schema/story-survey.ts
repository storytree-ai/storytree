// Capability 3 · Data schema

export type SurveyedFile = {
  readonly path: string;
  readonly lines: number;
  readonly capability?: string;
  readonly declared?: number;
  readonly reachedBy?: readonly number[];
};

export type FileImport = { readonly from: string; readonly to: string };

export type SurveyedTest = {
  readonly kind: "test";
  readonly path: string;
  readonly titles: readonly { readonly number: string; readonly title: string; readonly package?: string }[];
  readonly imports: readonly FileImport[];
};

export type EdgeFile = { readonly from: string; readonly to?: string; readonly typeOnly: boolean; readonly forwarder?: true; readonly plumbing?: "build step" | "cleanup" };

export type CodeEdge = { readonly story: string; readonly from?: string; readonly to?: string; readonly typeOnly: boolean; readonly files: readonly EdgeFile[] };

export type SurveyedPart = { readonly folder: string; readonly entry?: string; readonly files: readonly string[]; readonly parts: readonly SurveyedPart[] };

export type PartClash = { readonly from: string; readonly to: string; readonly part: string; readonly enters: readonly string[]; readonly around: readonly string[]; readonly suggestion: string };

export type SurveyedParts = { readonly capabilities: Readonly<Record<string, readonly SurveyedPart[]>>; readonly clashes: readonly PartClash[] };

export type StorySurvey = {
  readonly files: readonly SurveyedFile[];
  readonly imports: readonly FileImport[];
  readonly tests?: readonly SurveyedTest[];
  readonly edges?: readonly CodeEdge[];
  readonly dependsOn?: readonly string[];
  readonly parts?: SurveyedParts;
  readonly mapped?: { readonly folder: string; readonly loop?: readonly string[] };
};

export type StoreTable = { readonly name: string };
export type SharedStore = { readonly address: string; readonly medium: string; readonly tables: readonly StoreTable[] };
