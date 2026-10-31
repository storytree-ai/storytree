# storytree.dev

The website: its source (`src/`), tests (`src/**/*.test.*`), capture scripts (`testing/`, `shorts/`) and build. Its plan is
the library project `storytree-website` (`.storytree.json`).

It builds against storytree's own source, the git submodule in `storytree/`, pinned to a commit (ADR-1171). The pnpm
workspace includes the storytree packages the site reaches (`pnpm-workspace.yaml`), and the site imports only what their
`exports` declare. Picking up storytree changes is a deliberate commit that moves the pin:

```sh
git -C storytree fetch origin main && git -C storytree checkout <commit>
pnpm install && pnpm typecheck && pnpm test && pnpm build
git add storytree pnpm-lock.yaml && git commit -m "storytree moves to <commit>"
```

```sh
git clone --recurse-submodules <this repository>   # or: git submodule update --init
pnpm install
pnpm typecheck
pnpm test          # node:test through tsx, against a throwaway Postgres (test.mjs)
pnpm build         # into dist/
```

The saved map is storytree's own plan and code (ADR-1171 D4): `pnpm refresh:forest --from <ISO> --to <ISO>` reads
storytree's library project and surveys the submodule's checkout (see FOREST.md). The first time on a machine, approve
the submodule as storytree's checkout there: `storytree doctor --join storytree`, run in `storytree/`.

Publishing to storytree.dev and storytree.dev/staging still runs from storytree's repository until ADR-1171 D3 step (3)
moves it here, with the publication check (storytree's `packages/website/publish-ci.mjs` and `src/publish-source.ts`)
rewritten for this layout.
