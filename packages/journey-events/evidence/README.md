# Journey sharing controls

Run `node --import tsx packages/journey-events/evidence/capture.mjs` from the checkout. Add `--retake` to replace this evidence; otherwise the shared desktop capture kit writes to scratch.

These pictures use the actual desktop renderer and its content security policy, with the local bridge intercepted. No service credentials, real user events or network analytics calls are used. The fixed installation identifier and `privacy@example.test` are examples. The configured example's 30-day retention is fixture data, not an owner-approved retention policy.

- `first-launch-unavailable.png`: no preselected consent, disabled sharing and an equally visible decline; 1100 × 820 viewport.
- `settings-unavailable.png`: the Sharing section, with off and deletion preparation still available.
- `deletion-unavailable.png`: contact unavailable, installation identifier shown, request explicitly unsent.
- `settings-configured-example.png`: intercepted enabled state, with retention disclosure and off control.
- `settings-narrow.png`: the same example at 560 × 820.

The primary signals are the current sharing state, consent/off controls and deletion preparation. Under **Legible at the resting view** (`principle_1e3418812c33`), the measurements to review are: 14 px button labels; 39.6875 px button height; no horizontal content overflow; first-launch panel occupies 21.38% of the viewport, unavailable settings 34.04%, and narrow settings 58.00%. `capture.json` records every rectangle and zero page errors. The builder supplies these observations for independent review and does not mark appearance accepted.

The interaction tests were observed red with all four initial behaviors absent, then green. Capture exposed inline styles rejected by CSP; the controls now use adopted stylesheets, as the app menu does. A later capture exposed obsolete deletion instructions after a sharing change; that case was observed red, fixed, and all pictures retaken. The five final view tests also exercise the actual local store and confirm off consent plus queue deletion through a reopened connection.
