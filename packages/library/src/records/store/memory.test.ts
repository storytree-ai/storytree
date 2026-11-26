import { transactionsBehaviourSuite } from "./behaviour-suite.js";
import { MemoryTransactions } from "./memory.js";

transactionsBehaviourSuite("memory", async () => ({
  store: new MemoryTransactions(),
  cleanup: async () => {},
}));
