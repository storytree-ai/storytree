// Capability 3 · Story node render
const TABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "open-fewest-island": { "response-p50": "measure_f466ad9756d2", "response-worst": "measure_346f29db03ec", "longest-frame": "measure_931900ce619f", "settled-p50": "measure_7b3a36c03270", "settled-worst": "measure_bcc5a6c6775d" },
  "open-most-island": { "response-p50": "measure_c3092eb8627d", "response-worst": "measure_3f5d987bede5", "longest-frame": "measure_9f7987f57f37", "settled-p50": "measure_d0e811871569", "settled-worst": "measure_2187075efd5b" },
  "open-named-island": { "response-p50": "measure_8244093f3b54", "response-worst": "measure_ecb7286ed613", "longest-frame": "measure_4d5427d3c233", "settled-p50": "measure_b3b92806a652", "settled-worst": "measure_ebc3fc92930f" },
  "open-part-after-arc": { "response-p50": "measure_e5e1760245a6", "response-worst": "measure_307da3938698", "longest-frame": "measure_d89492cd164e", "settled-p50": "measure_6ad7427a1e63", "settled-worst": "measure_1c589bef73c2" },
  "open-app-kept": { "longest-frame": "measure_a8db11e3f1f6", "settled-p50": "measure_2287fd8b5b89", "settled-worst": "measure_9809cfd9238a" },
  "open-app-fresh": { "longest-frame": "measure_8265fc43fc15", "settled-p50": "measure_60530e1819ef", "settled-worst": "measure_d52b216b26d4" },
  "close-panel": { "response-p50": "measure_00274489cf26", "response-worst": "measure_a5cbd1c7933b", "longest-frame": "measure_e1ae72532b75", "settled-p50": "measure_a69e1103c2a2", "settled-worst": "measure_a39941f4109e" },
  "click-fold": { "response-p50": "measure_1f6828ac31a3", "response-worst": "measure_8e43fcf18582", "longest-frame": "measure_ca0e7a0f0f28", "settled-p50": "measure_9df55d5fc9a1", "settled-worst": "measure_017060645950" },
  "drill-microscope": { "response-p50": "measure_3dc2846099a9", "response-worst": "measure_7ee7285b9d42", "longest-frame": "measure_7dd16b37b16e", "settled-p50": "measure_4af0f9864f19", "settled-worst": "measure_5a572fb5aab0" },
  "open-fold": { "response-p50": "measure_a0a15beb2bef", "response-worst": "measure_f39f53303647", "longest-frame": "measure_3532254736f0", "settled-p50": "measure_a0254ac49072", "settled-worst": "measure_e29208ae5a6f" },
  "open-contract": { "response-p50": "measure_8ec602c53443", "response-worst": "measure_917a766a380f", "longest-frame": "measure_43c0027906d7", "settled-p50": "measure_a4122eb7052d", "settled-worst": "measure_423467bb67ac" },
  "library-and-back": { "response-p50": "measure_8067679c9da1", "response-worst": "measure_bce62723d79d", "longest-frame": "measure_7bf9055afe77", "settled-p50": "measure_1223017617fc", "settled-worst": "measure_a863e2f77365" },
  "open-session-row": { "response-p50": "measure_79cf74307293", "response-worst": "measure_b483c604050e", "longest-frame": "measure_e77f27dd0a2c", "settled-p50": "measure_27cb5f3b7133", "settled-worst": "measure_fccdb439e877" },
  "hover-sweep": { "response-p50": "measure_5b2972362dd3", "response-worst": "measure_833da99b23ff", "longest-frame": "measure_62c74b533384" },
  "turn-forest": { "longest-frame": "measure_b3bfee51d1cb" },
  "turn-library": { "longest-frame": "measure_5b3614c70664" },
  "whole-map": { "response-p50": "measure_efb7f8d24d15", "response-worst": "measure_ec6d80d3d3b7", "longest-frame": "measure_14effa05ccaf", "settled-p50": "measure_3f8db480f417", "settled-worst": "measure_faac2a47d844" },
};

export const LAG_MEASURE_READERS = Object.entries(TABLE).flatMap(([action, quantities]) =>
  Object.entries(quantities).map(([quantity, measure]) => ({ measure, version: 1, recordedBy: "lag box", action, quantity })),
);
