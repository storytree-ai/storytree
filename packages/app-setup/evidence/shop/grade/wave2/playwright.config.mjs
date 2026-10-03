import { defineConfig } from "@playwright/test";
// One worker: the tests share one shop server and its data, and some (stock, order numbers) depend on order.
export default defineConfig({
  testDir: "tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: { baseURL: process.env.SHOP_URL ?? "http://localhost:3100", headless: true },
});
