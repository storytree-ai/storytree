// Capability 8 · Storytree's own test and gate entries.
import gitEndOfOptions from "./git-end-of-options.mjs";
import noComments from "./no-comments.mjs";
import noHappyDomEqual from "./no-happy-dom-equal.mjs";
import noOneCharacterEscape from "./no-one-character-escape.mjs";
import noPartialEscape from "./no-partial-escape.mjs";
import noSwallowedAssert from "./no-swallowed-assert.mjs";
import noTagStrip from "./no-tag-strip.mjs";
import noUnguardedBatchFetch from "./no-unguarded-batch-fetch.mjs";
import numberedTestAsserts from "./numbered-test-asserts.mjs";
import posixCommands from "./posix-commands.mjs";
import remoteCacheDomain from "./remote-cache-domain.mjs";
import sketchBundleNames from "./sketch-bundle-names.mjs";
import writeNamesPlace from "./write-names-place.mjs";

export default {
  meta: { name: "storytree" },
  rules: {
    "no-comments": noComments,
    "no-tag-strip": noTagStrip,
    "no-partial-escape": noPartialEscape,
    "no-one-character-escape": noOneCharacterEscape,
    "git-end-of-options": gitEndOfOptions,
    "no-happy-dom-equal": noHappyDomEqual,
    "numbered-test-asserts": numberedTestAsserts,
    "no-swallowed-assert": noSwallowedAssert,
    "posix-commands": posixCommands,
    "sketch-bundle-names": sketchBundleNames,
    "no-unguarded-batch-fetch": noUnguardedBatchFetch,
    "write-names-place": writeNamesPlace,
    "remote-cache-domain": remoteCacheDomain,
  },
};
