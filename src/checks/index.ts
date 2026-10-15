// Build checks. They run on display lists in Node (no browser), at every beat start/middle/end and every 0.1 s.
// Every failure names the beat and time and says how to fix it.
import { elBox, type Compiled } from '../runtime/compile.ts';
import type { El, LabelEl, TextEl } from '../types.ts';
import { boxCenter, containsBox, contrast, inter, inset, segHitsBox, wordCount } from '../util.ts';

export interface CheckResult { ok: boolean; fails: string[]; stats: Record<string, number>; }

type Texty = LabelEl | TextEl;
const isText = (e: El): e is Texty => e.kind === 'label' || e.kind === 'text';
const visible = (e: El, min = 0.5) => e.alpha >= min;

export function sampleTimes(E: Compiled): number[] {
  const ts = new Set<number>();
  for (const b of E.beats) for (const t of [b.t0 + 0.02, (b.t0 + b.t1) / 2, b.t1 - 0.02]) ts.add(+t.toFixed(3));
  for (let t = 0; t <= E.duration; t += 0.1) ts.add(+t.toFixed(3));
  return [...ts].sort((a, b) => a - b);
}

export function verify(E: Compiled): CheckResult {
  const th = E.theme, fails: string[] = [], seen = new Set<string>();
  const at = (t: number) => { const b = E.beatAt(t); return `beat "${b.spec.id}" @${t.toFixed(1)}s`; };
  const fail = (key: string, msg: string) => { if (!seen.has(key)) { seen.add(key); fails.push(msg); } };
  const times = sampleTimes(E);
  const stats = { samples: times.length, minTextGap: Infinity, maxLabels: 0 };
  const firstSeen = new Map<string, number>(), lastSeen = new Map<string, number>();
  let prev: Map<string, [number, number]> | null = null, prevT = 0;

  // Elements from the previous scene (gliding to a new place or fading out) may pass others during the
  // transition; overlap rules apply to them once they settle. Anything new to the scene is always checked.
  const glideSets = E.scenes.map((_, i) => E.glidingIds(i));
  const glidingAt = (t: number) => { const i = E.scenes.findIndex(sc => t >= sc.t0 && t < sc.t0 + th.transition); return i > 0 ? glideSets[i] : null; };

  for (const t of times) {
    const els = E.frame(t), glide = glidingAt(t);
    const moving = (e: El) => !!glide && glide.has(e.id);
    const texts = els.filter(isText).filter(e => visible(e));
    const nodes = els.filter(e => e.kind === 'node' && visible(e, 0.3));
    const packets = els.filter(e => e.kind === 'packet' || e.kind === 'mark');

    for (const e of els) {
      for (const [k, v] of Object.entries(e)) if (typeof v === 'number' && !Number.isFinite(v) && k !== 'z') fail(`nan:${e.id}`, `${at(t)}: element "${e.id}" has a non-finite ${k} -> bug in its block`);
    }
    // safe zone and minimum size (shapes too, once they are clearly visible)
    for (const e of els) {
      if (isText(e) || e.kind === 'link' || e.kind === 'ring' || e.kind === 'zone' || !visible(e)) continue;
      const b = elBox(th, e);
      if (b && !containsBox(inset(th.safe, -2), b)) fail(`safeshape:${e.id}`, `${at(t)}: "${e.id}" (${e.kind}) leaves the safe zone -> move it or give its block a smaller slot`);
    }
    for (const e of texts) {
      if (!containsBox(th.safe, e.box)) fail(`safe:${e.id}`, `${at(t)}: text "${textOf(e)}" (${e.id}) leaves the safe zone -> move or shorten it`);
      const px = e.kind === 'label' ? e.size * e.scale : e.size;
      if (px < th.type.minPx - 0.01) fail(`size:${e.id}`, `${at(t)}: text "${textOf(e)}" is ${px.toFixed(0)} px, below the ${th.type.minPx} px minimum -> give it more room`);
    }
    // text must not overlap text, nodes (other than its own) or packets
    const boxes = texts.map(e => e.box);
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (moving(a) || moving(b)) continue;
      if (a.owner && a.owner === b.owner && a.kind === 'text') continue; // lines of one card or row are laid out together
      if (inter(boxes[i], boxes[j], -1)) fail(`tt:${a.id}:${b.id}`, `${at(t)}: "${textOf(a)}" overlaps "${textOf(b)}" -> move one of them (label "side", node x/y) or shorten the text`);
    }
    for (const e of texts) {
      if (e.kind !== 'label' || e.id.startsWith('caption:')) continue;
      for (const n of nodes) {
        if (n.owner === e.owner || moving(e) || moving(n)) continue;
        const nb = elBox(th, n)!;
        if (inter(e.box, inset(nb, 6))) fail(`tn:${e.id}:${n.id}`, `${at(t)}: label "${textOf(e)}" covers node "${n.id}" -> change the label "side" or move the node`);
      }
      for (const p of packets) if (!moving(e) && !moving(p) && inter(e.box, elBox(th, p)!, -2)) fail(`tp:${e.id}`, `${at(t)}: a packet passes under label "${textOf(e)}" -> move the label to another "side" or move the route`);
    }
    // links may only touch their own ends (mesh lines are allowed to cross)
    for (const l of els) {
      if (l.kind !== 'link' || l.mayCross || !visible(l, 0.3) || l.progress < 0.99) continue;
      for (const n of nodes) {
        if (moving(l) || moving(n)) continue;
        if (l.ends?.includes(n.owner ?? '') || l.ends?.includes(n.id)) continue;
        const nb = inset(elBox(th, n)!, 8);
        for (let s = 1; s < l.pts.length; s++) if (segHitsBox(l.pts[s - 1], l.pts[s], nb)) { fail(`ln:${l.id}:${n.id}`, `${at(t)}: line "${l.id}" passes through "${n.id}" -> move one of them or add "${n.id}" to the route`); break; }
      }
    }
    // text contrast against whatever is under its centre
    for (const e of texts) {
      if (e.kind !== 'text') continue;
      const under = topFillUnder(els, e, th);
      const c = contrast(e.color, under);
      if (c < 3) fail(`ct:${e.id}`, `${at(t)}: "${textOf(e)}" has contrast ${c.toFixed(2)} against ${under} -> use a lighter role`);
    }
    // clutter
    const labelCount = texts.filter(e => e.kind === 'label' && !e.id.startsWith('caption:')).length;
    stats.maxLabels = Math.max(stats.maxLabels, labelCount);
    if (labelCount > th.limits.maxLabels) fail(`clutter:${E.beatAt(t).spec.id}`, `${at(t)}: ${labelCount} labels on screen (limit ${th.limits.maxLabels}) -> name fewer things or split the scene`);
    // reading time bookkeeping and motion budget
    const pos = new Map<string, [number, number]>();
    for (const e of els) {
      if (isText(e) && visible(e)) { if (!firstSeen.has(e.id)) firstSeen.set(e.id, t); lastSeen.set(e.id, t); }
      if (e.kind === 'packet' || e.kind === 'ring' || e.kind === 'mark') continue;
      const b = elBox(th, e);
      if (b) pos.set(e.id, boxCenter(b));
    }
    if (prev && t - prevT > 0.05) {
      for (const [id, p] of pos) {
        const q = prev.get(id);
        if (!q) continue;
        const v = Math.hypot(p[0] - q[0], p[1] - q[1]) / (t - prevT);
        if (v > th.limits.maxSpeed) fail(`speed:${id}`, `${at(t)}: "${id}" moves at ${Math.round(v)} px/s (limit ${th.limits.maxSpeed}) -> keep it closer to where it was in the previous scene`);
      }
    }
    prev = pos; prevT = t;
    for (const e of texts) for (const o of texts) if (e !== o && e.box && o.box) {
      const g = Math.max(o.box[0] - e.box[2], e.box[0] - o.box[2], o.box[1] - e.box[3], e.box[1] - o.box[3]);
      if (g >= 0) stats.minTextGap = Math.min(stats.minTextGap, g);
    }
  }

  // reading time: every label that appears must stay long enough to read
  for (const [id, t0] of firstSeen) {
    if (id.startsWith('caption:')) continue;
    const shown = lastSeen.get(id)! - t0 + 0.1;
    if (shown < 1.2 && lastSeen.get(id)! < E.duration - 0.2) fail(`read:${id}`, `"${id}" is readable for only ${shown.toFixed(1)}s (from ${t0.toFixed(1)}s) -> keep it on screen longer`);
  }
  for (const b of E.beats) {
    if (b.t1 - b.t0 < th.limits.minCaption) fail(`cap:${b.spec.id}`, `beat "${b.spec.id}" lasts ${(b.t1 - b.t0).toFixed(1)}s, below the ${th.limits.minCaption}s minimum for a caption -> merge it with a neighbour`);
  }
  coverage(E, fail);
  deadAir(E, fail);
  determinism(E, fail);
  return { ok: fails.length === 0, fails, stats };
}

const textOf = (e: Texty) => e.kind === 'label' ? e.lines.join(' ') : e.text;

function topFillUnder(els: El[], e: TextEl, th: Compiled['theme']): string {
  const c = boxCenter(e.box);
  let fill = th.page[1];
  for (const o of els) {
    if (o.z >= e.z || !(o.alpha > 0.002)) continue; // a dimmed panel is still what the text sits on
    if ((o.kind === 'panel' || o.kind === 'zone') && c[0] >= o.box[0] && c[0] <= o.box[2] && c[1] >= o.box[1] && c[1] <= o.box[3]) fill = o.fill.startsWith('#') ? o.fill : fill;
  }
  return fill;
}

/** Every word of a caption that is also a visible label must be in focus while that beat runs. */
function coverage(E: Compiled, fail: (k: string, m: string) => void) {
  for (const b of E.beats) {
    const mid = (b.t0 + b.t1) / 2, els = E.frame(mid);
    const words = new Set(b.spec.caption.toUpperCase().split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)));
    const labelled = els.filter((e): e is LabelEl => e.kind === 'label' && !e.id.startsWith('caption:'));
    const named = labelled.filter(l => l.lines.join(' ').toUpperCase().split(/\s+/).some(w => words.has(w)));
    if (named.length && !named.some(l => l.alpha >= 0.9)) fail(`cov:${b.spec.id}`, `beat "${b.spec.id}": the caption names ${named.map(l => `"${l.lines.join(' ')}"`).join(', ')} but none of them is in focus -> add the owner id to "focus"`);
    const anything = els.some(e => e.kind !== 'label' || !e.id.startsWith('caption:'));
    if (!anything) fail(`empty:${b.spec.id}`, `beat "${b.spec.id}": nothing but the caption is on screen -> show something`);
    if (wordCount(b.spec.line) === 0) fail(`line:${b.spec.id}`, `beat "${b.spec.id}" has no spoken line`);
  }
}
const STOP = new Set(['THE', 'AND', 'FOR', 'NOT', 'ITS', 'USE', 'USES', 'VIA', 'ONE', 'TWO', 'ALL', 'NEW', 'WITH']);

/** Something besides the caption must change within the first second of every beat. */
function deadAir(E: Compiled, fail: (k: string, m: string) => void) {
  const sig = (els: El[]) => JSON.stringify(els.filter(e => !e.id.startsWith('caption:') && !e.id.startsWith('flow:')).map(e => [e.id, Math.round(e.alpha * 20), 'x' in e ? Math.round(e.x) : 0, 'y' in e ? Math.round(e.y) : 0, 'progress' in e ? Math.round(e.progress * 20) : 0, 'pulse' in e ? Math.round(e.pulse * 10) : 0, 'glow' in e ? Math.round(e.glow * 10) : 0, e.kind === 'text' ? e.text : '']));
  for (const b of E.beats) {
    if (b === E.beats[0]) continue;
    const a = sig(E.frame(b.t0 + 0.02)), c = sig(E.frame(Math.min(b.t1 - 0.02, b.t0 + 1.0)));
    if (a === c) fail(`dead:${b.spec.id}`, `beat "${b.spec.id}": nothing moves in its first second -> add a flow, pulse, ring, show or focus change`);
  }
}

/** frame(t) must be a pure function of t: random-order sampling must equal in-order sampling. */
function determinism(E: Compiled, fail: (k: string, m: string) => void) {
  const ts = sampleTimes(E).filter((_, i) => i % 7 === 0);
  const forward = ts.map(t => JSON.stringify(E.frame(t)));
  const order = ts.map((_, i) => i).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
  for (const i of order) if (JSON.stringify(E.frame(ts[i])) !== forward[i]) { fail('det', `frame at ${ts[i].toFixed(2)}s differs when frames are visited out of order -> a block keeps state between frames`); return; }
}

