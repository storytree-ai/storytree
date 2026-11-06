/**
 * Capability 2 · Agent activity log. For the cloud account's tests (2.14, and the machines' trunks test), which grant,
 * fence and ungrant tables every other test on the server is writing to at once: a statement that changes a table's
 * rules waits for every lock on it, so it can meet another test's writes in a deadlock, which Postgres ends by failing
 * one of them. The step that lost is tried again, a few times, rather than leaving the account's grants behind it.
 */
const LOST_A_LOCK = new Set(["40P01", "55P03"]);

export async function despiteDeadlocks<T>(step: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (attempt >= tries || typeof code !== "string" || !LOST_A_LOCK.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
