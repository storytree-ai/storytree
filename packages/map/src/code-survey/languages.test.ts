/**
 * Capability 8 · Code survey: which languages the survey reads, and which a folder's code is in (8.53).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { readsFile } from "./code-survey.js";
import { folderLanguages } from "./folder-languages.js";
import { languageList, languagesOf, SURVEYED_LANGUAGES, UNREAD_LANGUAGES } from "./languages.js";

async function write(folder: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), text);
  }
}

/** A file of each language, by its name. */
const SAMPLE: Readonly<Record<string, string>> = {
  JavaScript: "a.mjs", TypeScript: "a.tsx", Python: "a.py", Go: "a.go", Rust: "a.rs", Java: "A.java", Kotlin: "a.kt", Scala: "a.scala",
  "C#": "a.cs", "F#": "a.fs", C: "a.c", "C++": "a.cpp", Swift: "a.swift", "Objective-C": "a.m", Ruby: "a.rb", PHP: "a.php",
  Elixir: "a.ex", Erlang: "a.erl", Haskell: "a.hs", Dart: "a.dart", Lua: "a.lua", Zig: "a.zig", SQL: "a.sql",
};

test("8.53 · the languages named as read are exactly those whose files the survey's readers read, and a folder's code is named by what it reads and what it cannot", async () => {
  assert.deepEqual([...SURVEYED_LANGUAGES, ...UNREAD_LANGUAGES].sort(), Object.keys(SAMPLE).sort(), "every language has a sample");
  for (const name of SURVEYED_LANGUAGES) assert.equal(readsFile(SAMPLE[name]!), true, `${name} is named as read, so a reader reads ${SAMPLE[name]}`);
  for (const name of UNREAD_LANGUAGES) assert.equal(readsFile(SAMPLE[name]!), false, `${name} is named as unread, so no reader reads ${SAMPLE[name]}`);

  assert.deepEqual(languagesOf(["src/app.py", "db/schema.sql", "README.md", "web/x.ts"]), { read: ["TypeScript", "Python"], unread: ["SQL"] });
  assert.equal(languageList(["Go"]), "Go");
  assert.equal(languageList(["JavaScript", "TypeScript", "Python"]), "JavaScript, TypeScript and Python");

  const root = await mkdtemp(path.join(tmpdir(), "storytree-languages-"));
  try {
    // A folder outside a checkout is walked, past node_modules and hidden folders.
    const loose = path.join(root, "loose");
    await write(loose, { "cmd/main.go": "package main", "node_modules/x/index.js": "", ".tools/run.py": "", "db/q.sql": "" });
    assert.deepEqual(await folderLanguages(loose), { read: [], unread: ["Go", "SQL"] });

    // A checkout's code is its files Git lists: tracked or new, never ignored.
    const checkout = path.join(root, "checkout");
    await write(checkout, { "src/lib.rs": "", "build/gen.py": "", ".gitignore": "build/\n", "web/app.ts": "" });
    execFileSync("git", ["init", "-q", checkout]);
    execFileSync("git", ["-C", checkout, "add", "src/lib.rs"]);
    assert.deepEqual(await folderLanguages(checkout), { read: ["TypeScript"], unread: ["Rust"] }, "ignored build/gen.py is not the project's code");
  } finally {
    await removeTemp(root);
  }
});
