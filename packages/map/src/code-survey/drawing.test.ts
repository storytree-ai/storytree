/**
 * Capability 8 · Code survey: an imported story's capabilities and links drawn from its code (ADR-1324 D1, D2).
 * Written against small stories shaped like the two trials: a FastAPI backend and a flat package like tinydb.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readersReady } from "./code-survey.js";
import { drawImportedStory } from "./drawing.js";
import type { SourceFile } from "./language-reader.js";
// Gives the Python reader its parser.
import "./read-survey.js";

const filesOf = (files: Record<string, string>): SourceFile[] => Object.entries(files).map(([path, text]) => ({ path, text }));

/** A TypeScript package with src/: a leaf folder, a folder with a folder beneath it, root files, configuration, tests. */
const SHOP = filesOf({
  "packages/shop/package.json": "{\"name\":\"@shop/shop\"}\n",
  "packages/shop/vite.config.ts": "export default {};\n",
  "packages/shop/src/index.ts": "export { add } from \"./cart/add.js\";\n",
  "packages/shop/src/empty.ts": "\n",
  "packages/shop/src/types.d.ts": "export type Cart = string[];\n",
  "packages/shop/src/cart/add.ts": "import { remove } from \"./remove.js\";\nexport const add = () => remove();\n",
  "packages/shop/src/cart/remove.ts": "export const remove = () => 1;\n",
  "packages/shop/src/cart/add.test.ts": "import { add } from \"./add.js\";\ntest(\"1.1 adds\", () => add());\n",
  "packages/shop/src/testing/fake.ts": "export const fake = 1;\n",
  "packages/shop/src/pay/index.ts": "import { visa } from \"./cards/visa.js\";\nimport { fake } from \"../testing/fake.js\";\nexport const pay = () => visa + fake;\n",
  "packages/shop/src/pay/cards/visa.ts": "import { add } from \"../../cart/add.js\";\nexport const visa = add();\n",
});

/** A flat Python package at the top of its story, like tinydb: its root and one module import each other. */
const TINY = filesOf({
  "setup.py": "from setuptools import setup\nsetup()\n",
  "tinydb/__init__.py": "from .database import TinyDB\nVERSION = 1\n",
  "tinydb/database.py": "from . import VERSION\nfrom .table import Table\nclass TinyDB: pass\n",
  "tinydb/table.py": "from .utils import freeze\nclass Table: pass\n",
  "tinydb/utils.py": "def freeze(): pass\n",
  "tests/__init__.py": "",
  "tests/conftest.py": "import pytest\n",
  "tests/test_tinydb.py": "from tinydb import TinyDB\ndef test_it(): TinyDB()\n",
});

/** A FastAPI backend: its import package under the story's folder, a leaf folder, and a loop across a folder and a module. */
const BACKEND = filesOf({
  "backend/pyproject.toml": "[project]\nname = \"app\"\n",
  "backend/app/__init__.py": "",
  "backend/app/main.py": "from app.api.main import api_router\nfrom app.core import config\n",
  "backend/app/models.py": "class Item: pass\n",
  "backend/app/crud.py": "from app.core.security import hash_password\nfrom app.models import Item\n",
  "backend/app/api/__init__.py": "",
  "backend/app/api/main.py": "from app.api.routes import items\napi_router = items\n",
  "backend/app/api/deps.py": "from app.core.db import engine\nfrom app.models import Item\n",
  "backend/app/api/routes/__init__.py": "",
  "backend/app/api/routes/items.py": "from app.api.deps import engine\nfrom app import crud\nfrom app.api.routes import users\n",
  "backend/app/api/routes/users.py": "from app.api.deps import engine\n",
  "backend/app/core/__init__.py": "",
  "backend/app/core/config.py": "settings = 1\n",
  "backend/app/core/db.py": "from app import crud\nfrom app.core.config import settings\nengine = settings\n",
  "backend/app/core/security.py": "from app.core.config import settings\ndef hash_password(): pass\n",
  "backend/tests/__init__.py": "",
  "backend/tests/conftest.py": "from app.core.db import engine\n",
  "backend/tests/api/__init__.py": "",
  "backend/tests/api/test_items.py": "from app.api.deps import engine\ndef test_items(): pass\n",
});

const titles = (drawing: ReturnType<typeof drawImportedStory>) => drawing.capabilities.map(({ title }) => title);

test("8.61 an imported story's code is drawn as capabilities: below its source root each leaf folder of code is one and every other code file is one of its own; tests, test support, declarations and empty files are none", async () => {
  await readersReady([...SHOP, ...TINY, ...BACKEND].map((file) => file.path));
  assert.deepEqual(drawImportedStory({ folder: "packages/shop", files: SHOP }).capabilities, [
    { title: "src/cart", covers: ["packages/shop/src/cart"] },
    { title: "src/index.ts", covers: ["packages/shop/src/index.ts"] },
    { title: "src/pay/cards", covers: ["packages/shop/src/pay/cards"] },
    { title: "src/pay/index.ts", covers: ["packages/shop/src/pay/index.ts"] },
    { title: "vite.config.ts", covers: ["packages/shop/vite.config.ts"] },
  ], "src/ is the source root: a leaf folder is one, a file beside a folder of code, in src/ or outside it is one of its own");

  assert.deepEqual(titles(drawImportedStory({ folder: "packages/pay", files: filesOf({ "packages/pay/index.js": "module.exports = require(\"./lib/pay.mjs\");\n", "packages/pay/lib/pay.mjs": "export const pay = 1;\n" }) })),
    ["index.js", "lib"], "a JavaScript package with no src/ is drawn from its folder");
  assert.deepEqual(titles(drawImportedStory({ folder: ".", files: TINY })), ["setup.py", "tinydb/__init__.py + tinydb/database.py", "tinydb/table.py", "tinydb/utils.py"],
    "the import package at the story's top is the source root, each of its modules one, the configuration outside it one");
  assert.deepEqual(titles(drawImportedStory({ folder: "backend", files: BACKEND })),
    ["app/api/deps.py", "app/api/main.py", "app/api/routes", "app/core + app/crud.py", "app/main.py", "app/models.py"],
    "the import package holding code is the source root, not the tests' folder");
});

test("8.62 a drawn capability depends on another exactly when one of its files imports a file of the other; an import within one, or of a file in none, is no link", async () => {
  await readersReady([...SHOP, ...BACKEND].map((file) => file.path));
  assert.deepEqual(drawImportedStory({ folder: "packages/shop", files: SHOP }).links, [
    { from: "src/index.ts", to: "src/cart" },
    { from: "src/pay/cards", to: "src/cart" },
    { from: "src/pay/index.ts", to: "src/pay/cards" },
  ], "cart/add's import of cart/remove is within one, pay's of testing/ is of a file in none, and the test's is a test's");

  assert.deepEqual(drawImportedStory({ folder: "backend", files: BACKEND }).links, [
    { from: "app/api/deps.py", to: "app/core + app/crud.py" },
    { from: "app/api/deps.py", to: "app/models.py" },
    { from: "app/api/main.py", to: "app/api/routes" },
    { from: "app/api/routes", to: "app/api/deps.py" },
    { from: "app/api/routes", to: "app/core + app/crud.py" },
    { from: "app/core + app/crud.py", to: "app/models.py" },
    { from: "app/main.py", to: "app/api/main.py" },
    { from: "app/main.py", to: "app/core + app/crud.py" },
  ], "Python's absolute imports resolve from the story's folder, as the survey's reader resolves them");
});

test("8.62 a name taken from a file that only passes it on (a package root's re-export, in Python or TypeScript) links to the file that binds it, so a root and the modules it re-exports draw no loop", async () => {
  const flat = filesOf({
    "tinydb/__init__.py": "from .database import TinyDB\nfrom .storages import JSONStorage, Storage\nfrom .operations import *\n",
    "tinydb/database.py": "from . import JSONStorage\nclass TinyDB: pass\n",
    "tinydb/storages.py": "class Storage: pass\nclass JSONStorage(Storage): pass\n",
    "tinydb/middlewares.py": "from tinydb import Storage\nclass Middleware(Storage): pass\n",
    "tinydb/operations.py": "def delete(): pass\n",
    "tinydb/queries.py": "from tinydb import delete\n",
  });
  await readersReady(flat.map((file) => file.path));
  assert.deepEqual(drawImportedStory({ folder: ".", files: flat }), {
    capabilities: ["tinydb/__init__.py", "tinydb/database.py", "tinydb/middlewares.py", "tinydb/operations.py", "tinydb/queries.py", "tinydb/storages.py"].map((title) => ({ title, covers: [title] })),
    links: [
      { from: "tinydb/__init__.py", to: "tinydb/database.py" },
      { from: "tinydb/__init__.py", to: "tinydb/operations.py" },
      { from: "tinydb/__init__.py", to: "tinydb/storages.py" },
      { from: "tinydb/database.py", to: "tinydb/storages.py" },
      { from: "tinydb/middlewares.py", to: "tinydb/storages.py" },
      { from: "tinydb/queries.py", to: "tinydb/operations.py" },
    ],
  }, "database and middlewares take their names through the root, and link to storages, which binds them; queries takes one the root's wildcard passes on, and links to operations");

  const barrel = filesOf({
    "src/index.ts": "export { add } from \"./add.js\";\nexport { total } from \"./total.js\";\n",
    "src/add.ts": "import { total } from \"./index.js\";\nexport const add = () => total();\n",
    "src/total.ts": "export const total = () => 1;\n",
  });
  assert.deepEqual(drawImportedStory({ folder: ".", files: barrel }).links, [
    { from: "src/add.ts", to: "src/total.ts" },
    { from: "src/index.ts", to: "src/add.ts" },
    { from: "src/index.ts", to: "src/total.ts" },
  ], "a TypeScript barrel's modules that import through it are not merged with it");
});

/** A Next.js app at its import's top: imports by its tsconfig's path aliases and by another of its packages' names. */
const NEXT = filesOf({
  "tsconfig.json": "{\n  // Next.js writes comments and trailing commas\n  \"compilerOptions\": {\n    \"baseUrl\": \".\",\n    \"paths\": { \"@/*\": [\"./*\"], \"@ui\": [\"./packages/ui/src/index.ts\"], },\n  },\n}\n",
  "package.json": "{\"name\":\"taxonomy\"}\n",
  "app/page.tsx": "import { Button } from \"@/components/button\";\nimport { cn } from \"@/lib/utils\";\nexport default () => Button(cn());\n",
  "components/button.tsx": "import { cn } from \"@/lib/utils\";\nimport { ui } from \"@acme/ui\";\nexport const Button = (name: string) => cn(name, ui);\n",
  "lib/utils.ts": "import clsx from \"clsx\";\nimport { ui } from \"@ui\";\nexport const cn = (...names: unknown[]) => clsx(names, ui);\n",
  "packages/ui/package.json": "{\"name\":\"@acme/ui\",\"main\":\"src/index.ts\"}\n",
  "packages/ui/tsconfig.json": "{ \"compilerOptions\": {} }\n",
  "packages/ui/src/index.ts": "import { cn } from \"@/lib/utils\";\nexport const ui = cn;\n",
});

test("8.62 an import by the nearest tsconfig's path alias, or by the name of another package the story holds (its main, else its index), links as a relative one does", async () => {
  await readersReady(NEXT.map((file) => file.path));
  assert.deepEqual(drawImportedStory({ folder: ".", files: NEXT }).links, [
    { from: "app", to: "components" },
    { from: "app", to: "lib" },
    { from: "components", to: "lib" },
    { from: "components", to: "packages/ui/src" },
    { from: "lib", to: "packages/ui/src" },
  ], "@/ and the exact @ui alias resolve from the top tsconfig's baseUrl, @acme/ui to its main; packages/ui's own tsconfig, with no paths, leaves its @/ import unresolved; clsx is outside");
});

test("8.63 capabilities whose imports run round a loop are drawn as one covering all their folders and files, and the drawing is the same whatever order its files come in", async () => {
  await readersReady([...TINY, ...BACKEND].map((file) => file.path));
  const backend = drawImportedStory({ folder: "backend", files: BACKEND });
  assert.deepEqual(backend.capabilities.find(({ title }) => title.includes("+")), { title: "app/core + app/crud.py", covers: ["backend/app/core", "backend/app/crud.py"] },
    "core/db imports crud and crud imports core/security: a loop across a folder and a module");
  assert.deepEqual(drawImportedStory({ folder: ".", files: TINY }).capabilities[1], { title: "tinydb/__init__.py + tinydb/database.py", covers: ["tinydb/__init__.py", "tinydb/database.py"] });

  const shuffled = [...BACKEND].reverse();
  shuffled.push(shuffled.splice(3, 1)[0]!);
  assert.deepEqual(drawImportedStory({ folder: "backend", files: shuffled }), backend, "another order of the same files draws the same");
});
