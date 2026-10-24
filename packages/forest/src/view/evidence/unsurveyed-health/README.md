# Verified health without a code survey

The real desktop renderer, with its bridge answering as a user project named `shop`: two stories,
four capabilities, verified healthy/unhealthy/untested/proposed, and no code survey. All agent reports
say passing, so the red and yellow territories demonstrate that the fill follows verified health.
The capture uses the shared desktop capture kit; it neither reads nor writes a live project library.

| View | Observed |
| --- | --- |
| [Before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/unsurveyed-health/before.png), main `9d364ebd` | Both islands grey; no capability territory meshes. |
| [After](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/unsurveyed-health/after.png) | Four coloured, bordered territories: green server, red browsing, two yellow capabilities. |
| [Live update](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/unsurveyed-health/after-live-health.png) | A verified health change turns browsing green through the ordinary news reader, without reloading. |
| [Reload](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/unsurveyed-health/after-reload.png) | The same colours return after a reload. |

The JSON beside each image records each drawn mesh's capability, verified word, fill, opacity and
vertex count. The capture asserts those measurements and rejects browser errors or missing assets.
Each image is 1440 × 960. The island size and the neutral recorded-landing meter are preserved;
the health territories introduce no file circles. Existing surveyed islands still use code-sized shares.
An unsurveyed project that storytree has never verified keeps its existing bare land until verification arrives.

To reproduce, from the checkout root:

```sh
node --import tsx packages/forest/src/view/evidence/unsurveyed-health/capture.mjs before /path/to/9d364ebd-checkout
node --import tsx packages/forest/src/view/evidence/unsurveyed-health/capture.mjs after
```

Add `--retake` to replace the committed evidence; otherwise the kit writes into its scratch folder.
The baseline checkout must have its dependencies installed.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 4 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/unsurveyed-health).
