/** Forest capability 3 · a shared store on the map: picked by a click on its slab, and its panel (ADR-1332 D1, D2). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera } from "three";
import type { SharedStore } from "@storytree/library";

import { PanelSelection, type Selection } from "./panel-selection.js";
import { pickGlobe } from "./planet-navigation.js";
import { renderStorePanel } from "./store-panel.js";

const shop: SharedStore = {
  address: "postgres://db/shop",
  medium: "postgres",
  evidence: [{ file: "docker-compose.yml", says: "service db, image postgres:16" }, { file: ".env", says: "DATABASE_URL" }],
  tables: [
    { name: "people", columns: [{ name: "id", type: "serial" }], foreignKeys: [], from: ["migrations/001_init.sql"] },
    { name: "orders", columns: [{ name: "id", type: "serial" }, { name: "person_id", type: "integer" }], foreignKeys: [{ columns: ["person_id"], table: "people", references: ["id"] }], from: ["migrations/001_init.sql", "migrations/002_orders.sql"] },
  ],
};

test("3.110 a click on a store's slab picks the store, and its panel names its address, its evidence, who touches it: not yet read, and its tables with their columns and foreign keys", () => {
  const world = new Group();
  const store = new Group();
  store.name = `store:${shop.address}`;
  store.add(new Mesh(new BoxGeometry(10, 10, 1), new MeshBasicMaterial()));
  world.add(store);
  const camera = new OrthographicCamera(-15, 15, 15, -15, 0.1, 100);
  camera.position.z = 40;
  camera.updateMatrixWorld();
  const box = { left: 0, top: 0, width: 300, height: 300 };
  assert.deepEqual(pickGlobe(world, camera, box, { x: 150, y: 150 }, "forest"), { kind: "store", id: shop.address });
  assert.equal(pickGlobe(world, camera, box, { x: 295, y: 150 }, "forest"), undefined, "beside the slab picks nothing");

  const heard: Selection[] = [];
  new PanelSelection((selection) => heard.push(selection)).store(shop.address);
  assert.deepEqual(heard, [{ kind: "store", id: shop.address }]);

  const html = renderStorePanel({ ...shop, evidence: [...shop.evidence, { file: "a<b>.env", says: "x" }] });
  const panel = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(panel, /postgres:\/\/db\/shop/);
  assert.match(panel, /docker-compose\.yml service db, image postgres:16/);
  assert.match(panel, /\.env DATABASE_URL/);
  assert.match(panel, /Who touches it: not yet read/i);
  assert.match(panel, /orders .*person_id integer.*person_id → people \(id\)/);
  assert.match(panel, /people .*id serial/);
  assert.match(html, /a&lt;b&gt;\.env/, "every word from the files is written as text, never as HTML");
  assert.match(html, /class="panel-close"/, "it closes as a story's panel does");
});
