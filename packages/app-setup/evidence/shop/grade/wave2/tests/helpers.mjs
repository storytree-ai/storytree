// Shared steps, each through the shop's own pages as a user would, per shop-requirements.md and -2.md.
import { expect } from "@playwright/test";

let counter = 0;
/** A username no earlier test or run has used. */
export const fresh = (stem = "buyer") => `${stem}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function signIn(page, username, password = "secret_sauce") {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#user-name", username);
  await page.fill("#password", password);
  await page.click(".btn_action");
  await expect(page.locator(".inventory_list")).toBeVisible();
}

export async function signUp(page, { name, username, password = "longpassword1" }) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.click('[data-test="signup-link"]');
  await expect(page).toHaveURL(/\/signup\.html/);
  if (name !== undefined) await page.fill('[data-test="signup-name"]', name);
  if (username !== undefined) await page.fill('[data-test="signup-username"]', username);
  if (password !== undefined) await page.fill('[data-test="signup-password"]', password);
  await page.click('[data-test="signup-submit"]');
}

/** A new account, signed in, on Products. */
export async function newCustomer(page, stem) {
  const username = fresh(stem);
  const name = `Test ${username}`;
  await signUp(page, { name, username });
  await expect(page.locator(".inventory_list")).toBeVisible();
  return { username, name };
}

/** Adds the named products from Products and completes checkout; returns the order number shown. */
export async function buy(page, names) {
  await page.goto("/inventory.html");
  for (const name of names) {
    const item = page.locator(".inventory_item", { hasText: name });
    await item.locator(".btn_primary.btn_inventory").click();
  }
  await page.click(".shopping_cart_link");
  await page.click(".checkout_button");
  await page.fill('[data-test="firstName"]', "Ada");
  await page.fill('[data-test="lastName"]', "Lovelace");
  await page.fill('[data-test="postalCode"]', "2000");
  await page.click(".cart_button");
  await expect(page.locator("#checkout_summary_container")).toBeVisible();
  await page.click(".cart_button");
  await expect(page.locator("#checkout_complete_container")).toBeVisible();
  const text = await page.locator('[data-test="order-number"]').innerText();
  const match = /Order #(\d+)/.exec(text);
  expect(match, `order number text: ${text}`).not.toBeNull();
  return Number(match[1]);
}

/** Signs in as the admin and sets one product's price and stock. */
export async function adminSet(page, productName, { price, stock }) {
  await signIn(page, "admin_user");
  await page.goto("/admin.html");
  const row = page.locator('[data-test="admin-row"]', { hasText: productName });
  if (price !== undefined) await row.locator('[data-test="admin-price"]').fill(String(price));
  if (stock !== undefined) await row.locator('[data-test="admin-stock"]').fill(String(stock));
  await row.locator('[data-test="admin-save"]').click();
  await expect(page.locator('[data-test="admin-saved"]').first()).toHaveText("Saved");
}
