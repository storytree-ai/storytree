
export const GLYPHS = {
  store: {
    parts: ['M-8 -6.5A8 3 0 0 1 8 -6.5L8 6.5A8 3 0 0 1 -8 6.5Z'],
    lines: ['M-8 -6.5A8 3 0 0 0 8 -6.5', 'M-8 0A8 3 0 0 0 8 0'],
  },
  service: {
    parts: ['M-6 -8H9V8H-6Z', 'M-10 -5H-2V-1.5H-10Z', 'M-10 1.5H-2V5H-10Z'],
    lines: [],
  },
  queue: {
    parts: ['M-10.5 -5H10.5V5H-10.5Z'],
    lines: ['M-5.25 -5V5', 'M0 -5V5', 'M5.25 -5V5'],
  },
  index: {
    parts: ['M4 -2A6 6 0 1 1 -8 -2A6 6 0 1 1 4 -2Z'],
    lines: ['M2.3 2.3L9 9'],
  },
  link: {
    parts: ['M-6.5 -3H6.5V2Q6.5 7.5 0 7.5Q-6.5 7.5 -6.5 2Z'],
    lines: ['M-3 -3V-9', 'M3 -3V-9', 'M0 7.5V11'],
  },
  log: {
    parts: ['M-4 -10H9V6H-4Z', 'M-9 -6H3L7 -2V10H-9Z'],
    lines: ['M3 -6V-2H7', 'M-6 1H4', 'M-6 5H4'],
  },
};

export const KIND_OF = {
  1: 'store',
  2: 'store',
  3: 'store',
  4: 'store',
  5: 'log',
  6: 'store',
  7: 'service',
  8: 'link',
  9: 'index',
  10: 'queue',
  11: 'queue',
  12: 'queue',
  13: 'log',
  14: 'index',
  15: 'link',
  16: 'service',
  17: 'service',
  21: 'index',
  22: 'log',
  23: 'index',
  24: 'log',
  25: 'queue',
  26: 'queue',
  27: 'service',
};
export const kindOf = title => KIND_OF[Number(String(title).split(' ')[0])] ?? 'service';
export const KIND_NAMES = { store: 'store', service: 'service', queue: 'queue', index: 'index', link: 'connection', log: 'record' };
