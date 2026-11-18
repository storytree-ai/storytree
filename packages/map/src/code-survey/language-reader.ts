// Capability 8 · Code survey
import type { PathAliases } from "./tsconfig.js";

export type SourceFile = { readonly path: string; readonly text: string; readonly testSupport?: boolean };

export type SurveyPackage = {
  readonly root: string; readonly name: string; readonly exports: Readonly<Record<string, string>>; readonly imports?: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly tsconfigs?: readonly { readonly dir: string; readonly aliases: PathAliases }[];
  readonly deps?: readonly string[];
  readonly parts?: Readonly<Record<string, readonly { readonly from: string; readonly export: string }[]>>;
};

export type Edge = { readonly to: string; readonly reexport: boolean; readonly typeOnly: boolean; readonly names: readonly (readonly [name: string, as: string])[] | "all" };

export type Offers = {
  readonly local: ReadonlySet<string>;
  readonly from: ReadonlyMap<string, { readonly to: string; readonly name?: string }>;
  readonly star: readonly string[];
};

export interface LanguageReader {
  readonly files: RegExp;
  readonly declarations?: RegExp;
  readonly tests: RegExp;
  readonly testSupport: RegExp;
  titlesOf(file: SourceFile): readonly string[];
  edgesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[];
  offersOf?(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Offers;
  registersTests(file: SourceFile): boolean;
  declarationOf(text: string): { readonly number: number; readonly title: string } | undefined;
  ready?(): Promise<void>;
}
