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

// First in its file, so the grammar has not loaded when it runs: reading a mapped story's tests loads it itself.
test("8.44, 8.50 reading a mapped Python story's tests loads the Python reader's grammar before it surveys their imports", async () => {
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

test("8.50 a built Python story's imports are edges in its survey: import a.b, from a import y (a submodule, else the package), a wildcard, relative levels, nested imports and namespace packages, searched from its src/ then its root; a mapped island's from src/ then the top", async () => {
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

    // A mapped island has no package to root its search: src/ first, then the top.
    const paths = new Set(["src/shop/a.py", "src/shop/b.py", "lib/c.py"]);
    await readersReady(paths);
    assert.deepEqual(pythonReader.edgesOf({ path: "src/shop/a.py", text: "import shop.b\nimport lib.c\n" }, paths, []).map((edge) => edge.to), ["src/shop/b.py", "lib/c.py"]);
    assert.deepEqual(pythonReader.edgesOf({ path: "lib/c.py", text: "from ... import shop\nfrom .... import b\n" }, paths, []), [], "a relative import that climbs above the top reaches nothing");
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
