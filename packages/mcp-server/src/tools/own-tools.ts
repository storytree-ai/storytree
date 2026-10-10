/** Capability 6 · Agent tools (the MCP server). Ledger doors: identity is resolved by the server; all-session inspection needs no library. */
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { listRuns, renderInventory } from '@storytree/processes/listing';
import { clearOwned, readClosing, renderClosing } from '@storytree/processes/closing';
import type { SharedWork } from '@storytree/processes/listing';
import { stopOwned } from '@storytree/processes/stopping';
import type { RunOwner } from '@storytree/processes';
import { z } from 'zod';
import { refusalOf, result, type Answer } from './answers.js';

export const OWN_TOOLS = ['list_own_runs', 'list_all_runs', 'stop_own_run', 'clear_own_runs'];

export function registerOwnTools(options: {
  server: McpServer;
  home?: string;
  owner(context: ServerContext): Promise<RunOwner | undefined>;
  shared(): readonly SharedWork[];
}): void {
  const ledger = options.home === undefined ? {} : { home: options.home };
  const define = <S extends z.ZodObject>(name: string, description: string, inputSchema: S,
    act: (args: z.output<S>, owner: RunOwner | undefined) => Promise<Answer>) => {
    options.server.registerTool(name, { description, inputSchema }, (async (args: z.output<S>, context: ServerContext) => {
      try {
        // All-session inspection is available even if the library cannot resolve this caller.
        const owner = name === 'list_all_runs' ? undefined : await options.owner(context);
        if (name !== 'list_all_runs' && (!owner || owner.agent === 'unknown')) {
          throw new Error('This needs a resolved session identity and calling agent; use list_all_runs (or storytree processes --all) for read-only attribution.');
        }
        return result(await act(args, owner));
      }
      catch (error) { return result({ text: refusalOf(error), refused: true }); }
    }) as never);
  };
  for (const [name, scope] of [['list_own_runs', 'self'], ['list_all_runs', 'all']] as const) {
    define(name, scope === 'self' ? 'List this caller’s recorded work, offline.' : 'List all recorded sessions on this computer, offline; grants no additional stop authority.',
      z.object({}).strict(), async (_args, owner) => {
        const inventory = await listRuns({ ...ledger, scope, shared: options.shared(), ...(owner ? { owner } : {}),
          stopAction: run => ({ tool: 'stop_own_run', arguments: { runs: [run] } }),
        });
        return { text: renderInventory(inventory), data: { inventory } };
      });
  }
  define('stop_own_run', 'Stop named registered run UUIDs within this caller’s ownership; report every outcome and retain records.',
    z.object({ runs: z.array(z.string()).min(1) }).strict(), async ({ runs }, owner) => {
      const stopped = await stopOwned({ ...ledger, owner: owner!, targets: runs });
      return { text: JSON.stringify(stopped, null, 2), data: { result: stopped }, refused: !stopped.ok };
    });
  define('clear_own_runs', 'Remove only the caller’s confirmed-gone run records, without signals; report removed, retained, failed and gaps separately, then read all remaining work.',
    z.object({}).strict(), async (_args, owner) => {
      const clear = await clearOwned({ ...ledger, owner: owner! });
      const closing = await readClosing({ ...ledger, owner: owner!, knownGaps: clear.gaps, shared: options.shared() });
      return { text: `${JSON.stringify(clear, null, 2)}\n${renderClosing(closing)}`, data: { clear, closing },
        refused: clear.failed.length > 0 || clear.gaps.length > 0 };
    });

}
