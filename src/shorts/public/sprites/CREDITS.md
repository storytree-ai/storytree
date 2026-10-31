# Cast sprite sheet credits

`cast.png` and `cast.json` are built by `shorts/first-short/assemble-cast.mjs`, with no network,
from the files committed next to it.

## The developer: generated with PixelLab

Every frame of the developer (his poses `typing`, `scratching`, `leaning`, `standing` and `walking`, and his empty
chair) was generated with PixelLab on the owner's subscription (ADR-1065) and is used as it came back,
only placed on the sheet. The raw frames and keyframes are in `shorts/first-short/pixellab/`;
`generations.json` there lists every API call (endpoint, request without images or token, ids, which frames it made).

| Source | URL | Licence | Use |
| --- | --- | --- | --- |
| PixelLab, REST api v2 (`create-image-pixen`, `edit-image-pixen`, `animate-with-text-v3`) | https://www.pixellab.ai | PixelLab terms of service §1.3: ownership of generated output stays with the user; commercial use allowed | every developer frame on the sheet |

## The set: generated with PixelLab

The room, its desk, monitor, keyboard, mouse and mug (`set.png`) are PixelLab's re-drawing of the owner's reference image
(`shorts/first-short/reference/`) with the person and chair taken out and the screen made one flat green;
the window (`window.png`) is PixelLab's too; the chair is the developer's own, from his frames. `assemble-cast.mjs` only
stretches the set's edges to fill a half of the frame and cuts its green screen out, so the scene draws what the screen
shows behind it. The calls are in the same `generations.json` (the round for increment_ea834305fe2d).

| Source | URL | Licence | Use |
| --- | --- | --- | --- |
| PixelLab, REST api v2 (`edit-image-pixen`, `create-image-pixen`) | https://www.pixellab.ai | PixelLab terms of service §1.3, as above | the room, its props and the window |
