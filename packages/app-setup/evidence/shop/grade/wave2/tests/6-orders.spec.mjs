// Part 6, Orders (shop-requirements-2.md).
import { test, expect } from "@playwright/test";
import { newCustomer, buy } from "./helpers.mjs";

test("6.1 Finish saves an order and shows its number, counting up across the shop", async ({ page }) => {
  await newCustomer(page, "orders");
  const first = await buy(page, ["Sauce Labs Backpack"]);
  expect(first).toBeGreaterThanOrEqual(1001);
  await newCustomer(page, "orders");
  const second = await buy(page, ["Sauce Labs Onesie"]);
  expect(second).toBe(first + 1);
});

test("6.2 My Orders lists this user's orders, newest first", async ({ page }) => {
  await newCustomer(page, "history");
  const older = await buy(page, ["Sauce Labs Bike Light"]);
  const newer = await buy(page, ["Sauce Labs Backpack", "Sauce Labs Onesie"]);
  await page.click(".bm-burger-button");
  await page.click("#orders_sidebar_link");
  await expect(page).toHaveURL(/\/orders\.html/);
  const rows = page.locator('[data-test="order-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(String(newer));
  await expect(rows.nth(1)).toContainText(String(older));
});

test("6.3 an order's page shows its products and total", async ({ page }) => {
  await newCustomer(page, "detail");
  const number = await buy(page, ["Sauce Labs Backpack"]);
  await page.goto(`/order.html?id=${number}`);
  await expect(page.locator(".cart_item")).toHaveCount(1);
  await expect(page.locator(".cart_item .inventory_item_name")).toHaveText("Sauce Labs Backpack");
  await expect(page.locator('[data-test="order-total"]')).toHaveText("Total: $32.39");
});

test("6.4 another user's order is not found", async ({ page }) => {
  await newCustomer(page, "owner");
  const number = await buy(page, ["Sauce Labs Onesie"]);
  await newCustomer(page, "snoop");
  await page.goto(`/order.html?id=${number}`);
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Order not found");
  await page.goto("/order.html?id=999999");
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Order not found");
});

test("6.5 a user with no orders is told so", async ({ page }) => {
  await newCustomer(page, "empty");
  await page.goto("/orders.html");
  await expect(page.locator('[data-test="no-orders"]')).toHaveText("You haven't ordered anything yet.");
  await expect(page.locator('[data-test="order-row"]')).toHaveCount(0);
});

test("6.6 orders survive a reload and a new browser", async ({ page, browser }) => {
  const { username } = await newCustomer(page, "keeps");
  const number = await buy(page, ["Sauce Labs Bike Light"]);
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto("/");
  await fresh.fill("#user-name", username);
  await fresh.fill("#password", "longpassword1");
  await fresh.click(".btn_action");
  await fresh.goto("/orders.html");
  await expect(fresh.locator('[data-test="order-row"]').first()).toContainText(String(number));
  await other.close();
});
