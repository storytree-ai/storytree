/** Capability 1 · Home page. */
import { OPENING_SEED, mulberry32 } from "./opening-seed.js";

const MASTER_GAIN = 0.15;

/**
 * Chapter 1's sound, all synthesized (0.2's palette): a filtered-noise typing tick throttled to one per 65 ms,
 * a square-wave power-on thump for a window, and a two-partial bell when a demand parks. Nothing exists until
 * the visitor turns sound on: `unlock` is called from that click and creates the context.
 */
export function createOpeningAudio() {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let lastTick = -Infinity;

  const unlock = () => {
    if (context) { void context.resume().catch(() => {}); return; }
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = MASTER_GAIN;
    const compressor = context.createDynamicsCompressor();
    master.connect(compressor).connect(context.destination);
    const rand = mulberry32(OPENING_SEED ^ 0x0badcafe);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    void context.resume().catch(() => {});
  };
  const close = () => {
    const closing = context;
    context = undefined; master = undefined; noise = undefined;
    if (closing) void closing.close().catch(() => {});
  };
  const tick = (detune: number) => {
    if (!context || !master || !noise) return;
    const now = performance.now();
    if (now - lastTick < 65) return;
    lastTick = now;
    const t = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.playbackRate.value = 0.8 + detune * 0.7;
    const band = context.createBiquadFilter();
    band.type = "bandpass"; band.frequency.value = 1500 + detune * 1400; band.Q.value = 2.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    source.connect(band).connect(gain).connect(master);
    source.start(t, detune * 0.5, 0.06); source.stop(t + 0.07);
  };
  const blip = () => {
    if (!context || !master) return;
    const t = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(70, t);
    oscillator.frequency.exponentialRampToValueAtTime(180, t + 0.09);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    oscillator.connect(gain).connect(master);
    oscillator.start(t); oscillator.stop(t + 0.18);
  };
  const bell = (detune: number) => {
    if (!context || !master) return;
    const t = context.currentTime;
    for (const [frequency, amplitude] of [[740 + detune * 240, 0.05], [1480 + detune * 480, 0.02]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(amplitude, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      oscillator.connect(gain).connect(master);
      oscillator.start(t); oscillator.stop(t + 0.95);
    }
  };
  const setOn = (on: boolean) => {
    if (!context || !master) return;
    master.gain.value = on ? MASTER_GAIN : 0;
    if (on) void context.resume().catch(() => {}); else void context.suspend().catch(() => {});
  };
  return { unlock, close, tick, blip, bell, setOn };
}
