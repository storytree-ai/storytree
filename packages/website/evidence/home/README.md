# Home page

Reproduce from the repository root with Node 24 and the Playwright Chromium build:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs home --verify-home
```

The browser proof disables JavaScript and checks the complete README-sourced command,
repository/license/contact links and the not-found return path. It also exercises a real
clipboard write and a denied write. Neither success nor denial changes the visible command.

The fixed captures are 1440 × 1000 and 390 × 844, with reduced motion. Both have one primary
heading and zero horizontal overflow. The content widths are 1180 px (82% of desktop) and
350 px (90% of phone); supporting hero text is 22 px and 16 px respectively.

The frontend builder reviewed both pictures against **Legible at the resting view**
(`principle_1e3418812c33`): headline, install action and explanation remain distinct, the
command wraps inside its panel, and links remain separate. Against **The resting view is
designed, not fitted** (`principle_43ea5d4f68c4`), the desktop's lower columns become a phone
reading column with 20 px gutters, rather than a scaled-down desktop. These captures witness
the appearance; they do not record the owner's acceptance.

The forest slot is explicitly pending in this increment: 510 px high on desktop, 400 px on
phone. Its scene and lazy bootstrap belong to site-b. The temporary renderer entry requests
1,427,348 bytes plus a 1,023-byte shared chunk; that is a measured outstanding load-weight
finding for the existing forest increment, not a performance claim about the finished site.
The home stylesheet is 7,715 bytes and its copy-control script is 682 bytes before compression.

Copy was checked against the current README, license, forest scene/drill-down implementation,
and ADR-0798. The preview is labelled a saved snapshot and health as the agent's report.

[Desktop](1440.png) · [Phone](390.png) · [Measurements](measurements.json)
