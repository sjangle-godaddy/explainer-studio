// Runtime: turns an episode into frame(t) -> display list.
// Timing comes from the spoken lines, beats cue block ids, flows run along block routes,
// and elements that keep their id across a scene change glide to their new state.
import { BLOCKS } from '../blocks/index.ts';
import { placeLabel } from '../blocks/common.ts';
import { nodeBox } from '../blocks/network-map.ts';
import type { BeatSpec, BlockInstance, Box, Cues, El, Episode, FlowSpec, Glyph, LinkEl, Pt, SceneSpec, Theme, Transform } from '../types.ts';
import { THEMES } from '../theme/blueprint.ts';
import { clamp01, cumLengths, easeInOutCubic, easeOutCubic, isHex, lerp, mixHex, pointAt, slicePts, textWidth, unsupportedChars, wordCount } from '../util.ts';
import { LAYOUTS } from './layouts.ts';

export class EpisodeError extends Error {
  problems: string[];
  constructor(problems: string[]) { super(problems.join('\n')); this.problems = problems; }
}

export interface BeatRt { spec: BeatSpec; scene: number; t0: number; t1: number; }      // absolute times
export interface SceneRt { spec: SceneSpec; t0: number; t1: number; blocks: { id: string; inst: BlockInstance }[]; ids: Set<string>; beats: BeatRt[]; }
interface FlowRt { f: FlowSpec; id: string; t0: number; t1: number; pts: Pt[]; cum: number[]; len: number; stopAt: number; looks: { d: number; color: string; glyph: Glyph }[]; travel: number; mark: Pt | null; }

export interface Compiled {
  id: string; title: string; theme: Theme; duration: number;
  scenes: SceneRt[]; beats: BeatRt[];
  frame(t: number): El[];
  beatAt(t: number): BeatRt;
  /** Elements and the beat that is active, for checks. */
  flowsOf(scene: number): FlowRt[];
  /** Element ids on screen at the end of the previous scene: they glide or fade out during the transition. */
  glidingIds(scene: number): Set<string>;
}

const CUE_KEYS = ['focus', 'show', 'pulse', 'ring', 'strike'] as const;
const FOCUS_FADE = 0.35, CAPTION_FADE = 0.28;

export function compile(ep: Episode): Compiled {
  const problems: string[] = [];
  const fail = (m: string) => problems.push(m);
  const theme = THEMES[ep.theme ?? 'blueprint'];
  if (!theme) throw new EpisodeError([`theme "${ep.theme}" does not exist -> use one of ${Object.keys(THEMES).join(', ')}`]);
  if (!ep.id || !/^[a-z0-9-]+$/.test(ep.id)) fail('episode "id" must be lowercase letters, digits and dashes');
  if (!Array.isArray(ep.scenes) || !ep.scenes.length) throw new EpisodeError(['episode needs at least one scene']);

  // ---------- scenes, blocks, timing ----------
  const scenes: SceneRt[] = [], beats: BeatRt[] = [];
  const beatIds = new Set<string>();
  let clock = 0;
  ep.scenes.forEach((sc, si) => {
    const where = `scene "${sc.id}"`;
    const layout = LAYOUTS[sc.layout];
    if (!layout) { fail(`${where}: layout "${sc.layout}" does not exist -> use one of ${Object.keys(LAYOUTS).join(', ')}`); return; }
    const slots = layout.slots(theme);
    const blocks: SceneRt['blocks'] = [];
    const ids = new Set<string>();
    for (const b of sc.blocks ?? []) {
      const def = BLOCKS[b.type];
      if (!def) { fail(`${where}: block type "${b.type}" does not exist -> use one of ${Object.keys(BLOCKS).join(', ')}, or write a new block`); continue; }
      const slot = slots[b.slot ?? 'main'];
      if (!slot) { fail(`${where}: block "${b.id}" uses slot "${b.slot ?? 'main'}" but layout "${sc.layout}" has ${Object.keys(slots).join(', ')}`); continue; }
      const inst = def.build(b, { theme, slot, problems });
      for (const id of inst.ids) { if (ids.has(id)) fail(`${where}: id "${id}" is used by two blocks`); ids.add(id); }
      blocks.push({ id: b.id, inst });
    }
    const rt: SceneRt = { spec: sc, t0: clock, t1: clock, blocks, ids, beats: [] };
    if (!Array.isArray(sc.beats) || !sc.beats.length) fail(`${where}: needs at least one beat`);
    for (const b of sc.beats ?? []) {
      if (beatIds.has(b.id)) fail(`beat id "${b.id}" is used twice`);
      beatIds.add(b.id);
      if (b.dur !== undefined && !(typeof b.dur === 'number' && b.dur >= 0.5 && b.dur <= 120)) fail(`beat "${b.id}" dur must be a number of seconds from 0.5 to 120`);
      const dur = typeof b.dur === 'number' && b.dur >= 0.5 ? b.dur : Math.max(2.2, wordCount(b.line) / theme.wordsPerSecond + 0.5);
      const br: BeatRt = { spec: b, scene: si, t0: clock, t1: clock + dur };
      clock += dur;
      rt.beats.push(br); beats.push(br);
      checkCaption(theme, b, fail);
      for (const k of CUE_KEYS) {
        const v = b[k];
        if (v === undefined || (v === 'all' && k === 'focus')) continue;
        if (!Array.isArray(v)) { fail(`beat "${b.id}" ${k} must be an array of ids${k === 'focus' ? ' or "all"' : ''}`); continue; }
        for (const id of v) if (!ids.has(id)) fail(`beat "${b.id}" ${k} names "${id}", which is not in scene "${sc.id}" (it has: ${[...ids].slice(0, 30).join(', ')})`);
      }
      for (const [id, v] of Object.entries(b.set ?? {})) {
        if (!ids.has(id)) fail(`beat "${b.id}" set names "${id}", which is not in scene "${sc.id}"`);
        if (v.value !== undefined && !(typeof v.value === 'number' && Number.isFinite(v.value))) fail(`beat "${b.id}" set "${id}" value must be a number`);
        if (v.label !== undefined) {
          const bad = typeof v.label === 'string' ? unsupportedChars(theme, v.label) : [];
          if (typeof v.label !== 'string' || !v.label.trim() || wordCount(v.label) > 4 || bad.length) fail(`beat "${b.id}" set "${id}" label must be 1 to 4 words of plain ASCII`);
        }
      }
      (b.flows ?? []).forEach((f, i) => checkFlow(f, `beat "${b.id}" flow ${i + 1}`, fail));
    }
    rt.t1 = clock;
    scenes.push(rt);
  });
  if (problems.length) throw new EpisodeError(problems);
  const duration = clock;

  // ---------- cues per scene ----------
  interface SceneCues { cues: Cues; focusAt(owner: string, t: number): number; flows: FlowRt[]; rings: { id: string; t: number }[]; strikes: { id: string; t: number }[]; }
  const sceneCues: SceneCues[] = scenes.map((sc, si) => {
    const local = (b: BeatRt) => [b.t0 - sc.t0, b.t1 - sc.t0] as const;
    const appear = new Map<string, number>();
    const mention = (id: string, at: number) => { if (!appear.has(id) || appear.get(id)! > at) appear.set(id, at); };
    for (const b of sc.beats) {
      const [l0] = local(b);
      for (const k of CUE_KEYS) { const v = b.spec[k]; if (Array.isArray(v)) v.forEach(id => mention(id, l0)); }
      for (const f of b.spec.flows ?? []) f.route.forEach(id => mention(id, l0));
      for (const id of Object.keys(b.spec.set ?? {})) mention(id, l0);
    }
    const prev = si > 0 ? scenes[si - 1].ids : new Set<string>();
    const carried = (id: string) => prev.has(id) && sc.ids.has(id);
    const pulses = new Map<string, [number, number][]>();
    const sets = new Map<string, { t: number; value?: number; label?: string }[]>();
    const rings: SceneCues['rings'] = [], strikes: SceneCues['strikes'] = [];
    for (const b of sc.beats) {
      const [l0, l1] = local(b);
      for (const id of b.spec.pulse ?? []) { if (!pulses.has(id)) pulses.set(id, []); pulses.get(id)!.push([l0, l1]); }
      for (const [id, v] of Object.entries(b.spec.set ?? {})) { if (!sets.has(id)) sets.set(id, []); sets.get(id)!.push({ t: l0 + 0.2, ...v }); }
      for (const id of b.spec.ring ?? []) rings.push({ id, t: l0 + 0.1 });
      for (const id of b.spec.strike ?? []) strikes.push({ id, t: l0 + 0.4 });
    }
    const cues: Cues = {
      appear: id => carried(id) ? -Infinity : appear.get(id) ?? 0,
      mentioned: id => appear.has(id),
      carried,
      pulse(id, t) {
        for (const [a, b] of pulses.get(id) ?? []) if (t >= a && t <= b) {
          const ramp = clamp01((t - a) / 0.3) * clamp01((b - t) / 0.3);
          return ramp * (0.75 + 0.25 * Math.sin((t - a) * 6));
        }
        return 0;
      },
      value(id, t) {
        const list = sets.get(id) ?? [];
        let cur: { t: number; value?: number; label?: string } | undefined, from: number | undefined, label: string | undefined;
        for (const s of list) {
          if (s.t > t) break;
          if (cur?.value !== undefined) from = cur.value;
          cur = s; if (s.label !== undefined) label = s.label;
        }
        if (!cur) return { k: 1 };
        return { value: cur.value ?? from, from, label, k: clamp01((t - cur.t) / 0.9) };
      },
    };
    // focus weight per owner, eased between beats
    const focusSets = sc.beats.map(b => b.spec.focus === undefined || b.spec.focus === 'all' ? null : new Set(b.spec.focus));
    const focusAt = (owner: string, t: number) => {
      const found = sc.beats.findIndex(b => t < b.t1 - sc.t0);
      const idx = found < 0 ? sc.beats.length - 1 : found;
      const w = (j: number) => { const s = focusSets[j]; return !s || s.has(owner) ? 1 : 0; };
      const cur = w(idx), l0 = sc.beats[idx].t0 - sc.t0;
      if (idx === 0) return cur;
      return lerp(w(idx - 1), cur, easeOutCubic(clamp01((t - l0) / FOCUS_FADE)));
    };
    return { cues, focusAt, flows: buildFlows(sc, problems), rings, strikes };
  });
  if (problems.length) throw new EpisodeError(problems);

  function buildFlows(sc: SceneRt, out: string[]): FlowRt[] {
    const flows: FlowRt[] = [];
    sc.beats.forEach(b => {
      (b.spec.flows ?? []).forEach((f, i) => {
        const where = `beat "${b.spec.id}" flow ${i + 1}`;
        let r: ReturnType<NonNullable<BlockInstance['route']>> = null;
        for (const { inst } of sc.blocks) { r = inst.route?.(f.route) ?? null; if (r) break; }
        if (!r) { out.push(`${where}: no block in scene "${sc.spec.id}" can route ${f.route.join(' > ')}`); return; }
        if (typeof r === 'string') { out.push(`${where}: ${r}`); return; }
        let pts = r.pts, stops = r.stops, ids = f.route;
        if (f.reverse) { pts = [...pts].reverse(); stops = stops.map(s => pts.length - 1 - s).reverse(); ids = [...ids].reverse(); }
        const cum = cumLengths(pts), len = cum[cum.length - 1];
        const distOf = (id: string) => { const j = ids.indexOf(id); return j < 0 ? null : cum[stops[j]]; };
        const anchorOf = (id: string) => { for (const { inst } of sc.blocks) { const a = inst.anchor?.(id); if (a) return a; } return null; };
        let stopAt = len, mark: Pt | null = null;
        if (f.blockAt) {
          const d = distOf(f.blockAt), a = anchorOf(f.blockAt);
          if (d === null || !a) { out.push(`${where}: blockAt "${f.blockAt}" is not on the route ${ids.join(' > ')}`); return; }
          stopAt = Math.max(10, d - a.r - 22);
          mark = pointAt(pts, cum, stopAt + 4);
        }
        const t0 = b.t0 - sc.t0 + (f.delay ?? 0.3);
        let t1 = b.t1 - sc.t0;
        if (f.untilBeat) {
          const u = sc.beats.find(x => x.spec.id === f.untilBeat);
          if (!u) { out.push(`${where}: untilBeat "${f.untilBeat}" is not a beat of scene "${sc.spec.id}"`); return; }
          t1 = u.t1 - sc.t0;
        }
        let travel = f.dur ?? stopAt / (f.speed ?? theme.packetSpeed);
        const room = (t1 - t0) * 0.85;
        if (f.mode !== 'line' && travel > room) {
          if (travel / 3 > room) { out.push(`${where}: too short for packets to cross this ${Math.round(stopAt)} px route -> lower "delay", keep it running with "untilBeat", or give the beat a longer "dur"`); return; }
          travel = room;
        }
        const color = theme.roles[f.color ?? 'public'];
        if (!color) { out.push(`${where}: color "${f.color}" is not a theme role`); return; }
        // the packet's look starts as color/glyph and changes at each transform point along the route
        const looks = [{ d: -Infinity, color, glyph: f.glyph ?? 'plain' as Glyph }];
        const transforms = f.transform === undefined ? [] : Array.isArray(f.transform) ? f.transform : [f.transform];
        const placed: { tr: Transform; d: number }[] = [];
        for (const tr of transforms) {
          const d = distOf(tr.at);
          if (d === null) { out.push(`${where}: transform.at "${tr.at}" is not on the route ${ids.join(' > ')}`); return; }
          placed.push({ tr, d });
        }
        // fold in route order, so each change inherits the look the packet has at that point
        for (const { tr, d } of placed.sort((a, b) => a.d - b.d)) {
          const c = tr.color === undefined ? undefined : theme.roles[tr.color];
          if (tr.color !== undefined && !c) { out.push(`${where}: transform color "${tr.color}" is not a theme role`); return; }
          looks.push({ d, color: c ?? looks[looks.length - 1].color, glyph: tr.glyph ?? looks[looks.length - 1].glyph });
        }
        flows.push({ f, id: `flow:${b.spec.id}:${i}`, t0, t1, pts, cum, len, stopAt, looks, travel, mark });
      });
    });
    return flows;
  }

  // ---------- frames ----------
  function flowElements(fl: FlowRt, t: number): El[] {
    const out: El[] = [];
    if (t < fl.t0 || t > fl.t1 + 0.3) return out;
    const fadeOut = 1 - clamp01((t - fl.t1) / 0.3);
    const blocked = fl.mark !== null;
    if (fl.f.line !== false || fl.f.mode === 'line') {
      const k = easeOutCubic(clamp01((t - fl.t0) / 0.5));
      const pts = slicePts(fl.pts, fl.stopAt);
      const line: LinkEl = { kind: 'link', id: fl.id, alpha: fadeOut, z: 25, pts, color: fl.looks[0].color, width: 4.5, dashed: fl.f.dashed ?? blocked, style: 'line', progress: k, ends: fl.f.route };
      out.push(line);
    }
    if (fl.f.mode === 'line') return out;
    const once = fl.f.mode === 'once';
    const period = fl.f.period ?? 0.75, v = fl.stopAt / fl.travel;
    const spawns: number[] = [];
    if (once) spawns.push(fl.t0);
    else for (let s = fl.t0; s < fl.t1 - 0.2; s += period) spawns.push(s);
    for (const [i, s] of spawns.entries()) {
      if (t < s) break;
      let d = (t - s) * v;
      let a = fadeOut;
      if (d >= fl.stopAt) {
        if (once && !blocked) { d = fl.stopAt; }
        else { a *= 1 - clamp01((d - fl.stopAt) / (v * 0.2)); d = fl.stopAt; }
      }
      if (a <= 0) continue;
      const [x, y] = pointAt(fl.pts, fl.cum, d);
      let look = fl.looks[0];
      for (const l of fl.looks) if (d >= l.d) look = l;
      out.push({ kind: 'packet', id: `${fl.id}:p${i}`, alpha: a * clamp01((t - s) / 0.12), z: 45, x, y, r: 15, color: look.color, glyph: look.glyph });
    }
    if (fl.mark) {
      const reach = fl.t0 + (once || spawns.length ? fl.travel : 0.3);
      const k = clamp01((t - reach) / 0.3);
      if (k > 0) out.push({ kind: 'mark', id: `${fl.id}:x`, alpha: k * fadeOut, z: 47, x: fl.mark[0], y: fl.mark[1], r: 24 });
    }
    return out;
  }

  const ownerBox = (els: El[], owner: string): Box | null => {
    let b: Box | null = null;
    for (const e of els) if (e.owner === owner) { const eb = elBox(theme, e); if (eb) b = b ? [Math.min(b[0], eb[0]), Math.min(b[1], eb[1]), Math.max(b[2], eb[2]), Math.max(b[3], eb[3])] : eb; }
    return b;
  };

  /** The display list of one scene at scene-local time, before scene transitions. */
  function sceneFrame(si: number, lt: number): El[] {
    const sc = scenes[si], c = sceneCues[si];
    let els: El[] = [];
    for (const { inst } of sc.blocks) els.push(...inst.frame(lt, c.cues));
    // focus dimming
    for (const e of els) {
      if (!e.owner) continue;
      const w = c.focusAt(e.owner, lt);
      if (w >= 1) continue;
      const dim = e.kind === 'label' || e.kind === 'text' ? theme.dim.label : e.kind === 'zone' ? theme.dim.zone : theme.dim.map;
      e.alpha *= lerp(dim, 1, w);
    }
    for (const fl of c.flows) els.push(...flowElements(fl, lt));
    for (const r of c.rings) {
      const k = (lt - r.t) / 0.7;
      if (k < 0 || k > 1) continue;
      let a: { x: number; y: number; r: number } | null = null;
      for (const { inst } of sc.blocks) { a = inst.anchor?.(r.id) ?? null; if (a) break; }
      if (a) els.push({ kind: 'ring', id: `ring:${r.id}:${r.t}`, alpha: 0.85 * (1 - k), z: 35, x: a.x, y: a.y, r: a.r * 0.6 + a.r * 1.1 * easeOutCubic(k), color: theme.roles.gateway, width: 4 * (1 - k) + 1 });
    }
    for (const s of c.strikes) {
      if (lt < s.t) continue;
      const b = ownerBox(els, s.id);
      if (b) els.push({ kind: 'strike', id: `strike:${s.id}`, alpha: 1, z: 48, box: b, progress: easeOutCubic(clamp01((lt - s.t) / 0.5)) });
    }
    els = els.filter(e => !(e.alpha <= 0.002)); // keep NaN alpha so the checks report it
    return els;
  }

  const endFrames = new Map<number, Map<string, El>>();
  const endFrame = (si: number) => {
    if (!endFrames.has(si)) endFrames.set(si, new Map(sceneFrame(si, scenes[si].t1 - scenes[si].t0).filter(e => e.kind !== 'ring').map(e => [e.id, e])));
    return endFrames.get(si)!;
  };

  function beatAt(t: number): BeatRt {
    for (const b of beats) if (t < b.t1) return b;
    return beats[beats.length - 1];
  }
  const sceneIndexAt = (t: number) => { const i = scenes.findIndex(s => t < s.t1); return i < 0 ? scenes.length - 1 : i; };

  function captionEls(t: number): El[] {
    const b = beatAt(t), i = beats.indexOf(b), k = clamp01((t - b.t0) / CAPTION_FADE);
    const out: El[] = [];
    const add = (text: string, a: number, tag: string) => {
      if (a <= 0) return;
      const L = placeLabel(theme, { id: `caption:${tag}`, lines: [text], owner: '', color: theme.roles.gateway, anchor: [0, 0, 0, 0], size: theme.type.caption, subSize: theme.type.caption, z: 90 });
      const w = L.box[2] - L.box[0], [x0, y0, x1, y1] = theme.captionBox, cx = (x0 + x1) / 2;
      L.box = [cx - w / 2, y0, cx + w / 2, y1];
      L.owner = undefined; L.alpha = a;
      out.push(L);
    };
    const intro = i === 0 ? clamp01((t - 0.25) / 0.3) : k;
    if (i > 0 && k < 1) add(beats[i - 1].spec.caption, 1 - k, beats[i - 1].spec.id);
    add(b.spec.caption, intro, b.spec.id);
    return out;
  }

  function frame(tIn: number): El[] {
    const t = Math.max(0, Math.min(duration, tIn));
    const si = sceneIndexAt(t), sc = scenes[si], lt = t - sc.t0;
    let els = sceneFrame(si, lt);
    if (si > 0 && lt < theme.transition) {
      const k = easeInOutCubic(lt / theme.transition), prev = endFrame(si - 1), seen = new Set<string>();
      els = els.map(e => {
        const p = prev.get(e.id);
        if (p && p.kind === e.kind) { seen.add(e.id); return interpolate(p, e, k); }
        return { ...e, alpha: e.alpha * clamp01((k - 0.3) / 0.7) };
      });
      for (const [id, p] of prev) if (!seen.has(id)) {
        const a = p.alpha * (1 - clamp01(k * 1.8));
        if (a > 0.002) els.push({ ...p, alpha: a });
      }
    }
    els.push(...captionEls(t));
    return els.sort((a, b) => a.z - b.z);
  }

  return { id: ep.id, title: ep.title, theme, duration, scenes, beats, frame, beatAt, flowsOf: si => sceneCues[si].flows,
    glidingIds: si => si === 0 ? new Set() : new Set(endFrame(si - 1).keys()) };
}

function checkCaption(theme: Theme, b: BeatSpec, fail: (m: string) => void) {
  const c = b.caption ?? '';
  if (!c.trim()) { fail(`beat "${b.id}" needs a caption`); return; }
  if (wordCount(c) > 4) fail(`beat "${b.id}" caption "${c}" has more than 4 words -> shorten it`);
  const bad = unsupportedChars(theme, c);
  if (bad.length) fail(`beat "${b.id}" caption has characters not in the font: ${bad.join(' ')} -> plain ASCII, write TO instead of arrows`);
  const w = textWidth(theme, c, theme.type.caption) + theme.type.caption * 0.7;
  if (w > theme.captionBox[2] - theme.captionBox[0]) fail(`beat "${b.id}" caption "${c}" is too wide for the caption slot -> shorten it`);
  if (!b.line?.trim()) fail(`beat "${b.id}" needs the spoken "line"`);
}

function checkFlow(f: FlowSpec, where: string, fail: (m: string) => void) {
  if (!Array.isArray(f.route) || f.route.length < 2) fail(`${where}: route must list at least two ids`);
  const num = (v: unknown, what: string, min: number, max: number) => {
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)) fail(`${where}: ${what} must be a number from ${min} to ${max}`);
  };
  num(f.delay, 'delay', 0, 60); num(f.period, 'period', 0.1, 10); num(f.speed, 'speed', 20, 5000); num(f.dur, 'dur', 0.1, 60);
  if (f.mode !== undefined && !['stream', 'once', 'line'].includes(f.mode)) fail(`${where}: mode must be stream, once or line`);
  const glyphs = [f.glyph, ...(f.transform === undefined ? [] : Array.isArray(f.transform) ? f.transform : [f.transform]).map(t => t.glyph)];
  for (const g of glyphs) if (g !== undefined && g !== 'plain' && g !== 'locked') fail(`${where}: glyph must be plain or locked`);
}

/** Matching elements glide: numbers and number arrays tween, colours mix, everything else switches halfway. */
export function interpolate<T extends El>(a: T, b: T, k: number): T {
  const out: Record<string, unknown> = { ...b };
  for (const key of Object.keys(b)) {
    const x = (a as unknown as Record<string, unknown>)[key], y = (b as unknown as Record<string, unknown>)[key];
    if (typeof x === 'number' && typeof y === 'number') out[key] = lerp(x, y, k);
    else if (isHex(x) && isHex(y)) out[key] = mixHex(x, y, k);
    else if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every(v => typeof v === 'number')) out[key] = (y as number[]).map((v, i) => lerp(x[i] as number, v, k));
    else if (key === 'pts' && Array.isArray(x) && Array.isArray(y)) out[key] = tweenPts(x as Pt[], y as Pt[], k);
    else out[key] = k < 0.5 ? x ?? y : y;
  }
  return out as T;
}
function tweenPts(a: Pt[], b: Pt[], k: number): Pt[] {
  const n = Math.max(a.length, b.length);
  const at = (p: Pt[], i: number) => p[Math.min(p.length - 1, Math.round(i * (p.length - 1) / Math.max(1, n - 1)))];
  return Array.from({ length: n }, (_, i) => { const p = at(a, i), q = at(b, i); return [lerp(p[0], q[0], k), lerp(p[1], q[1], k)] as Pt; });
}

/** Screen box of an element, used by checks, strikes and readability rules. */
export function elBox(theme: Theme, e: El): Box | null {
  switch (e.kind) {
    case 'zone': case 'label': case 'text': case 'panel': case 'strike': return e.box;
    case 'node': { const n = theme.nodeSizes[e.type]; return nodeBox(e.x, e.y, n.hw, n.h, e.scale); }
    case 'packet': case 'mark': return [e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r];
    case 'ring': return null;
    case 'link': {
      let b: Box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of e.pts) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
      return b;
    }
  }
}
