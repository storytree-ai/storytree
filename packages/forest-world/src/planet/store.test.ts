import assert from 'node:assert/strict';
import test from 'node:test';
import { storeLayout, tableNameSize, tableNameSizes } from './store.js';

test('4.46 a store is its own flat object: its tables are laid in tiles that all fall inside its footprint, apart, and the footprint grows with them', () => {
  const inside = (tables: readonly string[]) => {
    const laid = storeLayout(tables);
    assert.deepEqual(laid.tiles.map(({ name }) => name), [...tables]);
    for (const tile of laid.tiles) {
      assert.ok(tile.x - tile.width / 2 >= -laid.width / 2 && tile.x + tile.width / 2 <= laid.width / 2, `${tile.name} lies across the store's east or west side`);
      assert.ok(tile.z - tile.depth / 2 >= -laid.depth / 2 && tile.z + tile.depth / 2 <= laid.depth / 2, `${tile.name} lies across its north or south side`);
    }
    laid.tiles.forEach((a, i) => laid.tiles.slice(i + 1).forEach((b) =>
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2, `${a.name} and ${b.name} overlap`)));
    return laid;
  };
  const none = inside([]);
  const one = inside(['orders']);
  const many = inside(['answers', 'boxes', 'checks', 'forms', 'orders', 'people', 'sessions']);
  assert.ok(none.width > 0 && none.depth > 0, 'a store with no tables (a Redis) is still drawn');
  assert.ok(many.width * many.depth > one.width * one.depth);
  assert.ok(storeLayout(['a']).reach >= Math.hypot(one.width, one.depth) / 2 - 1e-9, 'its reach covers its corners');
});

test("4.46 a table's tile is as wide as its name: checkbox's document_summaries and source_objects each hold their whole name, and stay apart", () => {
  const laid = storeLayout(['tenants', 'users', 'source_objects', 'chunks', 'grants', 'document_summaries']);
  for (const tile of laid.tiles) assert.ok(tile.width >= tile.name.length * 8, `${tile.name}'s ${tile.name.length} characters cross its ${tile.width}-wide tile`);
  laid.tiles.forEach((a, i) => laid.tiles.slice(i + 1).forEach((b) =>
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2, `${a.name} and ${b.name} overlap`)));
  for (const tile of laid.tiles) assert.ok(Math.abs(tile.x) + tile.width / 2 <= laid.width / 2, `${tile.name} lies across the store's side`);
});

test("4.46 a table's name scales with its tile, so document_summaries stays whole inside its tile at the map's opening zoom and every other", () => {
  const laid = storeLayout(['tenants', 'users', 'source_objects', 'chunks', 'grants', 'document_summaries']);
  for (const pixels of [0.2, 0.71, 1, 3]) for (const tile of laid.tiles)
    assert.ok(tile.name.length * 0.6 * tableNameSize(pixels) <= tile.width * pixels, `${tile.name} crosses its tile at ${pixels}px a ground unit`);
  assert.equal(tableNameSize(1), 13, 'drawn 13px across where a ground unit is a pixel');
});

test("4.46 each table's name is sized from its own tile as the map draws it, so every name stays whole at the opening view's 0.71px a unit", () => {
  const laid = storeLayout(['tenants', 'users', 'source_objects', 'chunks', 'grants', 'document_summaries']);
  const sizes = tableNameSizes(laid, (x, z) => [700 + 0.71 * x, 500 + 0.6 * z]);
  for (const tile of laid.tiles) {
    const px = sizes.get(tile.name)!;
    assert.ok(tile.name.length * 0.6 * px <= tile.width * 0.71, `${tile.name}'s ${px}px name crosses its ${tile.width * 0.71}px tile`);
  }
  assert.ok(Math.abs(sizes.get('document_summaries')! - 13 * 0.71) < 1e-9, 'sized from its tile, not left at 13px');
});
