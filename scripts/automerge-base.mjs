// The automerge step's check (.github/workflows/ci.yml): merge a pull request only onto the main its
// tests ran against. `platforms` tests the merge of the branch with main as main stood when the run
// started; if another pull request has merged since, the two were never tested together and could
// leave main red, so the pull request is refused and its branch must bring main in and run again.
//
//   node scripts/automerge-base.mjs <tested base> <main's head>
// exits 0 to merge; otherwise prints why (as a GitHub error annotation) and exits 1.
import { fileURLToPath } from "node:url";

export function mergeDecision({ testedBase, mainHead }) {
  if (!testedBase || !mainHead) {
    return { merge: false, reason: `cannot tell which main the tests ran against (tested base '${testedBase ?? ""}', main '${mainHead ?? ""}'), so this is not merged.` };
  }
  if (testedBase !== mainHead) {
    return {
      merge: false,
      reason: `main has moved since this pull request was verified (tested against ${testedBase.slice(0, 12)}, main is now ${mainHead.slice(0, 12)}), so it was never tested with what merged since and is not merged. Bring main in (git fetch origin && git merge origin/main) and push: CI runs again and merges it when green.`,
    };
  }
  return { merge: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [testedBase, mainHead] = process.argv.slice(2);
  const decision = mergeDecision({ testedBase, mainHead });
  if (!decision.merge) {
    console.error(`::error title=Not merged: main moved::${decision.reason}`);
    process.exit(1);
  }
  console.log(`main is still ${mainHead.slice(0, 12)}, the commit the tests ran against: merging.`);
}
