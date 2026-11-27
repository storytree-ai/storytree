import { transactionsBehaviourSuite } from "./testing/behaviour-suite.js";
import { MemoryTransactions } from "./index.js";

transactionsBehaviourSuite("memory", async () => ({
  store: new MemoryTransactions(),
  cleanup: async () => {},
}));
