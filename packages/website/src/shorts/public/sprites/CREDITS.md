# Cast sprite sheet credits

`cast.png` and `cast.json` are built by `packages/website/evidence/first-short/assemble-cast.mjs`, with no network,
from the files committed next to it.

## The developer: generated with PixelLab

Every frame of the developer (all six poses: `typing`, `typing-exact`, `thinking`, `frustrated`, `satisfied`,
`inspecting`) was generated with PixelLab on the owner's subscription (ADR-1065) and is used as it came back,
only placed on the sheet. The raw frames and keyframes are in `packages/website/evidence/first-short/pixellab/`;
`generations.json` there lists every API call (endpoint, request without images or token, ids, which frames it made).

| Source | URL | Licence | Use |
| --- | --- | --- | --- |
| PixelLab, REST api v2 (`create-image-pixen`, `edit-image-pixen`, `animate-with-text-v3`) | https://www.pixellab.ai | PixelLab terms of service §1.3: ownership of generated output stays with the user; commercial use allowed | every developer frame on the sheet |

## The props: drawn in code

The desk, monitor, mug, document and window are drawn pixel by pixel in `assemble-cast.mjs`. No pixels are copied
or traced from any source: the references below were looked at for style, palette mood and proportions only. All
are CC0, so no attribution is required; it is given anyway. (The character reference that once guided the
code-drawn developer no longer applies: that developer is gone.)

| Reference | URL | Author | Licence | Use |
| --- | --- | --- | --- | --- |
| Pixel Office Asset Pack | https://2dpig.itch.io/pixel-office | 2dPig | CC0 1.0 | reference only (1-px dark outlines, 2-3 tone shading, mug and desk props) |
| office objects | https://opengameart.org/content/office-objects | malek-elsady | CC0 | reference only (side-on desk and dark-office palette) |
| Obsolete Computers | https://opengameart.org/content/obsolete-computers | viergacht | CC0 | reference only (monitor bezel and glowing screen shading) |
