// Part 7, Search (shop-requirements-2.md).
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

test("7.1 typing filters Products by name, ignoring case", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.fill('[data-test="search"]', "BACKPACK");
  await expect(page.locator(".inventory_item")).toHaveCount(1);
  await expect(page.locator(".inventory_item .inventory_item_name")).toHaveText("Sauce Labs Backpack");
});

test("7.2 search matches descriptions too", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.fill('[data-test="search"]', "quarter-zip");
  await expect(page.locator(".inventory_item .inventory_item_name")).toHaveText(["Sauce Labs Fleece Jacket"]);
});

test("7.3 the search is in the address and survives a reload", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.fill('[data-test="search"]', "t-shirt");
  await expect(page).toHaveURL(/[?&]q=t-shirt/i);
  await page.reload();
  await expect(page.locator('[data-test="search"]')).toHaveValue(/t-shirt/i);
  await expect(page.locator(".inventory_item")).toHaveCount(2);
  await page.goto("/inventory.html?q=onesie");
  await expect(page.locator(".inventory_item .inventory_item_name")).toHaveText(["Sauce Labs Onesie"]);
});

test("7.4 no match says so and lists nothing", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.fill('[data-test="search"]', "zebra");
  await expect(page.locator(".inventory_item")).toHaveCount(0);
  await expect(page.locator('[data-test="no-results"]')).toHaveText("No products match “zebra”.");
});

test("7.5 sorting works on the filtered list", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.fill('[data-test="search"]', "sauce labs b");
  await page.selectOption(".product_sort_container", "hilo");
  const names = await page.locator(".inventory_item .inventory_item_name").allInnerTexts();
  expect(names).toEqual(["Sauce Labs Backpack", "Sauce Labs Bolt T-Shirt", "Sauce Labs Bike Light"]);
});
