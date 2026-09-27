// What `pnpm test` runs by default (ADR-0649 D4). Not built yet.

const notBuilt = () => {
  throw new Error("test scope: not built yet");
};

export const readWorkspace = notBuilt;
export const classify = notBuilt;
export const changedFiles = notBuilt;
export const scopeFor = notBuilt;
export const scopeLine = notBuilt;
export const planRun = notBuilt;
export const resultsTable = notBuilt;
