/**
 * Capability 8 · Code survey: a Python project's pytest tests carry contract numbers the landing check credits
 * (ADR-1189). Written against small checkouts in temporary folders.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { AnnotatedTree } from "@storytree/library";

import { testedNumbers, untestedContracts } from "./read-survey.js";

const contracts = (...titles: string[]) => titles.map((title) => ({ title }));

async function files(folder: string, texts: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(texts)) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), text);
  }
}

test("8.36 a pytest test named test_<n>_<m>_… or whose docstring starts <n>.<m> carries that number, anywhere in the checkout but Git's ignored files", async () => {
  const plan = { arcs: [], stories: [{ id: "story-orders", title: "Orders", capabilities: [{ id: "cap-intake", title: "2 · Intake", contracts: contracts("2.1 · named", "2.2 · docstring", "2.3 · suffix file", "2.4 · ignored", "2.5 · none") }] }] } as unknown as AnnotatedTree;
  const checkout = await mkdtemp(path.join(tmpdir(), "pytest-checkout-"));
  const plain = await mkdtemp(path.join(tmpdir(), "pytest-plain-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: checkout });
    await files(checkout, {
      ".gitignore": ".venv/\n",
      "tests/test_intake.py": "def test_2_1_accepts_an_order():\n    assert True\n\n\nclass TestDocs:\n    def test_reads_its_docstring(self):\n        \"\"\"2.2 reads its docstring.\"\"\"\n        assert True\n",
      "src/app/intake_test.py": "async def test_2_3_in_a_suffixed_file():\n    assert True\n",
      ".venv/lib/test_vendored.py": "def test_2_4_vendored():\n    pass\n",
    });
    // Run from a folder inside the checkout: the whole checkout is read, untracked files included.
    const tested = await testedNumbers(path.join(checkout, "src"), plan, "cap-intake");
    assert.deepEqual([...tested].sort(), ["2.1", "2.2", "2.3"]);
    assert.deepEqual(untestedContracts(plan, "cap-intake", tested), ["2.4 · ignored", "2.5 · none"]);

    // A folder that is no checkout is walked, past virtualenv and hidden folders.
    await files(plain, { "test_intake.py": "def test_2_1_x():\n    pass\n", "venv/test_v.py": "def test_2_4_x():\n    pass\n", ".tox/test_t.py": "def test_2_5_x():\n    pass\n" });
    assert.deepEqual(await testedNumbers(plain, plan, "cap-intake"), ["2.1"]);
  } finally {
    await removeTemp(checkout);
    await removeTemp(plain);
  }
});

test("8.37 a pytest number prefixed with a story's package counts for that story only, and an unprefixed one only while no other story plans its number", async () => {
  const plan = { arcs: [], stories: [
    { id: "story-orders", title: "Order intake", capabilities: [{ id: "cap-orders", title: "1 · Orders", contracts: contracts("1.1 · shared", "1.2 · prefixed", "1.3 · unique") }] },
    { id: "story-billing", title: "Billing", capabilities: [{ id: "cap-billing", title: "1 · Bills", contracts: contracts("1.1 · shared", "1.2 · prefixed") }] },
  ] } as unknown as AnnotatedTree;
  const folder = await mkdtemp(path.join(tmpdir(), "pytest-collide-"));
  try {
    await files(folder, {
      "tests/test_all.py": [
        "def test_1_1_ambiguous():\n    pass\n",
        "def test_order_intake_1_2_named_by_package():\n    pass\n",
        "def test_1_3_only_orders_plans_it():\n    pass\n",
        "def test_bills():\n    \"\"\"billing 1.1 named by package in its docstring\"\"\"\n",
        "def test_unknown_9_9_package_named_nowhere():\n    pass\n",
      ].join("\n"),
    });
    assert.deepEqual([...(await testedNumbers(folder, plan, "cap-orders"))].sort(), ["1.2", "1.3"]);
    assert.deepEqual(await testedNumbers(folder, plan, "cap-billing"), ["1.1"]);
  } finally {
    await removeTemp(folder);
  }
});
