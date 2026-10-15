// Scene templates: named slots cut from the theme's content box. Episodes never write pixel coordinates.
import type { Box, Theme } from '../types.ts';

const GAP = 24;

function rows(b: Box, shares: number[]): Box[] {
  const total = shares.reduce((a, s) => a + s, 0), h = b[3] - b[1] - GAP * (shares.length - 1);
  let y = b[1];
  return shares.map(s => { const box: Box = [b[0], y, b[2], y + h * s / total]; y = box[3] + GAP; return box; });
}
function cols(b: Box, shares: number[]): Box[] {
  const total = shares.reduce((a, s) => a + s, 0), w = b[2] - b[0] - GAP * (shares.length - 1);
  let x = b[0];
  return shares.map(s => { const box: Box = [x, b[1], x + w * s / total, b[3]]; x = box[2] + GAP; return box; });
}

export const LAYOUTS: Record<string, { describe: string; slots(theme: Theme): Record<string, Box> }> = {
  'full': {
    describe: 'one slot "main" filling the whole content area',
    slots: t => ({ main: t.content }),
  },
  'focus+aside': {
    describe: '"main" (upper 60%) and "aside" (lower 40%)',
    slots: t => { const [main, aside] = rows(t.content, [3, 2]); return { main, aside }; },
  },
  'main+strip': {
    describe: '"main" (upper 70%) and a "strip" below it, tall enough for a 4-row table',
    slots: t => { const [main, strip] = rows(t.content, [2.2, 1]); return { main, strip }; },
  },
  'hero+stat': {
    describe: '"main" (upper 78%) and a short "stat" strip below it',
    slots: t => { const [main, stat] = rows(t.content, [3.6, 1]); return { main, stat }; },
  },
  'split-2': {
    describe: '"left" and "right" columns',
    slots: t => { const [left, right] = cols(t.content, [1, 1]); return { left, right }; },
  },
  'stack-3': {
    describe: '"top", "middle" and "bottom" rows of equal height',
    slots: t => { const [top, middle, bottom] = rows(t.content, [1, 1, 1]); return { top, middle, bottom }; },
  },
};
