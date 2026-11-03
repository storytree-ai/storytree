// Round 12's six kinds: each of The library's capabilities drawn as the architecture-diagram symbol for what it is, in place
// of round 11's settlement disc. The README says why each capability has the kind it has.
// Shared by the pieces (pieces-tools/icons.mjs) and the island (tools/overlay.ts).

/** Each kind's symbol, in a 24-unit box centred on 0 (y down the page, as SVG): `parts` are closed shapes, each filled then
 * outlined; `lines` are drawn over them, outline only. */
export const GLYPHS = {
  // A database: the cylinder, with one band.
  store: {
    parts: ['M-8 -6.5A8 3 0 0 1 8 -6.5L8 6.5A8 3 0 0 1 -8 6.5Z'],
    lines: ['M-8 -6.5A8 3 0 0 0 8 -6.5', 'M-8 0A8 3 0 0 0 8 0'],
  },
  // A service: the component box, two tabs on its side.
  service: {
    parts: ['M-6 -8H9V8H-6Z', 'M-10 -5H-2V-1.5H-10Z', 'M-10 1.5H-2V5H-10Z'],
    lines: [],
  },
  // A queue: a row of cells.
  queue: {
    parts: ['M-10.5 -5H10.5V5H-10.5Z'],
    lines: ['M-5.25 -5V5', 'M0 -5V5', 'M5.25 -5V5'],
  },
  // An index: the lens.
  index: {
    parts: ['M4 -2A6 6 0 1 1 -8 -2A6 6 0 1 1 4 -2Z'],
    lines: ['M2.3 2.3L9 9'],
  },
  // A connection: the plug.
  link: {
    parts: ['M-6.5 -3H6.5V2Q6.5 7.5 0 7.5Q-6.5 7.5 -6.5 2Z'],
    lines: ['M-3 -3V-9', 'M3 -3V-9', 'M0 7.5V11'],
  },
  // A record or log: a page in front of another, its corner folded.
  log: {
    parts: ['M-4 -10H9V6H-4Z', 'M-9 -6H3L7 -2V10H-9Z'],
    lines: ['M3 -6V-2H7', 'M-6 1H4', 'M-6 5H4'],
  },
};

/** The kind of each of The library's capabilities, by its title's number. */
export const KIND_OF = {
  1: 'store', // Project libraries: a database per project
  2: 'store', // Library transactions: the only writes the store allows
  3: 'store', // Data schema: the store's record types
  4: 'store', // Work model: the plan's tables (arcs, stories, capabilities, contracts)
  5: 'log', // Health record: what was reported and verified, kept per record
  6: 'store', // Knowledge artifacts: the knowledge records' tables
  7: 'service', // Library API: the one list of functions anything outside calls
  8: 'link', // Cloud connection (GCP)
  9: 'index', // Knowledge entrances: the shelves, the way from the work into the knowledge
  10: 'queue', // Work in flight: increments moving proposal, active, closed
  11: 'queue', // Waits: what waits on what
  12: 'queue', // Owner questions: raised, held, settled
  13: 'log', // Decision log: the numbering
  14: 'index', // Ranked search
  15: 'link', // Connection by address
  16: 'service', // The command schema: the shapes every command family is declared with
  17: 'service', // The library's commands
  21: 'index', // Links: finding neighbours by related search
  22: 'log', // Decision log: kept true
  23: 'index', // Catalogue
  24: 'log', // Graduation: promotion writes an artifact
  25: 'queue', // Lapsed questions: the drain
  26: 'queue', // Rounds: the librarian's pass, due at a landing
  27: 'service', // Fixed data questions: a few fixed queries, as commands
};
export const kindOf = title => KIND_OF[Number(String(title).split(' ')[0])] ?? 'service';
export const KIND_NAMES = { store: 'store', service: 'service', queue: 'queue', index: 'index', link: 'connection', log: 'record' };
