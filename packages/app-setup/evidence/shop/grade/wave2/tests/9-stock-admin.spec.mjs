// Part 9, Stock and an admin (shop-requirements-2.md). The Fleece Jacket (id 5) is the one these tests change.
import { test, expect } from "@playwright/test";
import { newCustomer, buy, signIn, adminSet } from "./helpers.mjs";

const JACKET = "Sauce Labs Fleece Jacket", JACKET_ID = 5;

test("9.1 only the admin sees Admin; anyone else is sent to Products", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.click(".bm-burger-button");
  await expect(page.locator("#admin_sidebar_link")).toHaveCount(0);
  await page.goto("/admin.html");
  await expect(page).toHaveURL(/\/inventory\.html/);
  await signIn(page, "admin_user");
  await page.click(".bm-burger-button");
  await page.click("#admin_sidebar_link");
  await expect(page).toHaveURL(/\/admin\.html/);
  await expect(page.locator('[data-test="admin-row"]')).toHaveCount(6);
});

test("9.2 stock reads In stock, Only n left, Sold out", async ({ page }) => {
  await adminSet(page, JACKET, { stock: 6 });
  await page.goto(`/inventory-item.html?id=${JACKET_ID}`);
  await expect(page.locator('[data-test="stock"]')).toHaveText("In stock");
  await adminSet(page, JACKET, { stock: 5 });
  await page.goto("/inventory.html");
  await expect(page.locator(".inventory_item", { hasText: JACKET }).locator('[data-test="stock"]')).toHaveText("Only 5 left");
  await adminSet(page, JACKET, { stock: 0 });
  await page.goto(`/inventory-item.html?id=${JACKET_ID}`);
  await expect(page.locator('[data-test="stock"]')).toHaveText("Sold out");
  await expect(page.locator(".btn_inventory")).toBeDisabled();
});

test("9.3 buying takes one off stock", async ({ page }) => {
  await adminSet(page, JACKET, { stock: 3 });
  await newCustomer(page, "stock");
  await buy(page, [JACKET]);
  await page.goto(`/inventory-item.html?id=${JACKET_ID}`);
  await expect(page.locator('[data-test="stock"]')).toHaveText("Only 2 left");
});

test("9.4 Finish refuses a product that sold out meanwhile, and keeps the cart", async ({ page }) => {
  await adminSet(page, JACKET, { stock: 1 });
  await newCustomer(page, "late");
  await page.goto("/inventory.html");
  await page.locator(".inventory_item", { hasText: JACKET }).locator(".btn_primary.btn_inventory").click();
  const cart = await page.evaluate(() => localStorage.getItem("cart-contents"));
  const username = (await page.context().cookies()).find((c) => c.name === "session-username")?.value;
  await adminSet(page, JACKET, { stock: 0 });
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "session-username", value: username, url: page.url() }]);
  await page.evaluate((c) => localStorage.setItem("cart-contents", c), cart);
  await page.goto("/checkout-step-one.html");
  await page.fill('[data-test="firstName"]', "Ada");
  await page.fill('[data-test="lastName"]', "Lovelace");
  await page.fill('[data-test="postalCode"]', "2000");
  await page.click(".cart_button");
  await page.click(".cart_button");
  await expect(page.locator('[data-test="error"]')).toContainText(`Error: ${JACKET} is sold out`);
  await expect(page.locator(".shopping_cart_link")).toHaveText("1");
});

test("9.5 a new price shows at once, and old orders keep theirs", async ({ page }) => {
  await adminSet(page, JACKET, { price: 49.99, stock: 10 });
  const { username } = await newCustomer(page, "price");
  const old = await buy(page, [JACKET]);
  await adminSet(page, JACKET, { price: 39.99 });
  await page.goto("/inventory.html");
  await expect(page.locator(".inventory_item", { hasText: JACKET }).locator(".inventory_item_price")).toHaveText("$39.99");
  await signIn(page, username, "longpassword1");
  await page.goto(`/order.html?id=${old}`);
  await expect(page.locator('[data-test="order-total"]')).toHaveText("Total: $53.99");
});

test("9.6 the admin's price is used at checkout", async ({ page }) => {
  await adminSet(page, JACKET, { price: 20, stock: 10 });
  await newCustomer(page, "checkout");
  const number = await buy(page, [JACKET]);
  await page.goto(`/order.html?id=${number}`);
  await expect(page.locator('[data-test="order-total"]')).toHaveText("Total: $21.60");
  await adminSet(page, JACKET, { price: 49.99, stock: 10 });
});
