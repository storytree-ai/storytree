/**
 * Capability 8 · Code survey: the one seam the survey reads a language through (arc_1cb3e3979611). The survey's
 * ranking, its reach and its numbered-test identities are the same for every language; what a language's files are,
 * which of them are tests, what titles its tests carry, what a file imports and what it declares are its reader's.
 * JavaScript and TypeScript are read by the reader in code-survey.ts; a further language is a further reader.
 */

/** A file of a story's package; the disk reader tags helpers outside src as test support. */
export type SourceFile = { readonly path: string; readonly text: string; readonly testSupport?: boolean };

/**
 * A package's literal exports, in the same coordinates as its source files; with the packages it depends on and the
 * parts its storytree manifest declares by kind, each a module subpath and the export it names, when its manifest was read.
 */
export type SurveyPackage = {
  readonly root: string; readonly name: string; readonly exports: Readonly<Record<string, string>>; readonly imports?: Readonly<Record<string, string>>;
  readonly deps?: readonly string[];
  readonly parts?: Readonly<Record<string, readonly { readonly from: string; readonly export: string }[]>>;
};

/**
 * One import or re-export a file makes of a file its story holds: the file it names, and the names it takes, each as
 * that file exports it (`names`) and as this file offers it on (`as`); "all" for the whole file.
 */
export type Edge = { readonly to: string; readonly reexport: boolean; readonly typeOnly: boolean; readonly names: readonly (readonly [name: string, as: string])[] | "all" };

/**
 * The names a module offers, by where they come from: those it binds itself (`local`), those it passes on from another
 * file of its story (`from`, the file and the name there; none for that file taken whole), and the files whose every
 * name it passes on (`star`).
 */
export type Offers = {
  readonly local: ReadonlySet<string>;
  readonly from: ReadonlyMap<string, { readonly to: string; readonly name?: string }>;
  readonly star: readonly string[];
};

/** How the survey reads one language. Paths are the survey's, with forward slashes. */
export interface LanguageReader {
  /** The files of this language the survey reads. */
  readonly files: RegExp;
  /** Files it reads that are no code of their own (TypeScript's declaration files): never surveyed, never reached. */
  readonly declarations?: RegExp;
  /** Its test files: read for their titles and imports, never counted. */
  readonly tests: RegExp;
  /** Test helpers by their path: never counted, though a test reaches through one. */
  readonly testSupport: RegExp;
  /** The titles a test file's tests carry, a numbered one starting "N.M" (perhaps after its package's name). */
  titlesOf(file: SourceFile): readonly string[];
  /** The imports a file makes of files `paths` holds, resolved through `packages` where the language needs them. */
  edgesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[];
  /** The names a file offers and where each comes from, among files `paths` holds, where the language's reader follows them (Python's). */
  offersOf?(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Offers;
  /** Whether a file registers tests itself, so a test file that runs it carries the titles it registers. */
  registersTests(file: SourceFile): boolean;
  /** The capability a source file's text declares in its opening comment (ADR-0925 D1), its number and the words after the dot; if any. */
  declarationOf(text: string): { readonly number: number; readonly title: string } | undefined;
  /** Loads what reading this language's files needs (a grammar), once: awaited before the survey reads one. */
  ready?(): Promise<void>;
}
