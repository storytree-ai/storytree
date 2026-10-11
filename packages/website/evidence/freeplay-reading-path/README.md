# Free play on storytree's own globe: a picked session's reading path (increment_c684327d5381)

`capture.mjs` opens free play, switches to storytree's saved project, opens the sessions list's History and picks the session
with the most recorded reads (01a0fac3…, 90 reads), then pictures it at 1440 and 390 on SwiftShader. Run it after
`pnpm --filter @storytree/website build`; `WEBSITE_DIST=<dir> … --as <prefix>` pictures another build.

**Found.** storytree's saved core now has the recording's window reader (`recordedView` in `src/tour-reading.ts`, test 2.13), so a
picked session's window answers as absent and the core falls back to its recorded reading path, as the shop's does (ADR-0990 D2).
The pictures are still pixel-identical to a build without it: storytree's saved recording (2 October 2026, 00:00 to 04:15 UTC)
holds 114 note reads, all `peek`, and the core joins only `whole` reads into a path (`ReadRecord.replay`). The shop's holds 45
whole reads. A drawn path on storytree's globe needs its saved reading re-recorded over a window whose sessions read notes whole.
