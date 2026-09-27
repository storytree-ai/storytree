// Browser-only synthetic input borrowed from globe-look-2. The real seed is never changed.
export function synthetic(seed) {
  const copy = structuredClone(seed);
  copy.projects = ['Synthetic · 36 stories'];
  copy.tree.arcs = [];
  copy.changes = { changes: [], cursor: 0 };
  copy.lines = { lines: [], cursor: 0 };
  copy.covers = {};
  copy.tree.stories = Array.from({ length: 36 }, (_, i) => {
    const story = structuredClone(seed.tree.stories[i % seed.tree.stories.length]);
    const ids = new Map();
    ids.set(story.id, `synthetic-story-${i + 1}`);
    for (const [j, cap] of story.capabilities.entries()) {
      ids.set(cap.id, `synthetic-${i + 1}-cap-${j + 1}`);
      for (const [k, contract] of cap.contracts.entries()) ids.set(contract.id, `synthetic-${i + 1}-cap-${j + 1}-contract-${k + 1}`);
    }
    const remap = value => {
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map(remap);
      if (value?.reported && value?.verified) return { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
      return value;
    };
    const made = remap(story);
    made.title = `Story ${String(i + 1).padStart(2, '0')}`;
    for (const cap of made.capabilities) {
      cap.dependsOn = cap.dependsOn.filter(id => [...ids.values()].includes(id));
      if (i % 4 !== 0) {
        cap.health.reported = { state: 'passing' };
        for (const contract of cap.contracts) contract.health.reported = { state: 'passing' };
        copy.lines.lines.push({ kind: 'landed', capability: cap.id, at: '2026-09-27T00:00:00.000Z' });
      }
    }
    return made;
  });
  copy.lines.cursor = copy.lines.lines.length;
  return copy;
}
