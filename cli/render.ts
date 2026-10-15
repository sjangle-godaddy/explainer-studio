#!/usr/bin/env node
// Render an episode to MP4 in Node: the same renderer as the player, drawn on a Skia canvas, piped to FFmpeg.
//   node cli/render.ts episodes/<id>.json [--full] [--from <s>] [--to <s>]
// --full renders 1080 x 1920 with the face-cam area left dark; the default is the 1080 x 1280 animation panel.
// The episode must pass the build checks first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { verify } from '../src/checks/index.ts';
import { drawFrame, type Ctx } from '../src/render/draw.ts';
import { EpisodeError, compile } from '../src/runtime/compile.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find(a => a.endsWith('.json'));
if (!file) { console.error('usage: node cli/render.ts episodes/<id>.json [--full] [--from <s>] [--to <s>]'); process.exit(2); }
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? parseFloat(args[i + 1]) : undefined; };
const full = args.includes('--full');

let E;
try { E = compile(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) {
  console.error(e instanceof EpisodeError ? e.problems.map(p => '- ' + p).join('\n') : e);
  process.exit(1);
}
const v = verify(E);
if (!v.ok) { console.error(`checks failed, run "node cli/build.ts ${file}" first:\n` + v.fails.slice(0, 10).map(f => '- ' + f).join('\n')); process.exit(1); }

const th = E.theme;
GlobalFonts.registerFromPath(path.join(ROOT, 'font/BarlowCondensed-Bold.woff2'), th.font.family);
const W = th.W, H = full ? th.fullH : th.H, fps = th.fps;
const from = Math.max(0, opt('--from') ?? 0), to = Math.min(E.duration, opt('--to') ?? E.duration);
const first = Math.round(from * fps), last = Math.round(to * fps);
const out = path.join(ROOT, 'dist', `${E.id}-${W}x${H}-${fps}fps.mp4`);
fs.mkdirSync(path.dirname(out), { recursive: true });

// ffmpeg may print one "Truncating packet" line while it probes the pipe; frames are still aligned
// (checked by decoding frames back and diffing them against fresh renders).
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const exited = new Promise<number>(res => ff.on('close', code => res(code ?? 1)));

const canvas = createCanvas(W, H), ctx = canvas.getContext('2d') as unknown as Ctx;
const t0 = Date.now();
for (let i = first; i < last; i++) {
  const t = i / fps;
  drawFrame(ctx, th, E.frame(t), t, full ? 'full' : 'panel');
  const data = (ctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, W, H).data;
  if (!ff.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) await new Promise(r => ff.stdin.once('drain', r));
  if ((i - first) % (fps * 5) === 0) process.stdout.write(`\r  frame ${i - first + 1} / ${last - first}`);
}
ff.stdin.end();
const code = await exited;
if (code !== 0) { console.error(`\nffmpeg exited with code ${code}`); process.exit(1); }
console.log(`\r  wrote ${path.relative(process.cwd(), out)}: ${last - first} frames, ${W} x ${H}, ${fps} fps, ${((last - first) / fps).toFixed(1)}s, rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
