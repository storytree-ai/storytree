/** Capability 2's behaviour suite against the in-memory twin: a fresh store per test. */
import { transactionsBehaviourSuite } from "./behaviour-suite.js";
import { MemoryTransactions } from "./memory.js";

transactionsBehaviourSuite("memory", async () => ({
  store: new MemoryTransactions(),
  cleanup: async () => {},
}));
