// Part 8, Reviews (shop-requirements-2.md). The Bolt T-Shirt (id 1) is reviewed only by these tests.
import { test, expect } from "@playwright/test";
import { newCustomer, buy, signIn } from "./helpers.mjs";

const SHIRT = "Sauce Labs Bolt T-Shirt", SHIRT_ID = 1;

async function review(page, stars, text) {
  await page.goto(`/inventory-item.html?id=${SHIRT_ID}`);
  await page.selectOption('[data-test="review-stars"]', String(stars));
  await page.fill('[data-test="review-text"]', text);
  await page.click('[data-test="review-submit"]');
}

test("8.1 someone who hasn't bought it can't review it", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.goto(`/inventory-item.html?id=${SHIRT_ID}`);
  await expect(page.locator('[data-test="review-locked"]')).toHaveText("Only customers who bought this can review it.");
  await expect(page.locator('[data-test="review-submit"]')).toHaveCount(0);
});

test("8.2 a buyer reviews it once; the review shows with their name and stars", async ({ page }) => {
  const { name } = await newCustomer(page, "reviewer");
  await buy(page, [SHIRT]);
  await review(page, 4, "Soft and the bolt is great.");
  await expect(page.locator('[data-test="review-done"]')).toHaveText("Thanks for your review!");
  const first = page.locator('[data-test="review"]').first();
  await expect(first).toContainText(name);
  await expect(first).toContainText("Soft and the bolt is great.");
  await page.reload();
  await expect(page.locator('[data-test="review-submit"]')).toHaveCount(0);
  await expect(page.locator('[data-test="review-done"]')).toBeVisible();
});

test("8.3 a review needs text", async ({ page }) => {
  await newCustomer(page, "terse");
  await buy(page, [SHIRT]);
  await review(page, 5, "");
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Please write a review");
});

test("8.4 the rating is the average, on the product page and on Products", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.goto(`/inventory-item.html?id=${SHIRT_ID}`);
  const before = await page.locator('[data-test="review"]').count();
  const { name } = await newCustomer(page, "second");
  await buy(page, [SHIRT]);
  await review(page, 5, `Second opinion from ${name}.`);
  const reviews = page.locator('[data-test="review"]');
  await expect(reviews).toHaveCount(before + 1);
  await expect(reviews.first()).toContainText(`Second opinion from ${name}.`);
  const rating = await page.locator('[data-test="rating"]').innerText();
  expect(rating).toMatch(new RegExp(`^\\d\\.\\d \\(${before + 1} reviews?\\)$`));
  await page.goto("/inventory.html");
  await expect(page.locator(".inventory_item", { hasText: SHIRT }).locator('[data-test="rating"]')).toHaveText(rating);
});

test("8.5 an unreviewed product says so", async ({ page }) => {
  await signIn(page, "standard_user");
  await page.goto("/inventory-item.html?id=3");
  await expect(page.locator('[data-test="rating"]')).toHaveText("No reviews yet");
  await page.goto("/inventory.html");
  await expect(page.locator(".inventory_item", { hasText: "Test.allTheThings() T-Shirt (Red)" }).locator('[data-test="rating"]')).toHaveText("No reviews yet");
});
