// ForestWorldCanvas.regrow.test.ts — the delivery seam projects the app-owned
// regrow cursor without creating a renderer-side schedule or clock.

import assert from 'node:assert/strict';
import test from 'node:test';

import { forestRegrowPresentation } from './ForestWorldCanvas.regrow.js';

test('5.6 projects structural cursor state verbatim and clears terminal cursors', () => {
  const presentation = forestRegrowPresentation({
    progress: 0.375,
    settled: false,
    growing: [{ storyId: 'island-growing', progress: 0.625 }],
    absentStoryIds: new Set(['island-absent']),
    hiddenSegmentIds: new Set(['segment-hidden']),
    drawingSegments: [{ id: 'segment-drawing', drawn: 0.75, fromEnd: true }],
  });

  assert.ok(presentation !== null);
  assert.equal(presentation.progress, 0.375);
  assert.deepEqual(presentation.hiddenIslandIds, new Set(['island-absent']));
  assert.deepEqual(presentation.growingIslandProgressById, new Map([['island-growing', 0.625]]));
  assert.deepEqual(presentation.hiddenSegmentIds, new Set(['segment-hidden']));
  assert.deepEqual(
    presentation.drawingSegmentProgressById,
    new Map([['segment-drawing', { drawn: 0.75, fromEnd: true }]]),
  );

  assert.equal(forestRegrowPresentation(null), null);
  assert.equal(
    forestRegrowPresentation({
      progress: 1,
      settled: true,
      growing: [],
      absentStoryIds: new Set(),
      hiddenSegmentIds: new Set(),
      drawingSegments: [],
    }),
    null,
  );
});
