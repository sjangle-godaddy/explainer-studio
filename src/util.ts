// Small pure helpers shared by the runtime, blocks, renderer and checks.
import type { Box, Pt, Theme } from './types.ts';

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOutCubic = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const easeOutBack = (x: number) => { const c = 0.9, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
export const ISO = Math.tan(Math.PI / 6);

export const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export function textWidth(theme: Theme, s: string, size: number) {
  let w = 0;
  for (const ch of s) w += theme.font.adv[ch] ?? 0.5;
  return w * size;
}
export const unsupportedChars = (theme: Theme, s: string) => [...new Set([...s].filter(ch => !(ch in theme.font.adv)))];

/** Greedy word wrap using the font metrics, so wrapped lines fit exactly on canvas. */
export function wrap(theme: Theme, s: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (line && textWidth(theme, next, size) > maxW) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

// ---------- geometry ----------
export const boxW = (b: Box) => b[2] - b[0];
export const boxH = (b: Box) => b[3] - b[1];
export const boxCenter = (b: Box): Pt => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
export const inter = (a: Box, b: Box, g = 0) => a[0] < b[2] + g && b[0] < a[2] + g && a[1] < b[3] + g && b[1] < a[3] + g;
export const containsBox = (o: Box, b: Box) => b[0] >= o[0] - 0.5 && b[1] >= o[1] - 0.5 && b[2] <= o[2] + 0.5 && b[3] <= o[3] + 0.5;
export const inside = (b: Box, p: Pt) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export const inset = (b: Box, d: number): Box => [b[0] + d, b[1] + d, b[2] - d, b[3] - d];
export const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

export function segHitsBox(p: Pt, q: Pt, b: Box): boolean {
  // Liang-Barsky clip of segment pq against box b
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const tests: [number, number][] = [[-dx, p[0] - b[0]], [dx, b[2] - p[0]], [-dy, p[1] - b[1]], [dy, b[3] - p[1]]];
  for (const [pp, qq] of tests) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-6;
}

export function cumLengths(pts: Pt[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}
export function pointAt(pts: Pt[], cum: number[], d: number): Pt {
  if (d <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) if (cum[i] >= d) {
    const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
  }
  return pts[pts.length - 1];
}
/** The first part of a polyline, up to distance d. */
export function slicePts(pts: Pt[], d: number): Pt[] {
  const cum = cumLengths(pts), out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= d) out.push(pts[i]);
    else { out.push(pointAt(pts, cum, d)); break; }
  }
  return out;
}

// ---------- colour ----------
export function hexRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
export const rgbHex = (r: number, g: number, b: number) => '#' + hex2(r) + hex2(g) + hex2(b);
export function shade(h: string, k: number) {
  const [r, g, b] = hexRgb(h);
  return k >= 0 ? rgbHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgbHex(r * (1 + k), g * (1 + k), b * (1 + k));
}
export function rgba(h: string, a: number) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
export function mixHex(a: string, b: string, k: number) {
  const x = hexRgb(a), y = hexRgb(b);
  return rgbHex(lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k));
}
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
export function luminance(h: string) {
  const c = hexRgb(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Deterministic PRNG (mulberry32). Blocks get randomness only from this, never Math.random. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
