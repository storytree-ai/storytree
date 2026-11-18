import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera } from "three";
import type { SharedStore } from "@storytree/library";

import { PanelSelection, type Selection } from "./panel-selection.js";
import { pickGlobe } from "./planet-navigation.js";
import { renderStorePanel } from "./store-panel.js";

const shop: SharedStore = { address: "postgres://db/shop", medium: "postgres", tables: [{ name: "people" }, { name: "orders" }] };

test("3.110 a click on a store's slab picks the store, and its panel names its medium, its address and its tables", () => {
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

  const html = renderStorePanel({ ...shop, tables: [...shop.tables, { name: "a<b>" }] });
  const panel = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(panel, /Shared store · postgres postgres:\/\/db\/shop/);
  assert.match(panel, /Tables · 3 people orders a&lt;b&gt;/);
  assert.match(html, /a&lt;b&gt;/, "every word from the plan is written as text, never as HTML");
  assert.match(html, /class="panel-close"/, "it closes as a story's panel does");
});

test("3.111 a store's panel lists who touches it: each capability the mapping agent linked to this store, with each table, its direction and the file and line it cites, marked judged; another store's links are not its", () => {
  const plan = {
    stories: [{
      capabilities: [
        { title: "3 · Retrieval", storeLinks: [{ store: shop.address, table: "orders", direction: "read" as const, cites: ["src/retrieve.py:16", "src/auth.py:8"] }] },
        { title: "5 · HTTP API", storeLinks: [{ store: shop.address, table: "people", direction: "both" as const, cites: ["src/main.py:79"] }, { store: "redis://cache", table: "sessions", direction: "write" as const, cites: ["src/main.py:12"] }] },
        { title: "6 · Run and verify" },
      ],
    }],
  };
  const panel = renderStorePanel(shop, plan).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(panel, /Who touches it · judged by the mapping agent/);
  assert.match(panel, /3 · Retrieval reads orders src\/retrieve\.py:16 ?, src\/auth\.py:8/);
  assert.match(panel, /5 · HTTP API reads and writes people src\/main\.py:79/);
  assert.doesNotMatch(panel, /sessions|Run and verify/);
});
