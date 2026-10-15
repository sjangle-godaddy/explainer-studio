// Helpers every block uses: entrances, labels and prop validation.
import type { Box, Cues, LabelEl, Theme } from '../types.ts';
import { clamp01, easeOutBack, easeOutCubic, textWidth, unsupportedChars } from '../util.ts';

export const ENTER = 0.55; // seconds an element takes to snap in

/** 0 before an id appears, rising to 1 over ENTER seconds; 1 if it was carried over from the previous scene. */
export function enter(cues: Cues, id: string, t: number, dur = ENTER) {
  const a = cues.appear(id);
  if (a === -Infinity) return 1;
  if (!Number.isFinite(a)) return 0;
  return clamp01((t - a) / dur);
}
export const pop = (k: number) => k <= 0 ? 0 : easeOutBack(k);
export const fade = (k: number) => easeOutCubic(k);

// ---------- labels ----------
// Label boxes are computed here and drawn by the renderer from the same metrics, so checks see exact boxes.
export function labelMetrics(size: number, subSize: number) {
  return { padX: Math.round(size * 0.34), padY: Math.round(size * 0.24), pitch: size * 1.02, subPitch: subSize * 1.08 };
}

export type Side = 'below' | 'above' | 'left' | 'right';

export function labelSize(theme: Theme, lines: string[], sub: string | undefined, size: number, subSize: number) {
  const m = labelMetrics(size, subSize);
  const w = Math.max(...lines.map(l => textWidth(theme, l, size)), sub ? textWidth(theme, sub, subSize) : 0) + 2 * m.padX;
  const h = 2 * m.padY + lines.length * m.pitch + (sub ? m.subPitch : 0);
  return { w, h };
}

/** A label box placed on one side of an anchor box (the object it names). */
export function placeLabel(theme: Theme, opts: {
  id: string; owner: string; lines: string[]; sub?: string; color: string; anchor: Box; side?: Side; gap?: number;
  size?: number; subSize?: number; fill?: 'dark' | 'solid'; z?: number;
}): LabelEl {
  const size = opts.size ?? theme.type.label, subSize = opts.subSize ?? theme.type.sub;
  const { w, h } = labelSize(theme, opts.lines, opts.sub, size, subSize);
  const a = opts.anchor, g = opts.gap ?? 12, cx = (a[0] + a[2]) / 2, cy = (a[1] + a[3]) / 2;
  let box: Box;
  switch (opts.side ?? 'below') {
    case 'above': box = [cx - w / 2, a[1] - g - h, cx + w / 2, a[1] - g]; break;
    case 'left': box = [a[0] - g - w, cy - h / 2, a[0] - g, cy + h / 2]; break;
    case 'right': box = [a[2] + g, cy - h / 2, a[2] + g + w, cy + h / 2]; break;
    default: box = [cx - w / 2, a[3] + g, cx + w / 2, a[3] + g + h];
  }
  return { kind: 'label', id: opts.id, owner: opts.owner, alpha: 1, z: opts.z ?? 50, box, lines: opts.lines, sub: opts.sub, size, subSize, color: opts.color, fill: opts.fill ?? 'dark', pulse: 0, scale: 1 };
}

// ---------- validation ----------
export class Props {
  readonly spec: Record<string, unknown>;
  readonly where: string;
  readonly problems: string[];
  readonly theme: Theme;
  constructor(spec: Record<string, unknown>, where: string, problems: string[], theme: Theme) {
    this.spec = spec; this.where = where; this.problems = problems; this.theme = theme;
  }
  fail(msg: string) { this.problems.push(`${this.where}: ${msg}`); }
  text(s: unknown, what: string, maxWords = 4): string {
    if (typeof s !== 'string' || !s.trim()) { this.fail(`${what} must be a non-empty string`); return '?'; }
    const bad = unsupportedChars(this.theme, s);
    if (bad.length) this.fail(`${what} "${s}" has characters not in the font: ${bad.join(' ')} -> use plain ASCII`);
    if (s.trim().split(/\s+/).length > maxWords) this.fail(`${what} "${s}" has more than ${maxWords} words -> shorten it or move detail into "sub"`);
    return s;
  }
  role(r: unknown, what: string, fallback: string): string {
    if (r === undefined) return fallback;
    if (typeof r !== 'string' || !(r in this.theme.roles)) { this.fail(`${what} "${String(r)}" is not a theme role (${Object.keys(this.theme.roles).join(', ')})`); return fallback; }
    return r;
  }
  num(v: unknown, what: string, fallback: number, min = -Infinity, max = Infinity): number {
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { this.fail(`${what} must be a number from ${min} to ${max}`); return fallback; }
    return v;
  }
  oneOf<T extends string>(v: unknown, what: string, options: readonly T[], fallback: T): T {
    if (v === undefined) return fallback;
    if (!options.includes(v as T)) { this.fail(`${what} must be one of ${options.join(', ')}`); return fallback; }
    return v as T;
  }
  list(v: unknown, what: string): Record<string, unknown>[] {
    if (!Array.isArray(v) || !v.length) { this.fail(`${what} must be a non-empty array`); return []; }
    return v as Record<string, unknown>[];
  }
  id(v: unknown, what: string): string {
    if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(v)) { this.fail(`${what} must be an id (letters, digits, - and _)`); return '?'; }
    return v;
  }
}

export function labelLines(p: Props, v: unknown, what: string): string[] {
  if (Array.isArray(v)) return v.map((s, i) => p.text(s, `${what}[${i}]`, 3));
  return [p.text(v, what, 3)];
}
