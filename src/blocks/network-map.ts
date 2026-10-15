// network-map: zones (nested, stacked or side by side), isometric nodes, links and tunnels.
// Packets are not drawn here: the runtime asks route() for the geometry and draws flows itself.
import type { BlockDef, BlockInstance, Box, El, LabelEl, Pt, Theme } from '../types.ts';
import { ISO, boxCenter, segHitsBox, inset, inter } from '../util.ts';
import { ENTER, Props, enter, fade, labelLines, labelSize, placeLabel, pop, type Side } from './common.ts';

interface Zone { id: string; label: string; role: string; size: number; box: Box; inner: Box; depth: number; dashed: boolean; children: Zone[]; }
interface Node { id: string; type: string; role: string; x: number; y: number; hw: number; h: number; lines: string[]; sub?: string; side: Side; box: Box; }
interface Link { id: string; from: string; to: string; style: 'line' | 'tunnel'; dashed: boolean; color: string; pts: Pt[]; }

const ZONE_PAD = 16, HEADER = 54;
const SIDES = ['below', 'above', 'left', 'right'] as const;

/** Ground point is (x, y); the icon rises h above it. This is the box the icon covers. */
export function nodeBox(x: number, y: number, hw: number, h: number, scale = 1): Box {
  return [x - hw * scale, y - (h + hw * ISO) * scale, x + hw * scale, y + hw * ISO * scale + 4];
}
export const nodeCenter = (n: { x: number; y: number; h: number }, scale = 1): Pt => [n.x, n.y - n.h * scale / 2];

export const networkMap: BlockDef = {
  type: 'network-map',
  describe: 'Zones (internet, VPC, data center, subnets) holding isometric nodes (servers, gateways, routers, VPCs) joined by links or encrypted tunnels; packets can travel along routes.',
  build(spec, { theme, slot, problems }): BlockInstance {
    const p = new Props(spec, `block "${spec.id}"`, problems, theme);
    const zones: Zone[] = [], zoneById = new Map<string, Zone>();

    // ---------- zones ----------
    function layoutZones(list: Record<string, unknown>[], box: Box, dir: string, depth: number, parentRole: string | null): Zone[] {
      const items = list.map((z, i) => ({ z, size: p.num(z.size, `zones[${i}].size`, 1, 0.1, 10) }));
      const total = items.reduce((a, it) => a + it.size, 0), gap = 18;
      const span = (dir === 'row' ? box[2] - box[0] : box[3] - box[1]) - gap * (items.length - 1);
      let at = dir === 'row' ? box[0] : box[1];
      return items.map(({ z, size }, i) => {
        const len = span * size / total;
        const b: Box = dir === 'row' ? [at, box[1], at + len, box[3]] : [box[0], at, box[2], at + len];
        at += len + gap;
        const id = p.id(z.id, `zones[${i}].id`);
        const role = p.oneOf(z.role, `zone "${id}" role`, ['external', 'boundary', 'public', 'private', 'neutral', 'aws', 'onprem'] as const, 'neutral');
        if (parentRole && role === parentRole) p.fail(`zone "${id}" uses the same role as its parent -> give it a different role so it stands out`);
        const zone: Zone = { id, label: p.text(z.label, `zone "${id}" label`, 4), role, size, box: b, inner: b, depth, dashed: role === 'boundary', children: [] };
        const kids = Array.isArray(z.children) ? z.children as Record<string, unknown>[] : [];
        zone.inner = inset(b, ZONE_PAD);
        zone.inner[1] = b[1] + HEADER;
        if (kids.length) zone.children = layoutZones(kids, zone.inner, p.oneOf(z.direction, `zone "${id}" direction`, ['row', 'column'] as const, 'column'), depth + 1, role);
        if (b[3] - b[1] < HEADER + 60) p.fail(`zone "${id}" is only ${Math.round(b[3] - b[1])} px tall -> raise its "size" or use fewer zones`);
        if (b[2] - b[0] < 160) p.fail(`zone "${id}" is only ${Math.round(b[2] - b[0])} px wide -> raise its "size" or stack zones in a column`);
        if (zoneById.has(id)) p.fail(`zone id "${id}" is used twice`);
        zoneById.set(id, zone); zones.push(zone);
        return zone;
      });
    }
    layoutZones(Array.isArray(spec.zones) ? spec.zones as Record<string, unknown>[] : [], slot, p.oneOf(spec.direction, 'direction', ['row', 'column'] as const, 'column'), 0, null);

    // ---------- nodes ----------
    const nodes: Node[] = [], nodeById = new Map<string, Node>();
    p.list(spec.nodes, 'nodes').forEach((n, i) => {
      const id = p.id(n.id, `nodes[${i}].id`);
      const type = p.oneOf(n.type, `node "${id}" type`, Object.keys(theme.nodeSizes), 'server');
      const zone = typeof n.zone === 'string' ? zoneById.get(n.zone) : undefined;
      const area = zone ? zone.inner : slot;
      if (n.zone !== undefined && !zone) p.fail(`node "${id}" names zone "${String(n.zone)}" which does not exist`);
      const fx = p.num(n.x, `node "${id}" x`, 0.5, 0, 1), fy = p.num(n.y, `node "${id}" y`, 0.6, 0, 1);
      const { hw, h } = theme.nodeSizes[type];
      let x = area[0] + (area[2] - area[0]) * fx, y = area[1] + (area[3] - area[1]) * fy;
      const edge = n.edge === undefined ? undefined : p.oneOf(n.edge, `node "${id}" edge`, ['top', 'bottom', 'left', 'right'] as const, 'top');
      if (edge && !zone) p.fail(`node "${id}" sets "edge" but has no "zone" -> name the zone whose edge it sits on`);
      if (edge && zone) {
        if (edge === 'top') y = zone.box[1] + h / 2;
        if (edge === 'bottom') y = zone.box[3] + h / 2;
        if (edge === 'left') x = zone.box[0];
        if (edge === 'right') x = zone.box[2];
      }
      const role = p.role(n.role, `node "${id}" role`, ['gateway', 'vpngw', 'router', 'firewall'].includes(type) ? 'gateway' : zone ? (zone.role === 'boundary' ? 'boundary' : zone.role) : 'external');
      const node: Node = { id, type, role, x, y, hw, h, lines: labelLines(p, n.label, `node "${id}" label`), sub: n.sub === undefined ? undefined : p.text(n.sub, `node "${id}" sub`, 4), side: p.oneOf(n.side, `node "${id}" side`, SIDES, 'below'), box: nodeBox(x, y, hw, h) };
      if (nodeById.has(id) || zoneById.has(id)) p.fail(`id "${id}" is used twice`);
      nodes.push(node); nodeById.set(id, node);
    });

    // ---------- links ----------
    const links: Link[] = [];
    (Array.isArray(spec.links) ? spec.links as Record<string, unknown>[] : []).forEach((l, i) => {
      const a = nodeById.get(String(l.from)), b = nodeById.get(String(l.to));
      if (!a || !b) { p.fail(`links[${i}] joins "${String(l.from)}" and "${String(l.to)}" but both must be node ids`); return; }
      if (links.some(x => (x.from === a.id && x.to === b.id) || (x.from === b.id && x.to === a.id))) p.fail(`links[${i}]: "${a.id}" and "${b.id}" are already linked -> keep one link per pair (use style "tunnel" for an encrypted one)`);
      const id = l.id === undefined ? `${a.id}-${b.id}` : p.id(l.id, `links[${i}].id`);
      const style = p.oneOf(l.style, `link "${id}" style`, ['line', 'tunnel'] as const, 'line');
      const bend = p.oneOf(l.bend, `link "${id}" bend`, ['direct', 'hv', 'vh'] as const, 'direct');
      const A = nodeCenter(a), B = nodeCenter(b);
      const pts: Pt[] = bend === 'direct' || Math.abs(A[0] - B[0]) < 4 || Math.abs(A[1] - B[1]) < 4 ? [A, B] : bend === 'hv' ? [A, [B[0], A[1]], B] : [A, [A[0], B[1]], B];
      for (const o of nodes) {
        if (o === a || o === b) continue;
        for (let s = 1; s < pts.length; s++) if (segHitsBox(pts[s - 1], pts[s], inset(o.box, -6))) {
          p.fail(`the link between "${a.id}" and "${b.id}" would pass through "${o.id}" -> move one of them with x/y, change "bend", or route the traffic through "${o.id}"`);
          s = pts.length;
        }
      }
      links.push({ id, from: a.id, to: b.id, style, dashed: l.dashed === true, color: theme.roles[p.role(l.color, `link "${id}" color`, style === 'tunnel' ? 'response' : 'neutral')], pts });
    });

    // labels must not cover any node (their own included); checked again at runtime against packets
    const labelOf = (n: Node) => placeLabel(theme, { id: `${n.id}:label`, owner: n.id, lines: n.lines, sub: n.sub, color: theme.roles[n.role], anchor: n.box, side: n.side });
    for (const n of nodes) {
      const L = labelOf(n);
      const hit = nodes.find(o => o !== n && inter(L.box, inset(o.box, -4)));
      if (hit) p.fail(`the label of "${n.id}" covers "${hit.id}" -> set "side" on "${n.id}" to one of ${SIDES.filter(s => s !== n.side).join(', ')}, or move it`);
    }
    for (const z of zones) if (z.depth > 0) {
      const { w } = labelSize(theme, [z.label], undefined, theme.type.sub, theme.type.sub);
      if (w > z.box[2] - z.box[0] - 24) p.fail(`zone label "${z.label}" is wider than its zone -> shorten it`);
    }

    const linkAppear = (cues: Parameters<BlockInstance['frame']>[1], l: Link) =>
      cues.mentioned(l.id) ? cues.appear(l.id) : Math.max(cues.appear(l.from), cues.appear(l.to)) + 0.25;

    return {
      ids: [...zones.map(z => z.id), ...nodes.map(n => n.id), ...links.map(l => l.id)],
      frame(t, cues) {
        const out: El[] = [];
        for (const z of zones) {
          const k = enter(cues, z.id, t, 0.8);
          if (k <= 0) continue;
          out.push({ kind: 'zone', id: z.id, owner: z.id, alpha: fade(Math.min(1, k * 1.6)), z: z.depth, box: z.box, fill: theme.zoneFill[z.role], edge: z.role === 'boundary' ? theme.roles.boundary : theme.roles[z.role], dashed: z.dashed, progress: fade(k), lip: 10 });
          const sz = theme.type.sub, L = placeLabel(theme, { id: `${z.id}:label`, owner: z.id, lines: [z.label], color: theme.roles[z.role], anchor: [z.box[0] + 12, z.box[1] + 10, z.box[0] + 12, z.box[1] + 10], side: 'right', gap: 0, size: sz, subSize: sz, fill: 'solid', z: 40 });
          const h = L.box[3] - L.box[1];
          L.box = [L.box[0], z.box[1] + 10, L.box[2], z.box[1] + 10 + h];
          L.alpha = fade(k);
          out.push(L);
        }
        for (const l of links) {
          const a = linkAppear(cues, l), k = a === -Infinity ? 1 : Math.max(0, Math.min(1, (t - a) / 0.6));
          if (k <= 0) continue;
          out.push({ kind: 'link', id: l.id, owner: l.id, alpha: 1, z: 20, pts: l.pts, color: l.color, width: l.style === 'tunnel' ? 5 : 4.5, dashed: l.dashed, style: l.style, progress: fade(k), ends: [l.from, l.to] });
        }
        for (const n of nodes) {
          const k = enter(cues, n.id, t, ENTER);
          if (k <= 0) continue;
          const pulse = cues.pulse(n.id, t);
          out.push({ kind: 'node', id: n.id, owner: n.id, alpha: fade(Math.min(1, k * 2)), z: 30 + n.y / 10000, type: n.type, x: n.x, y: n.y, scale: pop(k), color: theme.roles[n.role], glow: pulse });
          const L: LabelEl = labelOf(n);
          L.alpha = fade(Math.max(0, (k - 0.3) / 0.7)); L.pulse = pulse;
          out.push(L);
        }
        return out;
      },
      route(ids) {
        if (!nodeById.has(ids[0])) return null;
        const pts: Pt[] = [], stops: number[] = [];
        for (let i = 0; i < ids.length; i++) {
          const n = nodeById.get(ids[i]);
          if (!n) return `"${ids[i]}" is not a node of block "${spec.id}"`;
          if (i === 0) { pts.push(nodeCenter(n)); stops.push(0); continue; }
          const prev = ids[i - 1];
          const l = links.find(x => (x.from === prev && x.to === n.id) || (x.to === prev && x.from === n.id));
          const seg = l ? (l.from === prev ? l.pts : [...l.pts].reverse()) : [nodeCenter(nodeById.get(prev)!), nodeCenter(n)];
          pts.push(...seg.slice(1));
          stops.push(pts.length - 1);
        }
        return { pts, stops };
      },
      anchor(id) {
        const n = nodeById.get(id);
        if (n) { const c = nodeCenter(n); return { x: c[0], y: c[1], r: n.hw + 8 }; }
        const z = zoneById.get(id);
        if (z) { const c = boxCenter(z.box); return { x: c[0], y: c[1], r: Math.min(z.box[2] - z.box[0], z.box[3] - z.box[1]) / 2 }; }
        return null;
      },
    };
  },
};
