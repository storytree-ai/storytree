// Capability 4 · Look inside and inspect an artifact
const TABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "open-library-note": { "response-p50": "measure_b17968135e50", "response-worst": "measure_faa43d39d2ea", "longest-frame": "measure_a3b99be7fe9b", "settled-p50": "measure_583b03406b13", "settled-worst": "measure_5b6c635ff1e0" },
};

export const LAG_MEASURE_READERS = Object.entries(TABLE).flatMap(([action, quantities]) =>
  Object.entries(quantities).map(([quantity, measure]) => ({ measure, version: 1, recordedBy: "lag box", action, quantity })),
);
