/**
 * Capability 8 · Code survey: the reader of Python, the survey's second language (arc_1cb3e3979611). A Python
 * file is `.py`; a test file is pytest's `test_*.py` or `*_test.py`, and `conftest.py` is test support. So far
 * it draws a mapped island's files, which nothing parses: its test titles, imports and declarations are the
 * built-story survey's and the test join's, the arc's later increments, so it reads none yet.
 */
import type { LanguageReader } from "./language-reader.js";

/** A pytest test file, by its path. */
export const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

/** Python, read by its files' paths alone. */
export const pythonReader: LanguageReader = {
  files: /\.py$/,
  tests: PYTEST_FILE,
  testSupport: /(?:^|\/)conftest\.py$/,
  titlesOf: () => [],
  edgesOf: () => [],
  registersTests: () => false,
  declarationOf: () => undefined,
};
