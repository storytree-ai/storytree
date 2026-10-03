// Part 5, Accounts (shop-requirements-2.md).
import { test, expect } from "@playwright/test";
import { fresh, signIn, signUp, newCustomer } from "./helpers.mjs";

test("5.1 the sign-in page links to a sign-up form", async ({ page }) => {
  await page.goto("/");
  await page.click('[data-test="signup-link"]');
  await expect(page).toHaveURL(/\/signup\.html/);
  for (const field of ["signup-name", "signup-username", "signup-password", "signup-submit"]) await expect(page.locator(`[data-test="${field}"]`)).toBeVisible();
});

test("5.2 signing up signs the new user in, on Products, greeted by name", async ({ page }) => {
  const { name } = await newCustomer(page, "newbie");
  await expect(page).toHaveURL(/\/inventory\.html/);
  await expect(page.locator('[data-test="greeting"]')).toHaveText(`Hi, ${name}`);
});

test("5.3 a new user can sign out and sign in again", async ({ page }) => {
  const username = fresh("again");
  await signUp(page, { name: "Again Person", username, password: "longpassword1" });
  await expect(page.locator(".inventory_list")).toBeVisible();
  await page.click(".bm-burger-button");
  await page.click("#logout_sidebar_link");
  await expect(page.locator("#login_button_container")).toBeVisible();
  await signIn(page, username, "longpassword1");
  await expect(page.locator('[data-test="greeting"]')).toHaveText("Hi, Again Person");
});

test("5.4 sign-up errors, in order", async ({ page }) => {
  await signUp(page, { name: "", username: "", password: "" });
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Name is required");
  await signUp(page, { name: "Someone", username: "", password: "" });
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Username is required");
  await signUp(page, { name: "Someone", username: fresh("short"), password: "short" });
  await expect(page.locator('[data-test="error"]')).toContainText("Error: Password must be at least 8 characters");
  await signUp(page, { name: "Someone", username: "standard_user", password: "longpassword1" });
  await expect(page.locator('[data-test="error"]')).toContainText("Error: That username is taken");
});

test("5.5 a username can be taken only once", async ({ page }) => {
  const username = fresh("taken");
  await signUp(page, { name: "First", username });
  await expect(page.locator(".inventory_list")).toBeVisible();
  await signUp(page, { name: "Second", username });
  await expect(page.locator('[data-test="error"]')).toContainText("Error: That username is taken");
});

test("5.6 a Swag Labs user is greeted by username", async ({ page }) => {
  await signIn(page, "standard_user");
  await expect(page.locator('[data-test="greeting"]')).toHaveText("Hi, standard_user");
});

test("5.7 /api/me answers the signed-in user, or 401", async ({ page, request }) => {
  const anonymous = await request.get("/api/me");
  expect(anonymous.status()).toBe(401);
  const { username, name } = await newCustomer(page, "api");
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ username, name });
});
