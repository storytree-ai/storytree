# A territory's roads meet at a junction, with no settlement symbol (ADR-1339 D2, contract 3.79)

Mick, by voice 2026-11-15 (voice.note_8e6d9afde11a): "I think we remove the icons from the center, change it as some like
dot for the pathways to go into, and then leave the markers for the agents."

What this draws: round 12's settlement symbol (ADR-1236 D1: a store's cylinder, a service's box and the rest) is gone.
Where a territory's roads end they meet at a junction: a disc of the roads' own sand, 1.8 times as wide as the widest road
meeting there, drawn with the roads, so it reads as the roads joining rather than a mark laid on them. The spot it stands
at is unchanged (clear of every name and border), and so are the agents' marks, the open-work rings round it and a
picked capability's gold ring.

storytree's own map (the code-rows snapshot and its survey), each island from its own camera stop: The library near
(4 times the near detail zoom) and far (1.2 times), The agent link, The command line and The dev loop near (3 times).
Before is main; after is this branch. Counted from the scene (`*-measurements.json`): before, 14, 10, 11 and 5
settlement symbols shown and no territory junction; after, no symbol and 14, 10, 11 and 5 junctions.

Taken by `node --import tsx packages/forest/testing/view/road-junctions/capture.mjs before|after` (append `--retake`
to write here).
