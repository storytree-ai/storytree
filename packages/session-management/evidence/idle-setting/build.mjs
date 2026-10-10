// Bundles the real app menu (gear and settings) for the idle-setting capture to mount; no browser.
// Run alone (`node build.mjs`), it only checks that the bundle still builds.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(root, 'packages/session-management/package.json'));

export async function buildAppMenu() {
  const { build } = require('esbuild');
  const bundle = await build({ stdin: { contents: `import { mountAppMenu } from './packages/app/src/view/index.ts';
    mountAppMenu(document.querySelector('#gear'), {background:document.querySelector('main'),chooseProject:async()=>{},onChosen:()=>{},onError:console.error,
    mountHelp:()=>({open(){},close(){},stop(){}}),checkForUpdates:async()=>({phase:'unavailable',runningBuild:'preview'})});`, resolveDir:root }, bundle:true, platform:'browser', format:'iife',write:false });
  return bundle.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await buildAppMenu();
  if (!code.includes('mountAppMenu')) throw new Error('the app menu bundle no longer mounts mountAppMenu');
  console.log(`Built the app menu for the idle-setting capture (${code.length} bytes).`);
}
