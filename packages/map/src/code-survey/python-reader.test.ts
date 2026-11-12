/**
 * Capability 8 · Code survey: a built Python story, packages/<story>/pyproject.toml with src/<module>/, surveyed
 * through the Python reader: its imports resolved through tree-sitter, its files' declarations, and its roads.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { AnnotatedTree } from "@storytree/library";

import { readersReady } from "./code-survey.js";
import { drawImportedStory } from "./drawing.js";
import { pythonReader } from "./python-reader.js";
import { capabilitiesOfFiles, codeSurveyReader, storyTests } from "./read-survey.js";

async function write(folder: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), text);
  }
}

const story = (id: string, title: string, capabilities: readonly string[] = ["1 · Value"]) =>
  ({ id, title, capabilities: capabilities.map((name, at) => ({ id: `${id}-cap-${at + 1}`, title: name })) });

// First in its file, so the grammar has not loaded when it runs: reading an imported story's tests loads it itself.
test("8.44, 8.50 reading an imported Python story's tests loads the Python reader's grammar before it surveys their imports", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-mapped-tests-"));
  try {
    await write(folder, {
      "src/shop/total.py": "def total(lines):\n    return sum(lines)\n",
      "tests/test_total.py": "from shop.total import total\n\n\ndef test_1_1_totals():\n    assert total([1]) == 1\n",
    });
    const shop = { ...story("story-shop", "Shop"), mapped: { from: folder, package: ".", folders: ["."] } };
    const plan = { arcs: [], stories: [shop] } as unknown as AnnotatedTree;
    assert.deepEqual(await storyTests(folder, plan, "story-shop-cap-1"), { numbers: ["1.1"], seen: true });
  } finally {
    await removeTemp(folder);
  }
});

test("8.50 a built Python story's imports are edges in its survey: import a.b, from a import y (a submodule, else the package), a wildcard, relative levels, nested imports and namespace packages, searched from its src/ then its root; an imported island's from src/ then the top", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-survey-"));
  try {
    await write(folder, {
      "packages/cart/pyproject.toml": "[project]\nname = \"cart\"\n",
      "packages/cart/src/cart/__init__.py": "from .total import total\n",
      "packages/cart/src/cart/total.py": "import os\nimport cart.tax.rates\nfrom cart import money\nfrom . import discounts\n\n\ndef total(lines):\n    return sum(lines)\n",
      "packages/cart/src/cart/money.py": "def cents(x):\n    return x\n",
      // A namespace package: no __init__.py.
      "packages/cart/src/cart/tax/rates.py": "RATE = 1\n",
      "packages/cart/src/cart/discounts/__init__.py": "from .seasonal import season as s\n",
      "packages/cart/src/cart/discounts/seasonal.py": "from ..money import cents\n\nseason = cents\n",
      "packages/cart/src/cart/lazy.py": "def later():\n    import cart.money as m\n    return m\n",
      "packages/cart/src/cart/wild.py": "from cart.discounts import *\nfrom cart.tax import rates, missing\n",
      "packages/cart/tests/test_total.py": "from cart.total import total\n\n\ndef test_total():\n    assert total([1]) == 1\n",
    });
    const plan = { arcs: [], stories: [story("story-cart", "Cart")] } as unknown as AnnotatedTree;
    const survey = (await codeSurveyReader().read(folder, plan))["story-cart"]!;
    const edges = (imports: readonly { from: string; to: string }[]) => imports.map(({ from, to }) => `${from} -> ${to}`).sort();
    assert.deepEqual(edges(survey.imports), [
      "src/cart/__init__.py -> src/cart/total.py",
      "src/cart/discounts/__init__.py -> src/cart/discounts/seasonal.py",
      "src/cart/discounts/seasonal.py -> src/cart/money.py",
      "src/cart/lazy.py -> src/cart/money.py",
      "src/cart/total.py -> src/cart/discounts/__init__.py",
      "src/cart/total.py -> src/cart/money.py",
      "src/cart/total.py -> src/cart/tax/rates.py",
      "src/cart/wild.py -> src/cart/discounts/__init__.py",
      "src/cart/wild.py -> src/cart/tax/rates.py",
    ]);
    assert.deepEqual(edges(survey.tests?.find((one) => one.path === "tests/test_total.py")?.imports ?? []), ["tests/test_total.py -> src/cart/total.py"], "a test outside src reaches the module it imports");

    // An imported island has no package to root its search: src/ first, then the top.
    const paths = new Set(["src/shop/a.py", "src/shop/b.py", "lib/c.py"]);
    await readersReady(paths);
    assert.deepEqual(pythonReader.edgesOf({ path: "src/shop/a.py", text: "import shop.b\nimport lib.c\n" }, paths, []).map((edge) => edge.to), ["src/shop/b.py", "lib/c.py"]);
    assert.deepEqual(pythonReader.edgesOf({ path: "lib/c.py", text: "from ... import shop\nfrom .... import b\n" }, new Set([...paths, "shop.py", "b.py"]), []), [], "a relative import that climbs above the top reaches nothing, not even the top's own modules");
  } finally {
    await removeTemp(folder);
  }
});

test("8.51 a Python source file's opening \"# Capability N · title\", after an optional shebang, declares its capability when the title is its number's, and nothing when the title is another's", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-declares-"));
  try {
    await write(folder, {
      "packages/cart/pyproject.toml": "[project]\nname = \"cart\"\n",
      "packages/cart/src/cart/total.py": "#!/usr/bin/env python\n# Capability 2 · Totals: what a cart adds up to.\ndef total(lines):\n    return sum(lines)\n",
      "packages/cart/src/cart/moved.py": "# Capability 2 · Shipping, moved here from another story.\nx = 1\n",
    });
    const plan = { arcs: [], stories: [story("story-cart", "Cart", ["1 · Lines", "2 · Totals"])] } as unknown as AnnotatedTree;
    const owners = await capabilitiesOfFiles(folder, ["packages/cart/src/cart/total.py", "packages/cart/src/cart/moved.py"], plan, { survey: async () => ({}) });
    assert.deepEqual([...owners], [["packages/cart/src/cart/total.py", { capability: "story-cart-cap-2", inferred: false }]]);
    const survey = (await codeSurveyReader().read(folder, plan))["story-cart"]!;
    assert.deepEqual(survey.files.find((file) => file.path === "src/cart/total.py")?.declared, 2);
  } finally {
    await removeTemp(folder);
  }
});

test("8.52 a built Python story's pyproject.toml makes roads to the stories whose projects it names, by [project].dependencies or a [tool.uv.sources] workspace source, names compared normalised", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-roads-"));
  try {
    await write(folder, {
      "packages/cart/pyproject.toml": "[project]\nname = \"shop.cart\"\ndependencies = [\"requests>=2\"]\n",
      "packages/cart/src/cart/__init__.py": "x = 1\n",
      "packages/checkout/pyproject.toml": "[project]\nname = \"checkout\"\ndependencies = [\"Shop_Cart >= 1.0 ; python_version > '3.10'\", \"requests\"]\n",
      "packages/checkout/src/checkout/__init__.py": "x = 1\n",
      "packages/pricing/pyproject.toml": "[project]\nname = \"pricing\"\n\n[tool.uv.sources]\nShop-Cart = { workspace = true }\nrequests = { git = \"https://example.com/requests\" }\n",
      "packages/pricing/src/pricing/__init__.py": "x = 1\n",
      "packages/broken/pyproject.toml": "[project\nname = \"shop.cart\"\n",
      "packages/broken/src/broken/__init__.py": "x = 1\n",
      "packages/nameless/pyproject.toml": "[project]\ndependencies = [\"shop-cart\"]\n",
      "packages/nameless/src/nameless/__init__.py": "x = 1\n",
    });
    const plan = { arcs: [], stories: [story("story-cart", "Cart"), story("story-checkout", "Checkout"), story("story-pricing", "Pricing"), story("story-broken", "Broken"), story("story-nameless", "Nameless")] } as unknown as AnnotatedTree;
    const survey = await codeSurveyReader().read(folder, plan);
    assert.deepEqual(survey["story-checkout"]?.dependsOn, ["story-cart"]);
    assert.deepEqual(survey["story-pricing"]?.dependsOn, ["story-cart"]);
    assert.deepEqual(survey["story-cart"]?.dependsOn, []);
    for (const id of ["story-broken", "story-nameless"]) {
      assert.equal(survey[id]?.files.length, 1, `${id} is still surveyed`);
      assert.equal(survey[id]?.dependsOn, undefined, `${id}'s pyproject.toml, no TOML or naming no project, is no package`);
    }
  } finally {
    await removeTemp(folder);
  }
});

/** A built Cart story whose pytest tests carry numbers by their names, their docstrings and inside a Test* class. */
const numberedCart: Readonly<Record<string, string>> = {
  "packages/cart/pyproject.toml": "[project]\nname = \"cart\"\n",
  "packages/cart/src/cart/__init__.py": "",
  "packages/cart/src/cart/lines.py": "def lines(items):\n    return list(items)\n",
  "packages/cart/src/cart/total.py": "def total(lines):\n    return sum(lines)\n",
  "packages/cart/tests/test_lines.py": [
    "from cart.lines import lines",
    "",
    "",
    "def test_keeps_order():",
    "    \"\"\"1.1 · lines keep their order",
    "",
    "    More words after the first line.",
    "    \"\"\"",
    "    assert lines([2, 1]) == [2, 1]",
    "",
  ].join("\n"),
  "packages/cart/tests/test_total.py": [
    "import pytest",
    "",
    "from cart.total import total",
    "",
    "",
    "def test_2_1_totals_lines():",
    "    def test_9_9_nested_helper():",
    "        pass",
    "    assert total([1]) == 1",
    "",
    "",
    "class TestTotals:",
    "    def test_cart_2_2_empty_is_zero(self):",
    "        assert total([]) == 0",
    "",
    "    @pytest.mark.slow",
    "    async def test_2_3_slow(self):",
    "        assert total([2]) == 2",
    "",
    "    class TestNested:",
    "        def test_2_4_nested_class(self):",
    "            pass",
    "",
    "",
    "class Helper:",
    "    def test_2_9_not_collected(self):",
    "        pass",
    "",
    "",
    "def test_shop_2_5_another_storys():",
    "    pass",
    "",
    "",
    "def helper_2_6():",
    "    pass",
    "",
  ].join("\n"),
};

test("8.54 a built Python story's pytest tests, module functions and methods of a Test* class, carry the number their name (test_2_3_…, perhaps after the package) or their docstring starts with, and pin the files they reach to that capability", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-test-join-"));
  try {
    await write(folder, numberedCart);
    const plan = { arcs: [], stories: [story("story-cart", "Cart", ["1 · Lines", "2 · Totals"])] } as unknown as AnnotatedTree;
    const survey = (await codeSurveyReader().read(folder, plan))["story-cart"]!;
    const titles = (file: string) => survey.tests?.find((one) => one.path === file)?.titles.map(({ number, title, package: named }) => `${named ?? ""}|${number}|${title}`);
    assert.deepEqual(titles("tests/test_total.py"), [
      "|2.1|2.1 · totals lines",
      "cart|2.2|cart 2.2 · empty is zero",
      "|2.3|2.3 · slow",
      "|2.4|2.4 · nested class",
      "shop|2.5|shop 2.5 · another storys",
    ], "module tests and Test* methods carry their names' numbers; a nested function, another class's method and a non-test do not");
    assert.deepEqual(titles("tests/test_lines.py"), ["|1.1|1.1 · lines keep their order"], "a docstring's first line is the title");
    const owner = (file: string) => survey.files.find((one) => one.path === file)?.capability;
    assert.equal(owner("src/cart/total.py"), "story-cart-cap-2");
    assert.equal(owner("src/cart/lines.py"), "story-cart-cap-1");
    const owners = await capabilitiesOfFiles(folder, ["packages/cart/tests/test_lines.py"], plan, { survey: async () => ({}) });
    assert.deepEqual([...owners], [["packages/cart/tests/test_lines.py", { capability: "story-cart-cap-1", inferred: false }]], "a test file whose tests carry one number declares that capability");
  } finally {
    await removeTemp(folder);
  }
});

test("8.3 a Python story's helper modules under its tests folder are test support: never counted as source nor drawn, yet a test reaches its capability through them", async () => {
  const files = {
    "packages/cart/pyproject.toml": "[project]\nname = \"cart\"\n",
    "packages/cart/src/cart/__init__.py": "",
    "packages/cart/src/cart/total.py": "def total(lines):\n    return sum(lines)\n",
    "packages/cart/tests/__init__.py": "",
    "packages/cart/tests/utils/__init__.py": "",
    "packages/cart/tests/utils/helpers.py": "from cart.total import total\n\n\ndef totalled():\n    return total([1, 2])\n",
    "packages/cart/tests/test_total.py": "from tests.utils.helpers import totalled\n\n\ndef test_1_1_totals():\n    assert totalled() == 3\n",
  };
  const folder = await mkdtemp(path.join(tmpdir(), "python-test-helpers-"));
  try {
    await write(folder, files);
    const plan = { arcs: [], stories: [story("story-cart", "Cart", ["1 · Totals"])] } as unknown as AnnotatedTree;
    const survey = (await codeSurveyReader().read(folder, plan))["story-cart"]!;
    assert.deepEqual(survey.files.map(({ path: file }) => file).sort(), ["src/cart/__init__.py", "src/cart/total.py"], "the helper under tests/ counts no lines");
    assert.equal(survey.files.find((file) => file.path === "src/cart/total.py")?.capability, "story-cart-cap-1", "the test reaches total.py through its helper");
    const drawn = drawImportedStory({ folder: "packages/cart", files: Object.entries(files).map(([file, text]) => ({ path: file, text })) });
    assert.deepEqual(drawn.capabilities.map(({ title }) => title), ["src/cart/total.py"], "no tests/utils capability");
  } finally {
    await removeTemp(folder);
  }
});

test("8.55 a built Python story's numbered pytest test, read by both the survey and the checkout-wide pytest read, is counted once in its story's tested numbers", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-counted-once-"));
  try {
    await write(folder, numberedCart);
    const plan = { arcs: [], stories: [story("story-cart", "Cart", ["1 · Lines", "2 · Totals"])] } as unknown as AnnotatedTree;
    const { numbers, seen } = await storyTests(folder, plan, "story-cart-cap-1");
    assert.equal(seen, true);
    assert.deepEqual([...numbers].sort(), ["1.1", "2.1", "2.2", "2.3", "2.4"], "each once, read as the survey reads them: another class's method carries none");
  } finally {
    await removeTemp(folder);
  }
});

test("8.57 a built Python story's source file importing a file another of its capabilities holds is an edge from its capability to that one's; an import of its own capability's file, of a module outside the story, or from a test makes none", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "python-inner-edges-"));
  try {
    await write(folder, {
      "packages/interview/pyproject.toml": "[project]\nname = \"interview\"\n",
      "packages/interview/src/interview/__init__.py": "",
      "packages/interview/src/interview/main.py": "import os\nfrom fastapi import FastAPI\nfrom interview.retrieve import search\nfrom .packet import compile_packet\nfrom .auth import caller\n\napp = FastAPI()\n",
      "packages/interview/src/interview/auth.py": "def caller():\n    return 1\n",
      "packages/interview/src/interview/retrieve.py": "def search(q):\n    return [q]\n",
      "packages/interview/src/interview/packet.py": "from interview import retrieve\n\n\ndef compile_packet(q):\n    return retrieve.search(q)\n",
      "packages/interview/tests/test_api.py": "from interview.main import app\nfrom interview.auth import caller\n\n\ndef test_1_1_serves():\n    assert app and caller\n",
      "packages/interview/tests/test_retrieve.py": "from interview.retrieve import search\n\n\ndef test_2_1_searches():\n    assert search(1)\n",
      "packages/interview/tests/test_packet.py": "from interview.packet import compile_packet\n\n\ndef test_3_1_compiles():\n    assert compile_packet(1)\n",
    });
    const plan = { arcs: [], stories: [story("story-interview", "Interview", ["1 · API", "2 · Retrieval", "3 · Packet"])] } as unknown as AnnotatedTree;
    const survey = (await codeSurveyReader().read(folder, plan))["story-interview"]!;
    assert.deepEqual((survey.edges ?? []).map((edge) => `${edge.from} > ${edge.story}:${edge.to} ${edge.typeOnly ? "types" : "value"}`).sort(), [
      "story-interview-cap-1 > story-interview:story-interview-cap-2 value",
      "story-interview-cap-1 > story-interview:story-interview-cap-3 value",
      "story-interview-cap-3 > story-interview:story-interview-cap-2 value",
    ], "main.py's import of auth.py, its own capability's, makes none; os and fastapi none; the tests none");
    assert.deepEqual(survey.edges?.find((edge) => edge.from === "story-interview-cap-3")?.files, [{ from: "src/interview/packet.py", to: "src/interview/retrieve.py", typeOnly: false }]);
  } finally {
    await removeTemp(folder);
  }
});

test("8.64 the Python reader reports the names a from-import takes, and which of a module's names it binds by its own import, so a name a package's __init__.py passes on can be followed to the file that binds it", async () => {
  const paths = new Set(["tinydb/__init__.py", "tinydb/storages.py", "tinydb/utils.py", "tinydb/operations.py", "tinydb/middlewares.py"]);
  await readersReady(paths);
  const root = {
    path: "tinydb/__init__.py",
    text: [
      "from typing import Any",
      "from .storages import JSONStorage, Storage as Base",
      "from . import utils",
      "from .operations import *",
      "try:",
      "    from .middlewares import Cached",
      "except ImportError:",
      "    Cached = None",
      "VERSION = 1",
      "def later():",
      "    from .utils import freeze",
      "@decorated",
      "class Query:",
      "    from .utils import inner",
      "",
    ].join("\n"),
  };
  const offers = pythonReader.offersOf!(root, paths, []);
  assert.deepEqual([...offers.from], [
    ["JSONStorage", { to: "tinydb/storages.py", name: "JSONStorage" }],
    ["Base", { to: "tinydb/storages.py", name: "Storage" }],
    ["utils", { to: "tinydb/utils.py" }],
    ["Cached", { to: "tinydb/middlewares.py", name: "Cached" }],
  ], "each name its own imports bind, by the file it comes from and its name there; a submodule taken whole has none; typing is outside the story");
  assert.deepEqual(offers.star, ["tinydb/operations.py"]);
  assert.deepEqual([...offers.local].sort(), ["Cached", "Query", "VERSION", "later"], "a function's or class's own imports bind none of the module's names");

  assert.deepEqual(pythonReader.offersOf!({ path: "tinydb/middlewares.py", text: "from .storages import Storage\nfrom .operations import *\nclass Middleware: pass\n" }, paths, []),
    { local: new Set(["Middleware"]), from: new Map(), star: [] }, "a module that is no package's __init__.py keeps its imports to itself");

  assert.deepEqual(pythonReader.edgesOf({ path: "tinydb/middlewares.py", text: "import tinydb.utils\nfrom tinydb import JSONStorage, utils, Storage as S\nfrom .operations import *\n" }, paths, []), [
    { to: "tinydb/utils.py", reexport: false, typeOnly: false, names: "all" },
    { to: "tinydb/__init__.py", reexport: false, typeOnly: false, names: [["JSONStorage", "JSONStorage"], ["Storage", "S"]] },
    { to: "tinydb/operations.py", reexport: false, typeOnly: false, names: "all" },
  ], "a from-import of names that are no submodule takes them by name; a submodule, an import and a wildcard take the whole file");
});
