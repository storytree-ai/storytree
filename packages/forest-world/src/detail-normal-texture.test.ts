// detail-normal-texture.test.ts — the two recipe numbers pinned to their lines, and the texture's
// sampling state proved without a browser.
//
// ⚠ HOW A `TextureLoader` RUNS HERE AT ALL. `three`'s `ImageLoader` creates its `<img>` through
// `document.createElementNS`, and bun has no `document`. The test installs a MINIMAL stub for the
// duration of the call — an element that records the `src` it was given and accepts listeners —
// which is enough for the loader's synchronous half to run, and it is that half the module owns:
// the URL it hands the browser and the sampling state it sets on the returned texture. The
// asynchronous decode is the browser's, and the delivered-pixel guard on a real GPU is where it
// is proved.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
} from 'three';

import { DETAIL_NORMAL_PNG_BASE64 } from './detail-normal.js';
import { LAND_SCALE } from './land-per-capability.js';
import {
  DETAIL_STRENGTH_RECIPE,
  DETAIL_TILE_UNITS,
  HEADLESS_DETAIL_NAME,
  detailNormalTexture,
} from './detail-normal-texture.js';




/** A stand-in for the one DOM call `ImageLoader` makes, recording what it was asked to load. */
interface StubImage {
  tag: string;
  src: string | undefined;
  addEventListener: () => void;
  removeEventListener: () => void;
}

/** What a stubbed call yields: the module's own return value, and every element the loader made. */
interface StubbedLoad<T> {
  result: T;
  created: StubImage[];
}

function withDocumentStub<T>(run: () => T): StubbedLoad<T> {
  const created: StubImage[] = [];
  const stub = {
    createElementNS(_ns: string, tag: string): StubImage {
      const el: StubImage = {
        tag,
        src: undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
      created.push(el);
      return el;
    },
  };
  const g = globalThis as { document?: unknown };
  assert.equal(g.document, undefined, 'this test expects to run without a DOM');
  g.document = stub;
  try {
    return { result: run(), created };
  } finally {
    delete g.document;
  }
}

test('the texture is loaded from the embedded PNG as a data: URL, and nothing is fetched', () => {
  const { result, created } = withDocumentStub(() => detailNormalTexture());
  assert.ok(result instanceof Texture, 'detailNormalTexture() did not return a three Texture');
  assert.equal(created.length, 1, 'the loader created more than one image element');
  assert.equal(created[0]!.tag, 'img');
  assert.equal(
    created[0]!.src,
    'data:image/png;base64,' + DETAIL_NORMAL_PNG_BASE64,
    'the loader was handed something other than the embedded PNG as a data: URL',
  );
});

test('the texture repeats, is linear data, and is mipmapped with trilinear minification', () => {
  const { result: tex } = withDocumentStub(() => detailNormalTexture());
  assert.equal(tex.wrapS, RepeatWrapping, 'wrapS');
  assert.equal(tex.wrapT, RepeatWrapping, 'wrapT');
  assert.equal(tex.colorSpace, NoColorSpace, 'a normal map is data, not colour');
  assert.equal(tex.generateMipmaps, true);
  assert.equal(tex.minFilter, LinearMipmapLinearFilter);
  assert.equal(tex.magFilter, LinearFilter);
});

test('the texture records that it was routed through the colour convention as a DATA map', () => {
  // The convention leaves a data map alone, so the routing would otherwise be invisible on the
  // texture: `userData` carries the application's own report, and it must name the normal-map
  // slot — a call handed an EMPTY material records nothing routed at all. On both paths, because
  // the headless texture is the same object with no image and must carry the same record.
  const { result: decoded } = withDocumentStub(() => detailNormalTexture());
  assert.deepEqual(decoded.userData['colourConvention'], ['normalMap']);
  assert.equal(typeof document, 'undefined', 'this test relies on bun having no document');
  const headless = detailNormalTexture();
  assert.deepEqual(headless.userData['colourConvention'], ['normalMap']);
});

test('each call returns a fresh texture — two materials never share one GPU upload state', () => {
  const a = withDocumentStub(() => detailNormalTexture()).result;
  const b = withDocumentStub(() => detailNormalTexture()).result;
  assert.notEqual(a, b);
  assert.notEqual(a.uuid, b.uuid);
});

// ---------------------------------------------------------------- headless callers

test('with no document the texture is an image-less, NAMED Texture with the same flags', () => {
  // bun has no `document` (that is why the tests above stub one). The frame-cost and comparison
  // pages build the SHIPPED scene under node to read its plan; there the material still binds a
  // Texture, and the name is what keeps a headless-built frame from passing as the map.
  assert.equal(typeof document, 'undefined', 'this test relies on bun having no document');
  const tex = detailNormalTexture();
  assert.equal(tex.name, HEADLESS_DETAIL_NAME);
  assert.equal(tex.wrapS, RepeatWrapping);
  assert.equal(tex.wrapT, RepeatWrapping);
  assert.equal(tex.colorSpace, NoColorSpace);
  assert.equal(tex.generateMipmaps, true);
  assert.equal(tex.minFilter, LinearMipmapLinearFilter);
  assert.equal(tex.magFilter, LinearFilter);
  // And a browser-built one is NOT so named — the stubbed path above decodes the data: URL.
  const { result: decoded } = withDocumentStub(() => detailNormalTexture());
  assert.notEqual(decoded.name, HEADLESS_DETAIL_NAME);
});
