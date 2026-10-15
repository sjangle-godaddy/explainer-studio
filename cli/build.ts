#!/usr/bin/env node
// Build episodes into self-contained HTML players.
//   node cli/build.ts episodes/<id>.json [more.json ...]   build the given episodes
//   node cli/build.ts --all                                 build every episode in episodes/
// Options: --report (print scenes, beats and timing), --force (write even if checks fail), --check-only (write nothing)
// Exit code is non-zero if any episode fails validation or checks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { verify } from '../src/checks/index.ts';
import { renderSmoke } from './smoke.ts';
import { EpisodeError, compile } from '../src/runtime/compile.ts';
import type { Episode } from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force'), report = args.includes('--report'), checkOnly = args.includes('--check-only');
let files = args.filter(a => !a.startsWith('--'));
if (args.includes('--all') || (checkOnly && !files.length)) files = fs.readdirSync(path.join(ROOT, 'episodes')).filter(f => f.endsWith('.json')).map(f => path.join(ROOT, 'episodes', f));
if (!files.length) { console.error('usage: node cli/build.ts episodes/<id>.json [...] | --all  [--report] [--force] [--check-only]'); process.exit(2); }

const template = fs.readFileSync(path.join(ROOT, 'src/player/template.html'), 'utf8');
const fontB64 = fs.readFileSync(path.join(ROOT, 'font/BarlowCondensed-Bold.woff2')).toString('base64');
let playerJs: string | null = null;
const bundle = async () => playerJs ??= (await esbuild.build({ entryPoints: [path.join(ROOT, 'src/player/player.ts')], bundle: true, format: 'iife', target: 'es2022', write: false, minify: false, legalComments: 'none' })).outputFiles[0].text;

let failed = 0;
for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  let ep: Episode;
  try { ep = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`\n${rel}: invalid JSON: ${(e as Error).message}`); failed++; continue; }
  const t0 = Date.now();
  let E;
  try { E = compile(ep); } catch (e) {
    console.log(`\n${rel}: FAILED`);
    console.log(e instanceof EpisodeError ? e.problems.map(p => '  - ' + p).join('\n') : '  ' + ((e as Error).stack ?? e));
    failed++; continue;
  }
  const v = verify(E);
  const smoke = renderSmoke(E);
  console.log(`\n${rel}  ->  ${E.title}`);
  console.log(`  ${E.duration.toFixed(1)}s, ${E.scenes.length} scenes, ${E.beats.length} beats, frame ${E.theme.W}x${E.theme.H}, built in ${Date.now() - t0}ms`);
  if (report) for (const sc of E.scenes) {
    console.log(`  scene ${sc.spec.id} [${sc.t0.toFixed(1)}-${sc.t1.toFixed(1)}s] ${sc.spec.layout}: ${sc.spec.blocks.map(b => `${b.id}(${b.type})`).join(', ')}`);
    for (const b of sc.beats) console.log(`    ${b.t0.toFixed(1).padStart(5)}-${b.t1.toFixed(1).padEnd(5)} ${b.spec.id.padEnd(12)} ${b.spec.caption}`);
  }
  console.log(`  checked ${v.stats.samples} frames (every beat start/mid/end + every 0.1s); max labels on screen ${v.stats.maxLabels}, min text gap ${Number.isFinite(v.stats.minTextGap) ? v.stats.minTextGap.toFixed(1) : '-'}px`);
  if (smoke) console.log(`  render error: ${smoke}`);
  const ok = v.ok && !smoke;
  if (!v.ok) for (const f of v.fails.slice(0, 30)) console.log('  - ' + f);
  if (v.fails.length > 30) console.log(`  ... and ${v.fails.length - 30} more`);
  if (checkOnly) { console.log(`  ${ok ? 'PASS' : 'FAIL'}`); if (!ok) failed++; continue; }
  if (ok || force) {
    const playerSrc = (await bundle()).replace(/<\/script/gi, '<\\/script');
    const episodeJs = `window.EPISODE = ${JSON.stringify(ep).replace(/</g, '\\u003c')};\nwindow.FONT_B64 = '${fontB64}';`;
    const html = template
      .replace(/\{\{TITLE\}\}/g, () => E.title.replace(/[<&"]/g, c => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[c]!)))
      .replace('/*{{EPISODE}}*/', () => episodeJs)
      .replace('/*{{PLAYER}}*/', () => playerSrc);
    const out = path.join(ROOT, 'dist', `${E.id}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`  ${ok ? 'PASS' : 'FAIL (written anyway: --force)'}  wrote ${path.relative(process.cwd(), out)}`);
  } else console.log('  FAIL  nothing written (use --force to write anyway)');
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
