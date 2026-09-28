# Settings · contracts 10.1–10.4

Increment `increment_5e8a9522b013`, capability `capability_2902dfd80083`, ADR-0729.

`readSettings(home?)` and `setSetting(name, value, home?)` are exported from
`@storytree/agent-link`. The home defaults to the existing `storytreeHome()` resolver:
`STORYTREE_HOME`, otherwise `~/.storytree/0.3`. Settings are a flat JSON object at
`<home>/settings.json`, for example `{ "context-guidance": 400000 }`.

Contract 9.7 can call `readSettings(home)["context-guidance"]`: its `value` is the
effective token count, `source` is `default` or `set`, and the reading also declares
`name`, `type`, `unit`, `default` and `meaning`. Reading is fresh each time. No context
reading, agent tool, project override or app panel is wired by this increment.

The CLI only parses and prints. `storytree settings show` lists values and their
metadata; `storytree settings set context-guidance 400000` writes through the agent
link. Both work offline and outside a project. Positive whole numbers must be
exactly representable as JavaScript safe integers; the CLI accepts decimal digits.

Absent files and unset keys read as defaults. Malformed JSON, invalid shapes, unknown
keys and invalid values are reported with the settings path and reason. Unreadable
paths are reported. A setter validates the existing file before making a temporary
file and atomically renaming it, so a damaged file is not replaced and interrupted
writes cannot leave partially written JSON.

## Red then green

Every commit was pushed. Each red test ran after its red commit was pushed, and
before implementation. [red.txt](red.txt) and [green.txt](green.txt) contain the
successive outputs in the order below.

| Contract | Red commit | Green commit | Missing behavior observed |
| --- | --- | --- | --- |
| 10.1 | `6a1e0b0` | `038f33c` | No public settings reader. |
| 10.2 | `ce5cf3e` | `de01a46` | CLI had no settings family. |
| 10.3 | `2af4255` | `9410331` | Invalid settings were accepted and written. |
| 10.4 | `52774f5` | `a8447fb` | Invalid values fell back to defaults; unreadable errors lacked settings context. |

The focused command was run under the shared heavy-work lock:

```sh
flock /tmp/storytree-heavy.lock node --import tsx --test \
  packages/agent-link/src/settings/settings.test.ts packages/cli/src/settings.test.ts
```

The first red/green runs named only the agent-link file; the second red named only
the CLI file. Every settings fixture has a throwaway home. The built CLI test uses
`STORYTREE_HOME` and exercises help, persistence, readback, argument refusals and
damaged-file errors. The directory fixture exercises unreadable settings on Linux,
macOS and Windows without depending on permission changes or user privilege.

No contract wording or decision changed; there is no pending library patch.
The laptop supervisor closes the increment after merge. Contract 9.7 remains in
`increment_79be6b5a62b6`.
