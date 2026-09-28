# Definitions uncapped — contract 3.7

A prompt naming six matching terms now receives all six, longest first. The existing contract
3.7 test was replaced in place; it also checks that all six are remembered for the session and
that the first line of a long meaning is cut to 200 characters. Its existing matching,
harness-notice, stopped-app and session-ledger assertions remain.

- [red.txt](red.txt): the pushed red commit `17158bf` fails because the sixth term, Arc, is missing.
- [green.txt](green.txt): the same contract passes after removing the cap constant and slice.
- [library-update/](library-update/): pending field patch and supervisor checklist.

Both focused runs used the shared heavy-work lock:

```sh
flock /tmp/storytree-heavy.lock pnpm test -- --test-name-pattern='^3\.7 ' packages/agent-link/src/hooks/hooks.test.ts
```

The only product-code changes are in `src/hooks/definitions.ts` and `src/hooks/hooks.test.ts`.
There is no UI change or visual capture for this hook behaviour. The lane accesses only the
supplied snapshot in a throwaway home; the supervisor applies the library patch after merge.
