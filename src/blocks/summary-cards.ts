// summary-cards: a vertical stack of takeaway cards, each with an icon, a title and one or two lines of text.
// An icon may reuse a node id from an earlier scene, so that node glides into its card.
import type { BlockDef, Box, El } from '../types.ts';
import { textWidth, wrap } from '../util.ts';
import { Props, enter, fade, pop } from './common.ts';

export const summaryCards: BlockDef = {
  type: 'summary-cards',
  describe: 'A stack of 2 to 4 takeaway cards (icon + title + short sentence), revealed one by one.',
  build(spec, { theme, slot, problems }) {
    const p = new Props(spec, `block "${spec.id}"`, problems, theme);
    const id = p.id(spec.id, 'id');
    const gap = 22, list = p.list(spec.cards, 'cards');
    if (list.length > 4) p.fail('more than 4 cards -> split the takeaway into two scenes');
    const cardH = (slot[3] - slot[1] - gap * (list.length - 1)) / Math.max(1, list.length);
    const iconW = 150, padX = 26, titleSz = theme.type.label, bodySz = Math.max(theme.type.minPx + 4, theme.type.text - 4);
    const cards = list.map((c, i) => {
      const cid = p.id(c.id, `cards[${i}].id`);
      const role = p.role(c.role, `card "${cid}" role`, 'public');
      const title = p.text(c.title, `card "${cid}" title`, 3);
      const textW = slot[2] - slot[0] - iconW - 2 * padX;
      const body = typeof c.text === 'string' ? wrap(theme, c.text, bodySz, textW) : [];
      const bad = [...(typeof c.text === 'string' ? c.text : '')].filter(ch => !(ch in theme.font.adv));
      if (bad.length) p.fail(`card "${cid}" text has characters not in the font: ${[...new Set(bad)].join(' ')}`);
      const need = titleSz * 1.2 + body.length * bodySz * 1.15 + 30;
      if (need > cardH) p.fail(`card "${cid}" text needs ${Math.round(need)} px but cards are ${Math.round(cardH)} px tall -> shorten "text"`);
      const y0 = slot[1] + i * (cardH + gap), box: Box = [slot[0], y0, slot[2], y0 + cardH];
      const ic = (c.icon ?? {}) as Record<string, unknown>;
      const itype = p.oneOf(ic.type, `card "${cid}" icon.type`, Object.keys(theme.nodeSizes), 'server');
      return { id: cid, role, title, body, box, icon: { id: typeof ic.id === 'string' ? ic.id : `${cid}:icon`, type: itype } };
    });

    return {
      ids: [id, ...cards.map(c => c.id), ...cards.map(c => c.icon.id)],
      frame(t, cues) {
        const out: El[] = [];
        const base = cues.appear(id) === -Infinity ? 0 : cues.appear(id);
        cards.forEach((c, i) => {
          const named = cues.mentioned(c.id) ? c.id : cues.mentioned(c.icon.id) && !cues.carried(c.icon.id) ? c.icon.id : null;
          const k = named ? enter(cues, named, t) : Math.max(0, Math.min(1, (t - base - 0.5 * i) / 0.55));
          // a carried icon glides into its card's spot right away; the card itself appears on its beat
          const iconK = cues.carried(c.icon.id) ? 1 : k;
          if (iconK <= 0) return;
          const color = theme.roles[c.role], a = fade(k), [x0, y0, x1, y1] = c.box;
          const { hw, h } = theme.nodeSizes[c.icon.type], s = Math.min(1.4, (y1 - y0) * 0.55 / (h + hw * 0.6));
          out.push({ kind: 'node', id: c.icon.id, owner: c.id, alpha: fade(iconK), z: 58, type: c.icon.type, x: x0 + iconW / 2, y: (y0 + y1) / 2 + (h * s) / 2, scale: s * pop(iconK), color, glow: cues.pulse(c.id, t) });
          if (k <= 0) return;
          out.push({ kind: 'panel', id: `${c.id}:card`, owner: c.id, alpha: a, z: 55, box: c.box, fill: '#0a2350', stroke: color, strokeWidth: 3, radius: 14 });
          const tx = x0 + iconW + padX, blockH = titleSz * 1.2 + c.body.length * bodySz * 1.15, ty = (y0 + y1) / 2 - blockH / 2;
          out.push({ kind: 'text', id: `${c.id}:title`, owner: c.id, alpha: a, z: 60, box: [tx, ty, tx + textWidth(theme, c.title, titleSz), ty + titleSz * 1.05], text: c.title, size: titleSz, color, align: 'left' });
          c.body.forEach((line, j) => {
            const ly = ty + titleSz * 1.2 + j * bodySz * 1.15;
            out.push({ kind: 'text', id: `${c.id}:body${j}`, owner: c.id, alpha: a, z: 60, box: [tx, ly, tx + textWidth(theme, line, bodySz), ly + bodySz * 1.05], text: line, size: bodySz, color: theme.paper, align: 'left' });
          });
        });
        return out;
      },
    };
  },
};
