/**
 * Capability 8 · Code survey: the contract numbers a Python project's pytest tests carry, so a landing credits them
 * (the landing check's slice of Python only, ADR-0993 D2 as narrowed by ADR-1189).
 *
 * - A test file is `test_*.py` or `*_test.py`, anywhere in the checkout: the files Git tracks or would add
 *   (its ignored files, a virtualenv say, left out), or, in a folder that is no checkout, every file on disk
 *   outside hidden, virtualenv, cache and dependency folders.
 * - A test carries a number by its name, `def test_2_1_…` (a Python name cannot start with a digit), or by
 *   its docstring starting `2.1`. Either may name a story's package first: `test_order_intake_2_1_…` (the
 *   package's hyphens as underscores) or a docstring `order-intake 2.1 …`, as a JS/TS title does.
 * - A number a story's package names is that story's alone. An unnamed one is a story's only while no other
 *   story in the plan has a contract with that number: two stories' 2.1 are told apart only by a prefix.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf } from "./package-of.js";
import { gitText } from "./survey-source.js";

const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;
/** Folders a walk of a non-checkout never enters, beside hidden ones: virtualenvs, caches and dependencies. */
const UNWALKED = new Set(["node_modules", "venv", "env", "__pycache__", "site-packages", "dist", "build"]);
/** A test's name: `test_`, then perhaps a package (words of letters and digits), then the number's two parts. */
const NAMED = /^[ \t]*(?:async[ \t]+)?def[ \t]+test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])/gim;
/** A test whose body opens with a docstring starting with a number, perhaps after a package's name. */
const DOCSTRING = /^[ \t]*(?:async[ \t]+)?def[ \t]+test\w*[ \t]*\([^)]*\)[^:\n]*:[ \t]*\r?\n\s*[rRuU]?(?:"""|'''|"|')\s*(?:([a-z][a-z0-9-]*)[ \t]+)?(\d+)\.(\d+)(?![0-9])/gim;

/** A number one pytest test carries, and the package it names, if any (hyphens, as packages/ spells it). */
interface PytestNumber {
  readonly number: string;
  readonly package?: string;
}

/** The numbers the tests in one pytest file's text carry, each with the package of `packages` it names. */
function pytestNumbersIn(text: string, packages: readonly string[]): PytestNumber[] {
  const known = new Map(packages.map((name) => [name.replaceAll("-", "_"), name]));
  const found: PytestNumber[] = [];
  for (const [, prefix, major, minor] of text.matchAll(NAMED)) {
    const words = prefix!.replace(/_$/, "").toLowerCase();
    if (words === "") found.push({ number: `${major}.${minor}` });
    else if (known.has(words)) found.push({ number: `${major}.${minor}`, package: known.get(words)! });
  }
  for (const [, named, major, minor] of text.matchAll(DOCSTRING)) {
    if (named === undefined) found.push({ number: `${major}.${minor}` });
    else if (packages.includes(named.toLowerCase())) found.push({ number: `${major}.${minor}`, package: named.toLowerCase() });
  }
  return found;
}

/** The pytest files of the checkout `root` is in, as full paths. */
async function pytestFiles(root: string): Promise<string[]> {
  const listed = await gitText(root, ["rev-parse", "--path-format=absolute", "--show-toplevel"]).then(
    async (top) => (await gitText(top, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).split("\0").filter(Boolean).map((file) => path.join(top, file)),
    () => undefined,
  );
  if (listed !== undefined) return listed.filter((file) => PYTEST_FILE.test(file.replaceAll("\\", "/")));
  const files: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !UNWALKED.has(entry.name)) await walk(full);
      } else if (entry.isFile() && PYTEST_FILE.test(entry.name)) files.push(full);
    }
  };
  await walk(root);
  return files;
}

/** Each contract number planned in `tree`, with the ids of the stories whose contracts carry it. */
function plannedNumbers(tree: AnnotatedTree): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const story of tree.stories) {
    for (const capability of story.capabilities) {
      for (const contract of capability.contracts ?? []) {
        const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
        if (number === undefined) continue;
        if (!owners.has(number)) owners.set(number, new Set());
        owners.get(number)!.add(story.id);
      }
    }
  }
  return owners;
}

/** The contract numbers the pytest tests of the checkout `root` is in carry for the story `storyId` of `tree`, by the rules above. */
export async function pytestTestedNumbers(root: string, tree: AnnotatedTree, storyId: string): Promise<string[]> {
  const story = tree.stories.find((one) => one.id === storyId);
  if (story === undefined) return [];
  const own = packageOf(story);
  const packages = tree.stories.map(packageOf);
  const planned = plannedNumbers(tree);
  const numbers = new Set<string>();
  for (const file of await pytestFiles(root)) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const found of pytestNumbersIn(text, packages)) {
      const others = [...(planned.get(found.number) ?? [])].filter((id) => id !== story.id);
      if (found.package !== undefined ? found.package === own : others.length === 0) numbers.add(found.number);
    }
  }
  return [...numbers];
}
