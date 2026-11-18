// Capability 8 · Code survey
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf } from "./package-of.js";
import { PYTEST_FILE } from "./python-reader.js";
import { gitText } from "./survey-source.js";

const UNWALKED = new Set(["node_modules", "venv", "env", "__pycache__", "site-packages", "dist", "build"]);
const NAMED = /^[ \t]*(?:async[ \t]+)?def[ \t]+test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])/gim;
const DOCSTRING = /^[ \t]*(?:async[ \t]+)?def[ \t]+test\w*[ \t]*\([^)]*\)[^:\n]*:[ \t]*\r?\n\s*[rRuU]?(?:"""|'''|"|')\s*(?:([a-z][a-z0-9-]*)[ \t]+)?(\d+)\.(\d+)(?![0-9])/gim;

interface PytestNumber {
  readonly number: string;
  readonly package?: string;
}

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

async function pytestFiles(root: string): Promise<{ full: string; relative: string }[]> {
  const listed = await gitText(root, ["rev-parse", "--path-format=absolute", "--show-toplevel"]).then(
    async (top) => (await gitText(top, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).split("\0").filter(Boolean).map((file) => ({ full: path.join(top, file), relative: file })),
    () => undefined,
  );
  if (listed !== undefined) return listed.filter((file) => PYTEST_FILE.test(file.relative));
  const files: { full: string; relative: string }[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !UNWALKED.has(entry.name)) await walk(full);
      } else if (entry.isFile() && PYTEST_FILE.test(entry.name)) files.push({ full, relative: path.relative(root, full).replaceAll("\\", "/") });
    }
  };
  await walk(root);
  return files;
}

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

export async function pytestTestedNumbers(root: string, tree: AnnotatedTree, storyId: string, surveyed: readonly string[] = []): Promise<string[]> {
  const story = tree.stories.find((one) => one.id === storyId);
  if (story === undefined) return [];
  const own = packageOf(story);
  const packages = tree.stories.map(packageOf);
  const planned = plannedNumbers(tree);
  const numbers = new Set<string>();
  for (const file of await pytestFiles(root)) {
    if (surveyed.some((folder) => file.relative.startsWith(`${folder}/`))) continue;
    let text: string;
    try {
      text = await readFile(file.full, "utf8");
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
