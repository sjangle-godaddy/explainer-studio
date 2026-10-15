// mesh-graph: N nodes on a circle, either fully meshed (every pair linked) or attached to one hub.
// Node ids are stable, so the runtime glides them between a mesh scene and a hub scene.
import type { BlockDef, BlockInstance, Box, El, Pt } from '../types.ts';
import { boxCenter } from '../util.ts';
import { ENTER, Props, enter, fade, labelLines, placeLabel, pop, type Side } from './common.ts';
import { nodeBox, nodeCenter } from './network-map.ts';

interface MNode { id: string; type: string; role: string; x: number; y: number; hw: number; h: number; scale: number; lines?: string[]; sub?: string; side: Side | 'radial'; angle?: number; }

export const meshGraph: BlockDef = {
  type: 'mesh-graph',
  describe: 'Many identical nodes (VPCs, services) on a circle: "mesh" links every pair to show how connections explode, "hub" attaches all of them to one central node.',
  build(spec, { theme, slot, problems }): BlockInstance {
    const p = new Props(spec, `block "${spec.id}"`, problems, theme);
    const id = p.id(spec.id, 'id');
    const mode = p.oneOf(spec.mode, 'mode', ['mesh', 'hub'] as const, 'mesh');
    const count = Math.round(p.num(spec.count, 'count', 8, 3, 40));
    const type = p.oneOf(spec.nodeType, 'nodeType', Object.keys(theme.nodeSizes), 'vpc');
    const role = p.role(spec.role, 'role', 'public');
    // a fixed default, so the same ring keeps its node ids when the block id changes between scenes
    const prefix = typeof spec.prefix === 'string' ? spec.prefix : 'n';
    const named = Array.isArray(spec.named) ? spec.named as Record<string, unknown>[] : [];
    const extras = Array.isArray(spec.extras) ? spec.extras as Record<string, unknown>[] : [];
    if (named.length > count) p.fail(`"named" lists ${named.length} nodes but count is ${count}`);

    const [cx, cy] = boxCenter(slot);
    const gapDeg = extras.length ? p.num(spec.gap, 'gap', 70, 0, 180) : 0;
    const R = Math.min(slot[2] - slot[0], slot[3] - slot[1]) / 2 - p.num(spec.margin, 'margin', 90, 0, 400);
    const scale = p.num(spec.nodeScale, 'nodeScale', count > 12 ? 0.6 : 0.85, 0.3, 1.5);

    // Positions are numbered clockwise from the top. A gap at the bottom (for extras) squeezes the same
    // positions towards the top, so a node keeps roughly its place when a later scene adds the gap.
    const gap = gapDeg * Math.PI / 180;
    const angleOf = (i: number) => {
      if (!gap) return -Math.PI / 2 + 2 * Math.PI * i / count;
      // rank 0 is the node nearest the bottom; spreading ranks evenly keeps the gap centred on the bottom
      const rank = (i + Math.floor(count / 2)) % count, span = 2 * Math.PI - gap;
      return Math.PI / 2 + gap / 2 + span * (rank + 0.5) / count;
    };
    const slotIds: (Record<string, unknown> | null)[] = Array(count).fill(null);
    named.forEach((nm, i) => {
      const at = Math.round(p.num(nm.at, `named[${i}].at`, i, 0, count - 1));
      if (slotIds[at]) p.fail(`named[${i}] uses position ${at}, which is already taken`);
      slotIds[at] = nm;
    });
    const nodes: MNode[] = [];
    for (let i = 0; i < count; i++) {
      const a = angleOf(i), nm = slotIds[i];
      const nid = nm ? p.id(nm.id, `named node id`) : `${prefix}${i + 1}`;
      const { hw, h } = theme.nodeSizes[type];
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a) + h * scale / 2;
      nodes.push({ id: nid, type, role, x, y, hw, h, scale, lines: nm ? labelLines(p, nm.label, `named node "${nid}" label`) : undefined, sub: nm && nm.sub !== undefined ? p.text(nm.sub, `named node "${nid}" sub`) : undefined, side: nm && typeof nm.side === 'string' ? nm.side as Side : 'radial', angle: a });
    }
    // extras sit in the gap at the bottom, on the same circle
    extras.forEach((e, i) => {
      const eid = p.id(e.id, `extras[${i}].id`), et = p.oneOf(e.type, `extra "${eid}" type`, Object.keys(theme.nodeSizes), 'datacenter');
      const a = Math.PI / 2 + (extras.length > 1 ? ((i / (extras.length - 1)) - 0.5) * (gapDeg * 0.6) * Math.PI / 180 : 0);
      const { hw, h } = theme.nodeSizes[et];
      nodes.push({ id: eid, type: et, role: p.role(e.role, `extra "${eid}" role`, 'onprem'), x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) + h * 0.85 / 2, hw, h, scale: 0.85, lines: labelLines(p, e.label, `extra "${eid}" label`), sub: e.sub === undefined ? undefined : p.text(e.sub, `extra "${eid}" sub`), side: (e.side as Side) ?? 'below' });
    });

    let hub: MNode | null = null;
    if (mode === 'hub') {
      const h0 = (spec.hub ?? {}) as Record<string, unknown>;
      const ht = p.oneOf(h0.type, 'hub.type', Object.keys(theme.nodeSizes), 'router');
      const { hw, h } = theme.nodeSizes[ht];
      hub = { id: p.id(h0.id, 'hub.id'), type: ht, role: p.role(h0.role, 'hub.role', 'gateway'), x: cx, y: cy + h / 2, hw, h, scale: 1.2, lines: labelLines(p, h0.label, 'hub.label'), sub: h0.sub === undefined ? undefined : p.text(h0.sub, 'hub.sub'), side: (h0.side as Side) ?? 'below' };
    }

    const all = hub ? [hub, ...nodes] : nodes;
    const boxOf = (n: MNode): Box => nodeBox(n.x, n.y, n.hw, n.h, n.scale);
    const centerOf = (n: MNode): Pt => nodeCenter(n, n.scale);
    const byId = new Map(all.map(n => [n.id, n]));
    // Ring labels sit outside the ring along the node's own direction, so they never cover a neighbour.
    const radialLabel = (n: MNode) => {
      const L = placeLabel(theme, { id: `${n.id}:label`, owner: n.id, lines: n.lines!, sub: n.sub, color: theme.roles[n.role], anchor: boxOf(n) });
      const w = L.box[2] - L.box[0], h = L.box[3] - L.box[1], ux = Math.cos(n.angle!), uy = Math.sin(n.angle!);
      const [nx, ny] = centerOf(n), reach = (n.hw + 10) * n.scale + (Math.abs(ux) * w + Math.abs(uy) * h) / 2;
      const lx = nx + ux * reach, ly = ny + uy * reach;
      L.box = [lx - w / 2, ly - h / 2, lx + w / 2, ly + h / 2];
      return L;
    };

    // links: every pair in mesh mode, one spoke per node in hub mode (extras get a tunnel)
    interface MLink { id: string; a: MNode; b: MNode; order: number; tunnel: boolean; }
    const links: MLink[] = [];
    const ring = nodes.slice(0, count);
    if (mode === 'mesh') {
      let k = 0;
      for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) links.push({ id: `${id}:${ring[i].id}-${ring[j].id}`, a: ring[i], b: ring[j], order: k++, tunnel: false });
    } else if (hub) {
      nodes.forEach((n, i) => links.push({ id: `${hub!.id}-${n.id}`, a: hub!, b: n, order: i, tunnel: i >= count }));
    }
    const drawWindow = p.num(spec.drawTime, 'drawTime', mode === 'mesh' ? 3 : 1.6, 0.2, 10);
    const linkColor = theme.roles[p.role(spec.linkColor, 'linkColor', mode === 'mesh' ? 'public' : 'gateway')];

    return {
      ids: [id, ...all.map(n => n.id), ...links.filter(l => l.tunnel).map(l => l.id)],
      frame(t, cues) {
        const out: El[] = [];
        const base = cues.appear(id) === -Infinity ? 0 : cues.appear(id);
        for (const l of links) {
          const ends = Math.max(cues.appear(l.a.id), cues.appear(l.b.id));
          const a0 = cues.mentioned(l.id) ? cues.appear(l.id)
            : cues.carried(l.id) || (ends === -Infinity && cues.carried(id)) ? -Infinity
            : Math.max(base, ends) + 0.3 + drawWindow * l.order / Math.max(1, links.length);
          const k = Math.max(0, Math.min(1, (t - a0) / (mode === 'mesh' ? 0.5 : 0.6)));
          if (k <= 0) continue;
          out.push({ kind: 'link', id: l.id, owner: l.tunnel ? l.id : id, alpha: mode === 'mesh' ? 0.75 : 1, z: 20, pts: [centerOf(l.a), centerOf(l.b)], color: l.tunnel ? theme.roles.response : linkColor, width: mode === 'mesh' ? 2 : 4.5, dashed: false, style: l.tunnel ? 'tunnel' : 'line', progress: fade(k), ends: [l.a.id, l.b.id], mayCross: mode === 'mesh' });
        }
        for (const [i, n] of all.entries()) {
          const own = cues.mentioned(n.id) || cues.carried(n.id) ? enter(cues, n.id, t) : Math.max(0, Math.min(1, (t - base - 0.04 * i) / ENTER));
          if (own <= 0) continue;
          const pulse = cues.pulse(n.id, t);
          out.push({ kind: 'node', id: n.id, owner: n.id, alpha: fade(Math.min(1, own * 2)), z: 30 + n.y / 10000, type: n.type, x: n.x, y: n.y, scale: n.scale * pop(own), color: theme.roles[n.role], glow: pulse });
          if (n.lines) {
            const L = n.side === 'radial' ? radialLabel(n) : placeLabel(theme, { id: `${n.id}:label`, owner: n.id, lines: n.lines, sub: n.sub, color: theme.roles[n.role], anchor: boxOf(n), side: n.side, gap: 8 });
            L.alpha = fade(Math.max(0, (own - 0.3) / 0.7)); L.pulse = pulse;
            out.push(L);
          }
        }
        return out;
      },
      route(ids) {
        if (!byId.has(ids[0])) return null;
        const pts: Pt[] = [], stops: number[] = [];
        for (const nid of ids) {
          const n = byId.get(nid);
          if (!n) return `"${nid}" is not a node of block "${id}"`;
          pts.push(centerOf(n)); stops.push(pts.length - 1);
        }
        return { pts, stops };
      },
      anchor(nid) {
        const n = byId.get(nid);
        if (!n) return null;
        const c = centerOf(n);
        return { x: c[0], y: c[1], r: (n.hw + 8) * n.scale };
      },
    };
  },
};
