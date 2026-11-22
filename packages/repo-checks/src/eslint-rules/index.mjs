// Capability 8 · Storytree's own test and gate entries.
import anchoredProcessMatch from "./anchored-process-match.mjs";
import gitEndOfOptions from "./git-end-of-options.mjs";
import hostPlatformUnderGiven from "./host-platform-under-given.mjs";
import noComments from "./no-comments.mjs";
import noHappyDomEqual from "./no-happy-dom-equal.mjs";
import noOneCharacterEscape from "./no-one-character-escape.mjs";
import noPartialEscape from "./no-partial-escape.mjs";
import noPartialRegexpEscape from "./no-partial-regexp-escape.mjs";
import noSilentDerivedFolder from "./no-silent-derived-folder.mjs";
import noSwallowedAssert from "./no-swallowed-assert.mjs";
import noTagStrip from "./no-tag-strip.mjs";
import noUnguardedBatchFetch from "./no-unguarded-batch-fetch.mjs";
import numberedTestAsserts from "./numbered-test-asserts.mjs";
import oneFormCommandLine from "./one-form-command-line.mjs";
import pollSaysOutageOnce from "./poll-says-outage-once.mjs";
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
    "no-partial-regexp-escape": noPartialRegexpEscape,
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
    "anchored-process-match": anchoredProcessMatch,
    "poll-says-outage-once": pollSaysOutageOnce,
    "no-silent-derived-folder": noSilentDerivedFolder,
    "host-platform-under-given": hostPlatformUnderGiven,
    "one-form-command-line": oneFormCommandLine,
  },
};
