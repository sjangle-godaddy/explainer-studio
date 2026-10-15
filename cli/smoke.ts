// Runs the real renderer over every other frame against a canvas stand-in that throws on bad numbers,
// so drawing bugs fail the build without opening a browser.
import { drawFrame, type Ctx } from '../src/render/draw.ts';
import type { Compiled } from '../src/runtime/compile.ts';

function mockContext(): Ctx {
  const store: Record<string | symbol, unknown> = {}, grad = { addColorStop() {} };
  return new Proxy({}, {
    get(_, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k in store) return store[k];
      return (...a: unknown[]) => { for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`non-finite argument to ctx.${String(k)}(${a.join(', ')})`); };
    },
    set(_, k, v) {
      if (k === 'globalAlpha' && !(v >= 0 && v <= 1)) throw new Error(`globalAlpha out of range: ${v}`);
      store[k] = v; return true;
    },
    has() { return true; },
  }) as Ctx;
}

/** Returns an error message, or null if every sampled frame drew cleanly. */
export function renderSmoke(E: Compiled): string | null {
  const ctx = mockContext(), fps = E.theme.fps;
  try {
    for (let i = 0; i <= Math.round(E.duration * fps); i += 2) { const t = i / fps; drawFrame(ctx, E.theme, E.frame(t), t, i % 4 ? 'panel' : 'full'); }
  } catch (e) { return (e as Error).message; }
  return null;
}
