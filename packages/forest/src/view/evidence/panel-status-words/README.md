# The story panel's capability word in its status's colour (contract 4.43)

Four story panels as `renderStoryPanel` draws them, each with one capability selected whose word is proposed, healthy,
unhealthy or untested, under the desktop's own stylesheet and the forest's, in the OS's light and dark themes.

What this shows: before, every word drew in the panel's text colour (light `rgb(29, 31, 35)`, dark `rgb(231, 232, 234)`),
because the capability-tree retirement (ADR-1285) took the `--st-*` definitions away with the tree's cards. After, each
word has its own colour: on light, proposed `#8a4b0f`, healthy `#146c2e`, unhealthy `#a61b1b`, untested `#4e545d`; on dark,
proposed `#f2b84b`, healthy `#8fdba6`, unhealthy `#ffaaaa`, untested `#b8bdc4`. Healthy, unhealthy and untested are the
host's pass, fail and none text colours; proposed is the forest's own amber.

Pictures, 760 x 520:

- `status-words-light-before.png`, `status-words-dark-before.png`: main's forest stylesheet.
- `status-words-light.png`, `status-words-dark.png`: this change.

Taken with `node --import tsx packages/forest/testing/view/panel-status-words/capture.mjs [--before] <folder>`, which prints
each word's computed colour and the panel's background.

In the evidence bucket for #616, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `616/panel-status-words/status-words-light-before.png`, `616/panel-status-words/status-words-light.png`, `616/panel-status-words/status-words-dark-before.png`, `616/panel-status-words/status-words-dark.png`.
