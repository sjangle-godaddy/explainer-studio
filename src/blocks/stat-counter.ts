// stat-counter: one big number with a caption line under it; beats change it with "set".
import type { BlockDef, El } from '../types.ts';
import { boxCenter, easeInOutCubic, lerp } from '../util.ts';
import { Props, enter, fade, labelSize } from './common.ts';

export const statCounter: BlockDef = {
  type: 'stat-counter',
  describe: 'A big number that counts between values (e.g. "190" connections to "20"), with a short label under it.',
  build(spec, { theme, slot, problems }) {
    const p = new Props(spec, `block "${spec.id}"`, problems, theme);
    const id = p.id(spec.id, 'id');
    const value = p.num(spec.value, 'value', 0);
    const label = p.text(spec.label, 'label', 4);
    const role = p.role(spec.role, 'role', 'gateway');
    const size = Math.min(theme.type.stat, (slot[3] - slot[1]) * 0.62);
    const labelSz = theme.type.sub;
    const [cx, cy] = boxCenter(slot);
    const textBox = (s: string, sz: number, y: number) => {
      const { w } = labelSize(theme, [s], undefined, sz, sz);
      return [cx - w / 2, y, cx + w / 2, y + sz * 1.05] as [number, number, number, number];
    };
    if (size < 60) p.fail(`slot is only ${Math.round(slot[3] - slot[1])} px tall for a stat counter -> use a layout with a taller "stat" slot`);
    return {
      ids: [id],
      frame(t, cues) {
        const k = enter(cues, id, t, 0.5);
        if (k <= 0) return [];
        const v = cues.value(id, t), from = v.from ?? value, to = v.value ?? value;
        const n = Math.round(lerp(from, to, easeInOutCubic(v.k)));
        const lab = v.label ?? label, top = cy - (size + labelSz * 1.2) / 2;
        const out: El[] = [
          { kind: 'text', id: `${id}:value`, owner: id, alpha: fade(k), z: 60, box: textBox(String(n), size, top), text: String(n), size, color: theme.roles[role], align: 'center' },
          { kind: 'text', id: `${id}:label`, owner: id, alpha: fade(k), z: 60, box: textBox(lab, labelSz, top + size * 1.05 + 4), text: lab, size: labelSz, color: theme.paper, align: 'center' },
        ];
        return out;
      },
    };
  },
};
