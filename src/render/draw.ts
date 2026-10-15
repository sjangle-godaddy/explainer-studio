// Canvas 2D renderer for display lists. The same code draws the browser preview and the Node MP4 render.
// Drawing style is ported from the original ai-explainer blueprint engine.
import { labelMetrics } from '../blocks/common.ts';
import type { El, LabelEl, LinkEl, NodeEl, PacketEl, Pt, Theme, ZoneEl } from '../types.ts';
import { ISO, clamp01, cumLengths, easeOutCubic, pointAt, rgba, shade } from '../util.ts';

// Minimal surface shared by CanvasRenderingContext2D and @napi-rs/canvas.
export type Ctx = CanvasRenderingContext2D;

export function drawFrame(ctx: Ctx, theme: Theme, els: El[], t: number, frame: 'panel' | 'full' = 'panel') {
  const W = theme.W, H = theme.H;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (frame === 'full') { ctx.fillStyle = '#05070d'; ctx.fillRect(0, H, W, theme.fullH - H); }
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  background(ctx, theme, t);
  for (const e of els) {
    if (e.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(e.alpha);
    switch (e.kind) {
      case 'zone': zone(ctx, theme, e); break;
      case 'link': link(ctx, theme, e); break;
      case 'node': node(ctx, theme, e, t); break;
      case 'label': label(ctx, theme, e, t); break;
      case 'text': font(ctx, theme, e.size); ctx.fillStyle = e.color; ctx.textAlign = e.align; ctx.textBaseline = 'alphabetic';
        ctx.fillText(e.text, e.align === 'center' ? (e.box[0] + e.box[2]) / 2 : e.align === 'right' ? e.box[2] : e.box[0], e.box[1] + (e.box[3] - e.box[1] + e.size * theme.font.cap) / 2); break;
      case 'panel': rr(ctx, e.box[0], e.box[1], e.box[2] - e.box[0], e.box[3] - e.box[1], e.radius); ctx.fillStyle = e.fill; ctx.fill();
        if (e.strokeWidth > 0) { ctx.strokeStyle = e.stroke; ctx.lineWidth = e.strokeWidth; ctx.stroke(); } break;
      case 'packet': packet(ctx, theme, e); break;
      case 'mark': mark(ctx, theme, e.x, e.y, e.r, t); break;
      case 'ring': ctx.strokeStyle = e.color; ctx.lineWidth = e.width; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * ISO * 1.15, 0, 0, Math.PI * 2); ctx.stroke(); break;
      case 'strike': {
        const [x0, y0, x1, y1] = e.box, red = theme.roles.blocked, p = e.progress;
        ctx.strokeStyle = red; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.shadowColor = red; ctx.shadowBlur = 14;
        const seg = (ax: number, ay: number, bx: number, by: number, k: number) => { if (k <= 0) return; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k); ctx.stroke(); };
        seg(x0 + 10, y0 + 10, x1 - 10, y1 - 10, clamp01(p * 2)); seg(x1 - 10, y0 + 10, x0 + 10, y1 - 10, clamp01(p * 2 - 1));
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function font(ctx: Ctx, theme: Theme, size: number) {
  ctx.font = `700 ${size}px ${theme.font.stack}`;
  if ('fontKerning' in ctx) ctx.fontKerning = 'none';
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function poly(ctx: Ctx, pts: Pt[]) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
const facePt = (A: Pt, B: Pt, D: Pt, u: number, v: number): Pt => [A[0] + (B[0] - A[0]) * u + (D[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (D[1] - A[1]) * v];

function background(ctx: Ctx, theme: Theme, t: number) {
  const W = theme.W, H = theme.H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.page[0]); g.addColorStop(1, theme.page[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sweep = easeOutCubic(clamp01(t / 1.1)) * (H + 200);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, sweep); ctx.clip();
  for (let dir = -1; dir <= 1; dir += 2) for (let i = -40; i < 70; i++) {
    const c = i * 40;
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(95,212,255,0.14)' : 'rgba(95,212,255,0.06)';
    ctx.lineWidth = i % 4 === 0 ? 1.5 : 1;
    ctx.beginPath();
    if (dir > 0) { ctx.moveTo(0, c); ctx.lineTo(W, c + W * ISO); } else { ctx.moveTo(0, c + W * ISO); ctx.lineTo(W, c); }
    ctx.stroke();
  }
  ctx.restore();
  if (t < 1.3) { ctx.fillStyle = `rgba(120,225,255,${0.5 * (1 - clamp01((t - 0.9) / 0.4))})`; ctx.fillRect(0, sweep - 3, W, 3); }
  const v = ctx.createRadialGradient(W / 2, H * 0.45, 260, W / 2, H * 0.6, H * 0.9);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(2,8,26,0.45)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

function tracePerimeter(ctx: Ctx, [x0, y0, x1, y1]: number[], p: number) {
  let left = 2 * ((x1 - x0) + (y1 - y0)) * p;
  ctx.beginPath(); ctx.moveTo(x0, y0);
  for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
    const len = Math.hypot(bx - ax, by - ay);
    if (left >= len) { ctx.lineTo(bx, by); left -= len; } else { ctx.lineTo(ax + (bx - ax) * left / len, ay + (by - ay) * left / len); break; }
  }
}

function zone(ctx: Ctx, theme: Theme, z: ZoneEl) {
  const [x0, y0, x1, y1] = z.box, a = ctx.globalAlpha, k = z.progress;
  ctx.fillStyle = 'rgba(2,8,26,0.35)'; ctx.fillRect(x0 + 6, y1 + z.lip, x1 - x0 - 12, 8 * k);
  ctx.fillStyle = shade(z.fill, -0.45); ctx.fillRect(x0, y1, x1 - x0, z.lip);
  ctx.fillStyle = z.fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  for (let c = y0 - (x1 - x0); c < y1 + (x1 - x0); c += 28) {
    ctx.beginPath(); ctx.moveTo(x0, c); ctx.lineTo(x1, c + (x1 - x0) * ISO); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, c + (x1 - x0) * ISO); ctx.lineTo(x1, c); ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, y0, 0, y0 + 22);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, 22);
  ctx.restore();
  ctx.globalAlpha = a;
  ctx.strokeStyle = z.edge; ctx.lineWidth = z.dashed ? 3 : 2.5;
  if (z.dashed) ctx.setLineDash([14, 9]);
  tracePerimeter(ctx, z.box, k); ctx.stroke();
  ctx.setLineDash([]);
}

function polyPath(ctx: Ctx, pts: Pt[], len: number) {
  const cum = cumLengths(pts);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= len) ctx.lineTo(pts[i][0], pts[i][1]);
    else { const p = pointAt(pts, cum, len); ctx.lineTo(p[0], p[1]); break; }
  }
}
function link(ctx: Ctx, theme: Theme, l: LinkEl) {
  const cum = cumLengths(l.pts), len = cum[cum.length - 1] * l.progress;
  if (len <= 0) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (l.style === 'tunnel') {
    // a glowing pipe with a dashed core and a padlock in the middle
    ctx.strokeStyle = rgba(l.color, 0.18); ctx.lineWidth = 34; polyPath(ctx, l.pts, len); ctx.stroke();
    ctx.strokeStyle = rgba(l.color, 0.75); ctx.lineWidth = 2.5;
    for (const off of [-15, 15]) { ctx.save(); offsetPath(ctx, l.pts, len, off); ctx.stroke(); ctx.restore(); }
    ctx.setLineDash([10, 12]); ctx.strokeStyle = l.color; ctx.lineWidth = l.width; polyPath(ctx, l.pts, len); ctx.stroke(); ctx.setLineDash([]);
    if (l.progress > 0.55) { const m = pointAt(l.pts, cum, cum[cum.length - 1] / 2); ctx.globalAlpha *= clamp01((l.progress - 0.55) / 0.3); lock(ctx, theme, m[0], m[1], 15, l.color); }
    return;
  }
  if (l.dashed) ctx.setLineDash([12, 10]);
  if (l.width >= 4) { ctx.strokeStyle = rgba(l.color, 0.22); ctx.lineWidth = l.width * 2.6; polyPath(ctx, l.pts, len); ctx.stroke(); }
  ctx.strokeStyle = l.color; ctx.lineWidth = l.width; polyPath(ctx, l.pts, len); ctx.stroke();
}
function offsetPath(ctx: Ctx, pts: Pt[], len: number, off: number) {
  // parallel line for straight segments (tunnel walls)
  const cum = cumLengths(pts), out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / d * off, ny = (bx - ax) / d * off;
    if (i === 1) out.push([ax + nx, ay + ny]);
    if (cum[i] <= len) out.push([bx + nx, by + ny]);
    else { const p = pointAt(pts, cum, len); out.push([p[0] + nx, p[1] + ny]); break; }
  }
  ctx.beginPath(); ctx.moveTo(out[0][0], out[0][1]); for (let i = 1; i < out.length; i++) ctx.lineTo(out[i][0], out[i][1]);
}

function lock(ctx: Ctx, theme: Theme, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.fillStyle = theme.ink; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, s * 1.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = s * 0.22; ctx.beginPath(); ctx.arc(x, y - s * 0.15, s * 0.42, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = color; rr(ctx, x - s * 0.62, y - s * 0.15, s * 1.24, s * 0.9, s * 0.15); ctx.fill();
  ctx.restore();
}

function shadowUnder(ctx: Ctx, cx: number, gy: number, r: number) {
  const sg = ctx.createRadialGradient(cx, gy + 3, 3, cx, gy + 3, r);
  sg.addColorStop(0, 'rgba(2,8,26,0.55)'); sg.addColorStop(1, 'rgba(2,8,26,0)');
  ctx.save(); ctx.translate(cx, gy + 3); ctx.scale(1, 0.6); ctx.translate(-cx, -(gy + 3));
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, gy + 3, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
interface Body { gx: number; gy: number; hw: number; h: number; hh: number; }
function blockFaces(o: Body) {
  const { gx: cx, gy, hw, h, hh } = o, top = gy - h;
  return {
    top,
    L: [[cx - hw, top], [cx, top + hh], [cx, gy + hh], [cx - hw, gy]] as Pt[],
    R: [[cx, top + hh], [cx + hw, top], [cx + hw, gy], [cx, gy + hh]] as Pt[],
    T: [[cx, top - hh], [cx + hw, top], [cx, top + hh], [cx - hw, top]] as Pt[],
  };
}
function blockBody(ctx: Ctx, o: Body, color: string) {
  const { gx: cx, gy, hw, hh } = o, f = blockFaces(o), { top, L, R, T } = f;
  ctx.fillStyle = shade(color, -0.12); poly(ctx, L); ctx.fill();
  ctx.fillStyle = shade(color, -0.42); poly(ctx, R); ctx.fill();
  ctx.fillStyle = shade(color, 0.28); poly(ctx, T); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
  poly(ctx, T.map(([x, y]) => [cx + (x - cx) * 0.8, top + (y - top) * 0.8] as Pt)); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx - hw, gy); ctx.lineTo(cx, gy + hh); ctx.lineTo(cx + hw, gy); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.8;
  poly(ctx, [[cx, top - hh], [cx + hw, top], [cx + hw, gy], [cx, gy + hh], [cx - hw, gy], [cx - hw, top]]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - hw, top); ctx.lineTo(cx, top + hh); ctx.lineTo(cx + hw, top); ctx.moveTo(cx, top + hh); ctx.lineTo(cx, gy + hh); ctx.stroke();
  return f;
}
function cylinder(ctx: Ctx, o: Body, color: string) {
  const { gx: cx, gy, hw, h } = o, ry = hw * ISO, top = gy - h;
  ctx.fillStyle = shade(color, -0.2);
  ctx.beginPath(); ctx.moveTo(cx - hw, top); ctx.lineTo(cx - hw, gy); ctx.ellipse(cx, gy, hw, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + hw, top); ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(color, 0.28); ctx.beginPath(); ctx.ellipse(cx, top, hw, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.8; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - hw, top); ctx.lineTo(cx - hw, gy); ctx.ellipse(cx, gy, hw, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + hw, top); ctx.stroke();
}
const DARK = 'rgba(6,22,51,0.75)';

function node(ctx: Ctx, theme: Theme, e: NodeEl, t: number) {
  const size = theme.nodeSizes[e.type] ?? theme.nodeSizes.server, c = e.color;
  ctx.translate(e.x, e.y); ctx.scale(e.scale, e.scale); ctx.translate(-e.x, -e.y);
  if (e.glow > 0) { ctx.shadowColor = rgba(c, 0.5 + 0.4 * e.glow); ctx.shadowBlur = 26 * e.glow; }
  const o: Body = { gx: e.x, gy: e.y, hw: size.hw, h: size.h, hh: size.hw * ISO };
  if (e.type === 'users') {
    for (const [dx, dy, s] of [[10, -5, 0.9], [-9, 2, 1]]) {
      const x = o.gx + dx, base = o.gy + dy;
      ctx.fillStyle = c; ctx.strokeStyle = theme.page[0]; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x - 12 * s, base); ctx.quadraticCurveTo(x - 12 * s, base - 31 * s, x, base - 33 * s);
      ctx.quadraticCurveTo(x + 12 * s, base - 31 * s, x + 12 * s, base); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, base - 43 * s, 9 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    return;
  }
  ctx.shadowBlur = e.glow > 0 ? ctx.shadowBlur : 0;
  shadowUnder(ctx, o.gx, o.gy, o.hw + 18);
  if (e.type === 'database') {
    cylinder(ctx, o, c);
    ctx.strokeStyle = DARK; ctx.lineWidth = 2.5;
    for (const k of [0.38, 0.7]) { ctx.beginPath(); ctx.ellipse(o.gx, o.gy - o.h * (1 - k), o.hw, o.hw * ISO, 0, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    return;
  }
  if (e.type === 'cloud') {
    const y = o.gy - o.h;
    ctx.fillStyle = shade(c, 0.1); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.gx - 18, y + 6, 16, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(o.gx - 2, y - 8, 20, Math.PI, Math.PI * 1.9);
    ctx.arc(o.gx + 22, y + 4, 18, Math.PI * 1.4, Math.PI * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    return;
  }
  const { top, L, R } = blockBody(ctx, o, c);
  ctx.shadowBlur = 0;
  const cx = o.gx, hw = o.hw;
  const faceLine = (F: Pt[], u0: number, v0: number, u1: number, v1: number) => { const a = facePt(F[0], F[1], F[3], u0, v0), b = facePt(F[0], F[1], F[3], u1, v1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  ctx.strokeStyle = DARK; ctx.fillStyle = DARK; ctx.lineWidth = 2.5;
  switch (e.type) {
    case 'server': {
      for (const v of [0.28, 0.5, 0.72]) faceLine(L, 0.18, v, 0.82, v);
      const led = facePt(R[0], R[1], R[3], 0.3, 0.3);
      ctx.fillStyle = Math.floor(t * 2.5) % 2 ? '#7dffb2' : '#2a9d63';
      ctx.beginPath(); ctx.arc(led[0], led[1], 3.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'datacenter': {
      // rows of windows on both faces
      for (const F of [L, R]) for (const v of [0.2, 0.42, 0.64]) for (const u of [0.2, 0.55]) {
        poly(ctx, [facePt(F[0], F[1], F[3], u, v), facePt(F[0], F[1], F[3], u + 0.25, v), facePt(F[0], F[1], F[3], u + 0.25, v + 0.12), facePt(F[0], F[1], F[3], u, v + 0.12)]); ctx.fill();
      }
      break;
    }
    case 'gateway': {
      for (const F of [L, R]) poly(ctx, [facePt(F[0], F[1], F[3], 0.3, 0.32), facePt(F[0], F[1], F[3], 0.7, 0.32), facePt(F[0], F[1], F[3], 0.7, 1), facePt(F[0], F[1], F[3], 0.3, 1)]), ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, top, hw * 0.42, hw * 0.42 * ISO, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'vpngw': {
      for (const v of [0.35, 0.65]) faceLine(L, 0.15, v, 0.85, v);
      ctx.save(); ctx.translate(cx, top); ctx.scale(1, 0.75); lock(ctx, theme, 0, 0, 11, theme.ink); ctx.restore();
      break;
    }
    case 'router': {
      // four arrows on the top face, the classic router symbol
      ctx.lineWidth = 3;
      for (const [dx, dy] of [[1, ISO], [-1, -ISO], [1, -ISO], [-1, ISO]] as Pt[]) {
        const x0 = cx + dx * hw * 0.12, y0 = top + dy * hw * 0.12, x1 = cx + dx * hw * 0.55, y1 = top + dy * hw * 0.55;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        const a = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 9 * Math.cos(a - 0.5), y1 - 9 * Math.sin(a - 0.5)); ctx.lineTo(x1 - 9 * Math.cos(a + 0.5), y1 - 9 * Math.sin(a + 0.5)); ctx.closePath(); ctx.fill();
      }
      for (const v of [0.5]) faceLine(R, 0.15, v, 0.85, v);
      break;
    }
    case 'vpc': {
      // dashed boundary square on the top face
      ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
      poly(ctx, [[cx, top - o.hh * 0.6], [cx + hw * 0.6, top], [cx, top + o.hh * 0.6], [cx - hw * 0.6, top]]); ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'firewall': {
      ctx.lineWidth = 2;
      for (const F of [L, R]) {
        for (const v of [0.33, 0.66]) faceLine(F, 0, v, 1, v);
        for (const [u, v0, v1] of [[0.5, 0, 0.33], [0.25, 0.33, 0.66], [0.75, 0.33, 0.66], [0.5, 0.66, 1]]) faceLine(F, u, v0, u, v1);
      }
      break;
    }
  }
}

function label(ctx: Ctx, theme: Theme, L: LabelEl, t: number) {
  const [x0, y0, x1, y1] = L.box, m = labelMetrics(L.size, L.subSize), solid = L.fill === 'solid';
  if (L.pulse > 0) { ctx.shadowColor = L.color; ctx.shadowBlur = 14 + 14 * L.pulse; }
  rr(ctx, x0, y0, x1 - x0, y1 - y0, 10);
  ctx.fillStyle = solid ? L.color : 'rgba(6,22,51,0.94)'; ctx.fill();
  ctx.shadowBlur = 0;
  if (solid) { ctx.strokeStyle = 'rgba(6,22,51,0.35)'; ctx.lineWidth = 2; } else { ctx.strokeStyle = L.color; ctx.lineWidth = 2.5 + 1.5 * L.pulse; }
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const cx = (x0 + x1) / 2, maxW = x1 - x0 - 2 * m.padX + 1;
  const base = y0 + m.padY + (m.pitch + L.size * theme.font.cap) / 2;
  font(ctx, theme, L.size);
  L.lines.forEach((line, i) => { ctx.fillStyle = solid ? theme.ink : theme.paper; ctx.fillText(line, cx, base + i * m.pitch, maxW); });
  if (L.sub) {
    font(ctx, theme, L.subSize);
    ctx.fillStyle = solid ? theme.ink : L.color;
    ctx.fillText(L.sub, cx, y0 + m.padY + L.lines.length * m.pitch + (m.subPitch + L.subSize * theme.font.cap) / 2, maxW);
  }
  void t;
}

function packet(ctx: Ctx, theme: Theme, p: PacketEl) {
  ctx.shadowColor = p.color; ctx.shadowBlur = 18;
  if (p.glyph === 'locked') { ctx.shadowBlur = 0; lock(ctx, theme, p.x, p.y, p.r * 0.85, p.color); return; }
  const hw = p.r, hh = p.r * ISO * 1.2;
  ctx.fillStyle = p.color; poly(ctx, [[p.x, p.y - hh], [p.x + hw, p.y], [p.x, p.y + hh], [p.x - hw, p.y]]); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  poly(ctx, [[p.x, p.y - hh * 0.45], [p.x + hw * 0.45, p.y], [p.x, p.y + hh * 0.45], [p.x - hw * 0.45, p.y]]); ctx.fill();
}

function mark(ctx: Ctx, theme: Theme, x: number, y: number, r: number, t: number) {
  const red = theme.roles.blocked;
  ctx.shadowColor = red; ctx.shadowBlur = 14 + 6 * Math.sin(t * 6);
  ctx.fillStyle = theme.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = red; ctx.lineWidth = 3; ctx.stroke();
  ctx.lineCap = 'round'; ctx.lineWidth = 4;
  const q = r * 0.45;
  ctx.beginPath(); ctx.moveTo(x - q, y - q); ctx.lineTo(x + q, y + q); ctx.moveTo(x + q, y - q); ctx.lineTo(x - q, y + q); ctx.stroke();
}
