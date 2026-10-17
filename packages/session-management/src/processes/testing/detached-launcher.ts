import { launchOwned } from '../index.js';
const result = await launchOwned({
  home: process.argv[2]!, folder: process.cwd(), owner: { session: 'detached-owner', harness: 'codex' },
  command: process.execPath, args: ['-e', 'setTimeout(() => {}, 30000)'],
});
process.stdout.write(JSON.stringify(result));
