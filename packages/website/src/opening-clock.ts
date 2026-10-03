import { OPENING_SEED, mulberry32 } from "./opening-seed.js";

// ADR-0888 1.2-1.3: storytree 0.2's escalating clock (its storm-script.ts). The lead agent thinks for about
// 4 s, then helpers open 4.1 s apart, the gaps shrinking to about 1.05 s, and their lines come unhurried early
// (1.35× the base gap) and frantic late (0.8×), so the first jokes read whole and the pile-up does not.
// All times are milliseconds after Run, a pure function of the seed computed at build: every visitor sees the same scene.
const FIRST_SPAWN_AT = 4000;
const ANNOUNCE_LEAD = 700; // a parent prints "spawning helper" this long before the window opens
const PEAK_HOLD = 900; //     and never parks sooner than this after announcing
const FINALE_BEAT = 1750; //  from the lead agent parking to the finale window

export type HelperClock = { spawn: number; announce: number; parent: number; lines: number[]; park: number };

export function openingClock(helpers: readonly { l: readonly string[] }[], thinking: number) {
  const rand = mulberry32(OPENING_SEED ^ 0xc10c);
  const n = helpers.length;
  const think: number[] = [];
  let thinkAt = 380;
  for (let i = 0; i < thinking; i++) { think.push(Math.round(thinkAt)); thinkAt += 560 + rand() * 240; }

  const spawns: number[] = [];
  let clock = FIRST_SPAWN_AT;
  for (let i = 0; i < n; i++) {
    spawns.push(Math.round(clock));
    const k = n === 1 ? 1 : i / (n - 1);
    clock += (4100 - 3050 * k) * (0.92 + rand() * 0.16);
  }
  const clocks: HelperClock[] = helpers.map((helper, i) => {
    // The first two are the lead agent's; the rest are spawned by a recent sibling (-1 is the lead agent).
    const back = 1 + Math.floor(rand() * 3);
    const parent = i < 2 || i - back - 1 < 0 ? -1 : i - back;
    const scale = 1.35 - 0.55 * (n === 1 ? 1 : i / (n - 1));
    let at = spawns[i]! + 240;
    const lines = helper.l.map(() => (at += Math.round((420 + rand() * 620) * scale)));
    return { spawn: spawns[i]!, announce: spawns[i]! - ANNOUNCE_LEAD, parent, lines, park: at + Math.round(620 + rand() * 480) };
  });
  // A parked window never keeps talking: a parent holds its question until after its last announcement.
  clocks.forEach(child => {
    const parent = clocks[child.parent];
    if (parent && parent.park < child.announce + PEAK_HOLD) parent.park = child.announce + PEAK_HOLD + Math.round(rand() * 500);
  });
  const quiet = Math.max(...clocks.map(helper => helper.park));
  const lead = Math.max(quiet, think.at(-1)! + 1200) + 900;
  return { think, helpers: clocks, quiet, lead, finale: lead + FINALE_BEAT };
}
export type OpeningClock = ReturnType<typeof openingClock>;
