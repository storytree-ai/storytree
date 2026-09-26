The unqualified “up to 100 stories never overlap” proof line needs a size bound and a historical-place limit. The first 100 consecutive places can fit at a fixed R = 1,100 ground units; that does not establish the unconditional promise for 100 surviving stories after retirement, or for unrestricted capability counts.

Recommend R = 1,100 ground units (10 place-widths), conditional on keeping the wrapped spiral and accepting its sparse front cluster. At 100 places the smallest actual shore gap is 2.791845 units (19 capabilities, places 80/81); the conservative radius-envelope gap is 0.746151 units. Worst curvature-only rim lift is 1.215494 units, 0.110499% of R. At this R the conservative safe capacity is 113 consecutive historical places for shores bounded by the measured maximum r = 51.711566 units (exact tangent-disc bound: 114). The actual 19-capability fixture stays separate through 156 and first overlaps at places 156/157. The back pole is not crossed until continuous place 3099.486, between places 3099 and 3100: crowding, not that pole crossing, sets capacity.

Used the real private placeOnSpiral through storyNodes, forestScene, groundInput and forestDescriptors with GROUND_PER_PLACE = 110. Also applied the shipped canvas's pure clipToCoast operation: the 19-capability descriptor reaches 48.298 units, but the actual beach reaches 51.712. Measured 256 deterministic ids per size, with 1, 6 and 19 capabilities; this is sampled geometry, not a proven upper radius for arbitrary ids or other capability counts.

Actual minimum shore gaps (ground units; columns 1 / 6 / 19 capabilities):

- R = 238.404263, putting place 100 at 150°: 5 stories = 77.389 / 43.368 / 7.813; 36 = 45.404 / 10.531 / OVERLAP; 100 = OVERLAP / OVERLAP / OVERLAP.
- R = 500: 5 stories = 81.074 / 46.538 / 8.932; 36 = 74.758 / 38.110 / OVERLAP; 100 = 57.983 / 21.400 / OVERLAP.
- R = 1,100: 5 stories = 81.910 / 47.293 / 9.186; 36 = 81.502 / 43.706 / 6.291; 100 = 77.446 / 40.720 / 2.792.

The small-radius candidate actually overlaps by story 95 even with one capability per story, by story 44 with six, and by story 9 with nineteen. At R = 500, nineteen-capability islands first overlap at story 33. Worst rim lifts at the three radii are 5.6083 (2.3524%), 2.6741 (0.5348%) and 1.2155 (0.1105%) ground units. Signed circular-clearance tables and full capacities for each size are in the linked report; an envelope overlap alone is not labelled actual overlap. Actual gaps measure radial surface footprints of the real coast polygons on rigid tangent plates, with no extra twist; they are not full 3D mesh collision tests.

FOR THE OWNER: At the recommended R, all 100 centres are within 32.510° of the front, occupying a cap of only 7.835% of the sphere; the back is empty. Decide whether this is an acceptable first slice, or whether the placement rule should change to spread islands around the globe. Decide the size bound and historical-place limit before retaining the proof line. The numbers do not show that every sensible radius fails for the bounded first 100 places; R = 1,100 passes them. The owner's question was not edited.

Measurement and report: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/README.md
Script: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/measure.mjs
Raw numbers: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/results/measurements.json
5-story front/back picture: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/results/places-005.png
36-story front/back picture: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/results/places-036.png
100-story front/back picture: https://github.com/storytree-ai/storytree/blob/spike/planet-places/spike/planet-places/results/places-100.png

Validation: all 27 centre scans checked independently, two critical shore distances checked by dense sampling, analytic gap and containment checks passed, and PNGs inspected. All work is under spike/, committed and pushed to spike/planet-places. No packages changed, no pull request opened. Closing withdrawn because this is measurement evidence, not a product landing.
