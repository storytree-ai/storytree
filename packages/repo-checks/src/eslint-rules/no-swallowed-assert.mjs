// Capability 8 · Storytree's own test and gate entries.
import { importsOf, isAssertion, some, TEST_FILE } from "./assertions.mjs";

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      swallowed: "{{callee}} sits in a catch block that does not rethrow, so it never runs when nothing throws and the test passes; use assert.rejects or assert.throws instead",
    },
  },
  create(context) {
    if (!TEST_FILE.test(context.filename)) return {};
    let imports;
    return {
      Program(program) {
        imports = importsOf(program);
      },
      CatchClause(node) {
        if (some(node.body, false, (inner) => inner.type === "ThrowStatement")) return;
        let swallowed;
        some(node.body, false, (inner) => inner.type === "CallExpression" && isAssertion(imports, inner.callee) && (swallowed = inner) !== undefined);
        if (swallowed === undefined) return;
        context.report({ node: swallowed, messageId: "swallowed", data: { callee: context.sourceCode.getText(swallowed.callee) } });
      },
    };
  },
};
