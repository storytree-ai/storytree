// Evidence-only builds. No product source is modified and no drawing code is copied.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const website = path.resolve(here, '../..');
const root = path.resolve(website, '../..');
const out = path.join(here, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(website, 'dist'), path.join(out, 'site'), { recursive: true });

function replace(source, needle, value) {
  if (!source.includes(needle)) throw new Error(`Evidence observation seam moved: ${needle}`);
  return source.replace(needle, value);
}
const observe = { name: 'forest-evidence-observation', setup(builder) {
  builder.onLoad({ filter: /PlanetWorldCanvas\.tsx$/ }, async args => ({
    contents: replace(await readFile(args.path, 'utf8'), '<Framing radius={radius} framing={framing} />', '<Framing radius={radius} framing={framing} /><EvidenceProbe />')
      + '\nfunction EvidenceProbe() { const state = useThree(); globalThis.__forestEvidence = state; return null; }\n',
    loader: 'tsx', resolveDir: path.dirname(args.path),
  }));
  builder.onLoad({ filter: /planet-view\.tsx$/ }, async args => {
    let contents = await readFile(args.path, 'utf8');
    contents = replace(contents, 'const layout = useMemo(() => planetLayout(scene, places, shown.current), [scene, places]);',
      `const layout = useMemo(() => { const snapshot = globalThis.__snapshot; const spots = new Map(snapshot.spots); return { scene, spots, radius: snapshot.radius, islands: scene.islands.map(island => ({ story: island.story, trees: island.trees, spot: spots.get(island.story) })) }; }, [scene]);`);
    contents = replace(contents, 'turnTo(openingTurn(islands));', 'onRotate(new Quaternion());');
    return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
  });
} };
const common = {
  bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.glb': 'binary', '.png': 'file', '.webp': 'file' },
  logLevel: 'warning', plugins: [observe],
};
await build({ ...common, absWorkingDir: website,
  entryPoints: { main: 'src/main.ts', forest: 'src/forest.ts', styles: 'src/styles.css' },
  outdir: path.join(out, 'site/assets'),
});
// These observation-only bundles deliberately replace the production entry points.
const observedHome = path.join(out, 'site/index.html');
await writeFile(observedHome, (await readFile(observedHome, 'utf8')).replace(/\/assets\/(main|forest|styles)-[A-Z0-9]+\.(js|css)/g, '/assets/$1.$2'));
await build({ ...common, absWorkingDir: website, entryPoints: [path.join(here, 'desktop-entry.tsx')], outdir: path.join(out, 'desktop/assets') });
await cp(path.join(root, 'apps/desktop/src/renderer/styles.css'), path.join(out, 'desktop/desktop.css'));
await cp(path.join(root, 'packages/forest/src/view/styles.css'), path.join(out, 'desktop/forest.css'));
await writeFile(path.join(out, 'desktop/index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desktop PlanetView · same saved snapshot</title><link rel="stylesheet" href="/desktop.css"><link rel="stylesheet" href="/forest.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101418}#desktop-forest{position:absolute;inset:0}</style></head><body class="forest-workspace"><div id="desktop-forest"></div><script type="module" src="/assets/desktop-entry.js"></script></body></html>`);
console.log('Built observation-only site and isolated actual desktop PlanetView under evidence/forest/dist.');
