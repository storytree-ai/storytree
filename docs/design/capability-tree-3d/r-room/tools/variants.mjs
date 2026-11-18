
const forest = 'packages/forest/src/';

const BAND = `
function roomBand(segments, onSurface, width, colour) {
  const positions = [], half = width / 2;
  const push = (p) => { const v = onSurface(p); positions.push(v.x, v.y, v.z); };
  const ends = new Map();
  for (const { from, to } of segments) {
    const l = Math.hypot(to.x - from.x, to.z - from.z);
    if (l < 1e-9) continue;
    const n = { x: -(to.z - from.z) / l * half, z: (to.x - from.x) / l * half };
    const a = { x: from.x + n.x, z: from.z + n.z }, b = { x: to.x + n.x, z: to.z + n.z }, c = { x: to.x - n.x, z: to.z - n.z }, d = { x: from.x - n.x, z: from.z - n.z };
    for (const p of [a, b, c, a, c, d]) push(p);
    for (const p of [from, to]) ends.set(p.x.toFixed(3) + "," + p.z.toFixed(3), p);
  }
  for (const p of ends.values()) for (let k = 0; k < 12; k++) {
    const t0 = k / 12 * 2 * Math.PI, t1 = (k + 1) / 12 * 2 * Math.PI;
    push(p); push({ x: p.x + Math.cos(t0) * half, z: p.z + Math.sin(t0) * half }); push({ x: p.x + Math.cos(t1) * half, z: p.z + Math.sin(t1) * half });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false }));
  mesh.name = "room-band";
  mesh.raycast = () => {};
  mesh.renderOrder = 1.7;
  return mesh;
}
/** The island's scale against The library's, from its coast (lakes not taken off): the band's width scales with it, as every mark's does. */
function roomScale(coast) {
  if (coast === undefined) return 1;
  const area = coast.reduce((s, r) => s + Math.abs(r.reduce((t, a, i) => { const b = r[(i + 1) % r.length]; return t + a.x * b.z - b.x * a.z; }, 0) / 2), 0);
  return Math.sqrt(area / 24105) || 1;
}
`;

const LINES_ADDED = 'lines.renderOrder = 2;\n  group.add(lines);';
const band = (segments, width, colour) => ({
  file: `${forest}view/territory-land.ts`,
  edits: [
    [LINES_ADDED, `${LINES_ADDED}\n  lines.visible = false;\n  group.add(roomBand(${segments}, onSurface, ${width} * roomScale(coast), ${JSON.stringify(colour)}));`],
  ],
  append: BAND,
});

const GAPS = `
function roomGaps(cells, owners) {
  const count = new Map();
  for (const o of owners) count.set(o, (count.get(o) ?? 0) + 1);
  const out = [...owners], lost = new Map();
  cells.forEach((cell, c) => {
    const t = owners[c];
    if (t < 0) return;
    const yields = cell.neighbours.some((n) => { const u = owners[n]; return u >= 0 && u !== t && (count.get(t) > count.get(u) || (count.get(t) === count.get(u) && t > u)); });
    if (yields) { out[c] = -1; lost.set(t, (lost.get(t) ?? 0) + 1); }
  });
  for (const [t, n] of lost) if (n >= count.get(t)) owners.forEach((o, c) => { if (o === t) out[c] = t; });
  return out;
}
`;

export const OPTIONS = {
  today: { title: "Today's look", files: [] },
  A: {
    title: 'Open ground between territories',
    files: [{
      file: `${forest}territories/link-layout.ts`,
      edits: [
        ['const CUT = 260;', 'const CUT = 640;'],
        ['  const { fine, scale, coast } = island;\n  const cells = fine.cells.map(', '  const { fine, scale, coast } = island;\n  owners = roomGaps(fine.cells, owners);\n  const cells = fine.cells.map('],
      ],
      append: GAPS,
    }],
  },
  B: {
    title: 'Thick borders',
    files: [band('kept', 1.3, '#dfe2df')],
  },
  C: {
    title: 'A border lane, the gate in its middle, the road through it',
    files: [band('land.borders.filter((b) => b.between !== undefined && b.between.every((c) => (land.cells[c]?.territory ?? -1) >= 0)).flatMap(({ from, to }) => coast === undefined ? [{ from, to }] : insideOf(from, to, coast))', 2.6, '#767b7c')],
  },
  D: {
    title: 'Quieter fills',
    files: [{
      file: `${forest}view/territory-land.ts`,
      edits: [['transparent: true, opacity: fill.opacity, side: DoubleSide', 'transparent: true, opacity: fill.opacity * 0.4, side: DoubleSide']],
    }],
  },
  E: {
    title: 'Fewer marks: no gate posts, no settlement symbols',
    files: [{
      file: `${forest}view/island-roads.ts`,
      edits: [
        ['  standingPosts(group, roads, relief, onGround, under);\n', ''],
        ['  group.add(settlementSymbols(roads, onSurface, 0.05 * relief.scale));\n', ''],
      ],
    }],
  },
  F: {
    title: 'A bigger island, marks the same size',
    files: [{
      file: `${forest}territories/link-layout.ts`,
      edits: [['export const LIBRARY_LAND = 24105;', 'export const LIBRARY_LAND = 24105 * 2.25;']],
    }],
  },
};

export function optionPlugin(name, root, { readFileSync, path }) {
  const option = OPTIONS[name];
  if (!option) throw new Error(`no option ${name}: ${Object.keys(OPTIONS).join(', ')}`);
  const byFile = new Map(option.files.map(f => [path.join(root, f.file), f]));
  return {
    name: `room-${name}`,
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, (args) => {
        const change = byFile.get(args.path);
        if (!change) return undefined;
        let source = readFileSync(args.path, 'utf8');
        for (const [from, to] of change.edits) {
          const at = source.indexOf(from);
          if (at < 0 || source.indexOf(from, at + 1) >= 0) throw new Error(`option ${name}: ${change.file} no longer holds exactly one ${JSON.stringify(from.slice(0, 60))}`);
          source = source.slice(0, at) + to + source.slice(at + from.length);
        }
        return { contents: source + (change.append ?? ''), loader: args.path.endsWith('x') ? 'tsx' : 'ts' };
      });
    },
  };
}
