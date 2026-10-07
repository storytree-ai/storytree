// Encode the recorded compositor pictures at their observed times (nearest 1/25 second).
// Repeated frames hold the last real picture; no intermediate visual is synthesized.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
const folder = path.resolve(process.argv[2]);
const ffmpeg = process.env.CAPTURE_FFMPEG ?? 'ffmpeg';
const live = process.argv.includes('--live');
const destination = path.join(folder, live ? 'live-roads.webm' : 'normal-selection.webm');
const { screencast } = JSON.parse(readFileSync(path.join(folder, live ? 'normal-measurements.json' : 'measurements.json'), 'utf8'));
assert.ok(screencast.length > 1, 'capture compositor frames before encoding');
const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-r', '25',
  '-c:v', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libvpx', '-b:v', '1600k', destination],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const completion = once(encoder, 'exit');
const start = screencast[0].timestamp;
const end = screencast.at(-1).timestamp + 0.4;
let index = 0;
for (let frame = 0; start + frame / 25 < end; frame++) {
  while (index + 1 < screencast.length && screencast[index + 1].timestamp <= start + frame / 25) index++;
  const bytes = readFileSync(path.join(folder, 'normal-frames', screencast[index].name));
  if (!encoder.stdin.write(bytes)) await once(encoder.stdin, 'drain');
}
encoder.stdin.end();
const [code] = await completion;
assert.equal(code, 0, 'ffmpeg completed');
console.log(destination);
