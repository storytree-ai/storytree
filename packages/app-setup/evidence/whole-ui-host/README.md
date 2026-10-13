# Serving an imported app's whole UI from a storytree package: measured cheap

Increment `increment_d751729b2f24` (arc `arc_c24ca73b8312`, ADR-1020). Run on 2026-10-13 from the Mint box over
`ssh winlap`, on the old Windows laptop, as the redo run (`../import-run-redo`) was. No third-party code was
downloaded or installed on the Mint box.

**In one paragraph.** A storytree-side package serves every page of the Reddit viewer, a Next.js 16 app, and imports
everything it does not touch from the imported folder. It took 3 files written by hand, 51 copied unchanged, one
folder link and no change at all in the old app: no wrappers, and only one copy of the app runs. It builds the same
29 routes the viewer builds alone, with the same 10 CSS warnings, and serves them in production (`next start`) and in
development (`next dev`). A marker put in the package's About page reached the served page, so the pages come from
the storytree side. The redo run's agent had priced this at "roughly 35 wrapper files, two copies of the app to run,
and a high chance the framework does not support it", without trying it. The wrappers are not needed: the route
files are copied as they are, because the path alias they use (`@/…`) is pointed at the imported folder.

## The set-up

| | |
|---|---|
| Machine | the old Windows laptop (`winlap`), Windows 11, Node 22.16 |
| Old app | github.com/gregrickaby/viewer-for-reddit at 7352a167 (the runs' commit), cloned fresh and `npm ci`'d (20 s + 29 s, `git status` clean): `harness/clone.ps1` |
| Layout | `~\st-whole\viewer-for-reddit` (the imported folder) beside `~\st-whole\reddit-stats\packages\web` (the storytree package), as the redo run's projects sat beside their viewers |
| Framework | Next.js 16.4.0 with Turbopack, React 19.3, the React Compiler, Cache Components, typed routes, server actions |

## What the package is

| Kind | Files | What |
|---|---|---|
| Written by hand | 3 | `package.json`, `next.config.ts`, `tsconfig.json` (below) |
| Copied unchanged | 51 | the viewer's `app/` less `app/actions` (45), `public/` (3), `proxy.ts`, `instrumentation.ts`, `instrumentation-client.ts`: `harness/copy-routes.ps1` |
| Linked | 1 | `node_modules`, a directory junction to the viewer's `node_modules`: `harness/link-modules.ps1` |
| The user's own | 1 | `.env.local`, the app's settings (here placeholders; a real user copies theirs) |
| Changed in the old app | 0 | its `git status` stayed clean through every build and serve |

`app/actions` stays in the viewer because the viewer's own components import it (13 imports of `@/app/actions/…` from
`components/`): moving it would make old code import new. The copied route files reach it by the same alias, so one
copy of each server action exists.

```json
{
  "name": "web",
  "private": true,
  "scripts": { "build": "next build", "start": "next start" },
  "dependencies": { "@gregrickaby/viewer-for-reddit": "file:../../../viewer-for-reddit" }
}
```

The dependency on the viewer is declared, never installed (the junction is the install). It is what draws the
road from this package to the mapped viewer on storytree's map (contract 8.23: a built package's dependency on a
mapped package's name).

```ts
import path from 'node:path'
import type { NextConfig } from 'next'
import viewer from '../../../viewer-for-reddit/next.config'

const config: NextConfig = {
  ...viewer,
  turbopack: { root: path.resolve(__dirname, '../../..') },
}

export default config
```

```json
{
  "extends": "../../../viewer-for-reddit/tsconfig.json",
  "compilerOptions": { "paths": { "@/*": ["../../../viewer-for-reddit/*"] } },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules", ".next/dev"]
}
```

## What the framework refused, in order

| Try | What happened | What fixed it |
|---|---|---|
| 1. No `node_modules`, the viewer's `next` binary | "The module 'react' was not found"; Turbopack: "Could not find the Next.js package (next/package.json) … files outside of the workspace root are not compiled" | the package must resolve `next`, `react` and `react-dom` itself, and `turbopack.root` must hold both folders (it did from the first try) |
| 2. `file:` links to the viewer's copies of next, react, react-dom | builds past that; then "Can't resolve '@datadog/browser-rum-nextjs'" from the copied `instrumentation-client.ts`: a copied file resolves bare imports from the package | link every dependency the copied files import |
| 3. `file:` links to all 11 of the viewer's dependencies | `npm install` fails: npm runs `hls.js`'s `prepare` script (`husky`) for a linked folder, even with `--ignore-scripts` | link the whole folder instead |
| 4. `node_modules` a junction to the viewer's `node_modules` | compiled; page data then failed on the app's own settings check (`lib/env.ts`: BASE_URL, REDDIT_CLIENT_ID … undefined) | Next reads `.env*` from the package's folder: put the app's `.env.local` there |
| 5. With `.env.local` | **build exit 0 in 11 s** (after the failed tries had warmed its cache; the viewer alone, cold: 21 s), 29 routes and the proxy, the route table identical to the viewer's own (`runs/host-routes.txt`, `runs/viewer-routes.txt`) | |

The 10 warnings are the same in both builds: Lightning CSS does not yet parse `::scroll-marker-group` and its
neighbours in the viewer's `components/media/gallery.module.css`.

## Serving

| Run | Script | Result |
|---|---|---|
| `next start` | `harness/serve.ps1` | `/` 200 (95 kB), `/about` 200, `/donate` 200, `/robots.txt` 200, `/home` 307 to sign-in, as the viewer does signed out |
| `next dev` | `harness/dev.ps1` | `/` 200 in 3.2 s cold, `/about`, `/donate`, `/robots.txt` 200; ready in 0.6 s |
| A marker in the package's About page title, built and served | `harness/marker.ps1` | the served title read "About (served by the storytree package) · Viewer for Reddit"; restored after; the viewer's `git status` clean; no node process left |

## What to watch

- `npm install` inside the package would write into the viewer's `node_modules` through the junction. The package
  installs nothing: a dependency it needs is added to the viewer's install, or the junction is replaced by an install of
  its own that keeps one copy of the framework.
- The viewer's own `app/` is still there and still builds alone. Once the package serves, a change to a copied route
  file is made in the package; the viewer's copy is the user's to retire (ADR-1015).
- Windows' PowerShell will not walk into a junction with `Get-ChildItem -Recurse` ("untrusted mount point"); the build
  and the server are not affected.
- This is one app on one framework. Another framework is measured when a user brings one (ADR-1020 D3).
