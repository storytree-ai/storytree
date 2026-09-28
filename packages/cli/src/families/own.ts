import { locateStorytree } from '@storytree/agent-link';
import { Refusal } from '../answer.js';
import type { Family } from '../door.js';
import { commandSession } from '../writer.js';

export const own: Family = {
  name: 'own', summary: 'see recorded work on this computer and stop your own runs',
  bare: {
    name: '', usage: 'own [--all]', summary: 'list this session’s work, or every recorded session with --all', switches: ['all'],
    async act(args) {
      if (args.words.length || args.names.some(name => name !== 'all')) {
        throw new Refusal('usage: storytree own [--all]', { code: 2 });
      }
      const owner = caller();
      const { listRuns, renderInventory } = await import('@storytree/own/listing');
      const inventory = await listRuns({ scope: args.has('all') ? 'all' : 'self', ...(owner ? { owner } : {}),
        stopAction: run => ({ command: `storytree own stop ${run}` }),
        shared: sharedWork(),
      });
      return { text: renderInventory(inventory) };
    },
  },
  verbs: [{
    name: 'stop', usage: 'own stop <run…>', summary: 'stop named registered runs within this caller’s authority',
    async act(args) {
      if (!args.words.length || args.names.length) throw new Refusal('usage: storytree own stop <run…>', { code: 2 });
      const owner = caller();
      if (!owner) throw new Refusal('storytree own stop needs a session identity from the calling harness; use storytree own --all to inspect work.');
      const { stopOwned } = await import('@storytree/own/stopping');
      const stopped = await stopOwned({ owner, targets: args.words });
      const text = JSON.stringify(stopped, null, 2);
      if (!stopped.ok) throw new Refusal(text);
      return { text };
    },
  }, {
    name: 'clear', usage: 'own clear', summary: 'remove only your confirmed-gone records, then read what remains on this computer',
    async act(args) {
      if (args.words.length || args.names.length) throw new Refusal('usage: storytree own clear', { code: 2 });
      const owner = caller();
      if (!owner) throw new Refusal('storytree own clear needs a session identity from the calling harness; use storytree own --all to inspect work.');
      const { clearOwned, readClosing } = await import('@storytree/own/closing');
      const clear = await clearOwned({ owner });
      const closing = await readClosing({ owner, knownGaps: clear.gaps, shared: sharedWork() });
      const text = JSON.stringify({ clear, closing }, null, 2);
      if (clear.failed.length || clear.gaps.length) throw new Refusal(text);
      return { text };
    },
  }],
};

/** Conflicting harness signals cannot silently pick one session’s authority. */
function caller() {
  if (process.env.CLAUDE_CODE_SESSION_ID?.trim() && process.env.CODEX_THREAD_ID?.trim()) return undefined;
  return commandSession();
}

function sharedWork() {
  const lifecycle = locateStorytree();
  return [{ name: 'storytree app and database', state: 'unknown' as const,
    reason: `The app lifecycle reports the database ${lifecycle.running ? 'running' : 'not running'}; it supplies no native lifetime or separate app identity. This shared work is managed by the app; use storytree app status or storytree app quit.` }];
}
