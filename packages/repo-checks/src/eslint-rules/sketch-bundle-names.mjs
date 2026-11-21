// Capability 8 · Storytree's own test and gate entries.
import path from "node:path";

import { repoFile } from "./nodes.mjs";

export const MINIFIED_NAME = /[.-]min\.js$/;
const SKETCH = /^docs\/design\/.*\.js$/;
const LONG_LINE = 1000;
const DATA_ASSIGNMENT = /^\s*window\.[A-Za-z_$][\w$]*\s*=\s*(\{[\s\S]*\})\s*(?:;\s*)?$/;

function isDataAssignment(text) {
  const value = DATA_ASSIGNMENT.exec(text)?.[1];
  if (value === undefined) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unnamed: "has a line over {{limit}} characters, so it reads as a minified bundle CodeQL would scan: name it {{named}} " +
        "(in the build.mjs that writes it, and in its page's script tag), or keep it to one data assignment",
    },
  },
  create(context) {
    const file = repoFile(context);
    if (!SKETCH.test(file) || MINIFIED_NAME.test(file)) return {};
    return {
      Program(node) {
        const text = context.sourceCode.text;
        if (!text.split("\n").some((line) => line.length > LONG_LINE) || isDataAssignment(text)) return;
        const named = path.posix.basename(file).replace(/\.js$/, ".min.js");
        context.report({ node, messageId: "unnamed", data: { limit: String(LONG_LINE), named } });
      },
    };
  },
};
