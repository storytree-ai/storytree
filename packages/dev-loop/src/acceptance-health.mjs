// How an acceptance run becomes verified health (ADR-0825 D5).

export const ACCEPTED_BY = "acceptance run";

export function mintAcceptance() {
  return new Map();
}

export function readObservations(text) {
  return JSON.parse(text);
}

export async function recordAcceptance() {
  return { passing: 0, failing: 0, notChecked: 0 };
}
