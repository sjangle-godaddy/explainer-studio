// Browser player: playback, scrubber, beat picker, safe-zone overlay and MP4/WebM export.
// Bundled by cli/build.ts into each episode's self-contained HTML. Expects window.EPISODE and window.FONT_B64.
import { compile } from '../runtime/compile.ts';
import { drawFrame } from '../render/draw.ts';
import type { Episode } from '../types.ts';

declare global {
  interface Window { EPISODE: Episode; FONT_B64: string; Mp4Muxer: any; render(t: number): void; }
}

const E = compile(window.EPISODE);
const th = E.theme;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLCanvasElement>('stage'), wrap = $('stageWrap');
const scrub = $<HTMLInputElement>('scrub'), playBtn = $<HTMLButtonElement>('play'), sceneSel = $<HTMLSelectElement>('scene'), frameSel = $<HTMLSelectElement>('frame');
let ctx = stage.getContext('2d')!;
let time = 0, playing = false, last = 0, frame: 'panel' | 'full' = 'panel';

$('title').textContent = E.title;
scrub.max = String(E.duration);
for (const b of E.beats) {
  const o = document.createElement('option');
  o.value = String(b.t0); o.textContent = `${b.spec.name ?? b.spec.id} (${b.t0.toFixed(1)}s)`;
  sceneSel.appendChild(o);
}

const render = (c: CanvasRenderingContext2D, t: number) => drawFrame(c, th, E.frame(t), t, frame);
window.render = t => render(ctx, t);

const frameHeight = () => frame === 'full' ? th.fullH : th.H;
function setFrame(f: 'panel' | 'full') {
  frame = f;
  stage.width = th.W; stage.height = frameHeight();
  ctx = stage.getContext('2d')!;
  wrap.style.setProperty('--ar', String(frameHeight() / th.W));
  wrap.style.setProperty('--ar-css', `${th.W} / ${frameHeight()}`);
  wrap.classList.toggle('full', f === 'full');
  const [x0, y0, x1, y1] = th.safe, fh = frameHeight();
  Object.assign($('safe').style, { left: `${x0 / th.W * 100}%`, top: `${y0 / fh * 100}%`, width: `${(x1 - x0) / th.W * 100}%`, height: `${(y1 - y0) / fh * 100}%` });
  $('facecam').style.height = `${(th.fullH - th.H) / th.fullH * 100}%`;
  draw();
}
function setTime(t: number) { time = Math.max(0, Math.min(E.duration, t)); draw(); }
function draw() {
  render(ctx, time);
  scrub.value = String(time);
  $('time').textContent = `${time.toFixed(2)} / ${E.duration.toFixed(2)}`;
  const b = E.beatAt(time), sc = E.scenes[b.scene];
  if (sceneSel.value !== String(b.t0)) sceneSel.value = String(b.t0);
  $('nBeat').textContent = `${b.spec.name ?? b.spec.id}  [${b.t0.toFixed(1)}s - ${b.t1.toFixed(1)}s]  caption: ${b.spec.caption}`;
  $('nLine').textContent = b.spec.line;
  $('nBlocks').textContent = `${sc.spec.layout}: ` + sc.spec.blocks.map(x => `${x.id} (${x.type})`).join(', ');
  const f = b.spec.focus;
  $('nFocus').textContent = !f || f === 'all' ? 'all' : f.join(', ') + '  (everything else dims)';
  $('nFlows').textContent = (b.spec.flows ?? []).map(x => `${x.route.join(' > ')}${x.reverse ? ' (reverse)' : ''}${x.blockAt ? ` blocked at ${x.blockAt}` : ''}`).join('\n') || 'none';
}
function loop(now: number) {
  if (!playing) return;
  // ignore a negative first delta and big jumps after the tab was in the background
  time += Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (time >= E.duration) { time = E.duration; pause(); }
  draw();
  if (playing) requestAnimationFrame(loop);
}
function play() { if (time >= E.duration) time = 0; playing = true; playBtn.textContent = 'Pause'; last = performance.now(); requestAnimationFrame(loop); }
function pause() { playing = false; playBtn.textContent = 'Play'; }
const toggle = () => playing ? pause() : play();
const beatStep = (d: number) => {
  const i = E.beats.indexOf(E.beatAt(time));
  setTime(E.beats[Math.max(0, Math.min(E.beats.length - 1, i + d))].t0);
};

playBtn.onclick = toggle;
$('restart').onclick = () => { setTime(0); play(); };
scrub.oninput = () => { pause(); setTime(parseFloat(scrub.value)); };
sceneSel.onchange = () => { pause(); setTime(parseFloat(sceneSel.value)); };
frameSel.onchange = () => setFrame(frameSel.value as 'panel' | 'full');
const safeToggle = $<HTMLInputElement>('safeToggle');
safeToggle.onchange = () => wrap.classList.toggle('show-safe', safeToggle.checked);
// keep Space for play/pause instead of re-clicking the last button
document.addEventListener('click', e => { if ((e.target as HTMLElement).tagName === 'BUTTON') (e.target as HTMLElement).blur(); });
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target as HTMLInputElement;
  if ((tg.tagName === 'SELECT' || tg.type === 'range') && e.code !== 'Space') return;
  if (e.code === 'Space') { e.preventDefault(); tg.blur?.(); toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); setTime(time - (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); setTime(time + (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pause(); beatStep(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); pause(); beatStep(1); }
  else if (e.key === 'Home') { e.preventDefault(); setTime(0); }
  else if (e.key === 's' || e.key === 'S') { safeToggle.checked = !safeToggle.checked; safeToggle.onchange?.(new Event('change')); }
});

// ---------- export (canvas only, never the page chrome or overlays) ----------
const status = $('exportStatus');
const buttons = ['mp4', 'webm'].map(id => $<HTMLButtonElement>(id));
const busy = (on: boolean) => { buttons.forEach(b => b.disabled = on); frameSel.disabled = on; };
const makeCanvas = () => { const c = document.createElement('canvas'); c.width = th.W; c.height = frameHeight(); return c; };
const fileBase = () => `${E.id}-${th.W}x${frameHeight()}-${th.fps}fps`;
function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const loadScript = (src: string) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });

async function exportMp4() {
  let encoder: VideoEncoder | null = null;
  if (!('VideoEncoder' in window)) { status.textContent = 'This browser has no WebCodecs encoder. Use Record WebM, or run npm run render.'; return; }
  pause(); busy(true); status.className = 'status';
  try {
    status.textContent = 'Loading MP4 muxer...';
    if (!window.Mp4Muxer) await loadScript('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js');
    const W = th.W, H = frameHeight(), fps = th.fps;
    let config: VideoEncoderConfig | null = null;
    for (const codec of ['avc1.640032', 'avc1.4d0032', 'avc1.42e032', 'avc1.640028']) {
      const c: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 12_000_000, framerate: fps, avc: { format: 'avc' } };
      if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
    }
    if (!config) throw new Error(`no supported H.264 configuration for ${W} x ${H}`);
    const M = window.Mp4Muxer;
    const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
    let encErr: unknown = null;
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
    encoder.configure(config);
    const canvas = makeCanvas(), c2 = canvas.getContext('2d')!;
    const frames = Math.round(E.duration * fps);
    for (let i = 0; i < frames; i++) {
      if (encErr) throw encErr;
      render(c2, i / fps);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
      if (i % 15 === 0) { status.textContent = `Encoding MP4 (keep this tab visible): frame ${i + 1} / ${frames}`; await new Promise(r => setTimeout(r, 0)); }
    }
    await encoder.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    save(new Blob([muxer.target.buffer], { type: 'video/mp4' }), fileBase() + '.mp4');
    status.textContent = `MP4 ready: ${frames} frames, ${W} x ${H}, ${fps} fps, silent (${config.codec}).`;
  } catch (e) {
    status.textContent = 'MP4 export failed: ' + (e as Error).message + '. Record WebM still works.';
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    busy(false);
  }
}

async function recordWebm() {
  pause(); busy(true); status.className = 'status';
  try {
    const canvas = makeCanvas(), c2 = canvas.getContext('2d')!, fps = th.fps;
    render(c2, 0);
    const stream = canvas.captureStream(0), track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    rec.start();
    const frames = Math.round(E.duration * fps), t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      render(c2, i / fps);
      track.requestFrame();
      const wait = t0 + (i + 1) * 1000 / fps - performance.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (i % 15 === 0) status.textContent = `Recording WebM in real time (keep this tab visible): ${(i / fps).toFixed(1)}s / ${E.duration.toFixed(1)}s`;
    }
    await new Promise(r => setTimeout(r, 1000 / fps)); // let the last frame land before stopping
    rec.stop(); await done;
    save(new Blob(chunks, { type: 'video/webm' }), fileBase() + '.webm');
    status.textContent = 'WebM ready (canvas only, silent).';
  } catch (e) {
    status.textContent = 'WebM recording failed: ' + (e as Error).message;
  } finally { busy(false); }
}

$('mp4').onclick = exportMp4;
$('webm').onclick = recordWebm;

(async function boot() {
  try {
    const face = new FontFace(th.font.family, `url(data:font/woff2;base64,${window.FONT_B64})`, { weight: '700' });
    await face.load();
    document.fonts.add(face);
  } catch (e) { console.warn('embedded font failed to load, using fallback', e); }
  $('layoutStatus').textContent = `${E.scenes.length} scenes, ${E.beats.length} beats, ${E.duration.toFixed(1)}s. Checks ran at build time.`;
  // browsers can restore form state on reload, so start from what the controls show
  setFrame(frameSel.value as 'panel' | 'full');
  safeToggle.onchange?.(new Event('change'));
})();
