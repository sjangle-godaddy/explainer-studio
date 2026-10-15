// table: a small table (route table, comparison); a row lights up while a beat pulses or focuses it.
import type { BlockDef, Box, El } from '../types.ts';
import { mixHex, textWidth } from '../util.ts';
import { Props, enter, fade } from './common.ts';

export const table: BlockDef = {
  type: 'table',
  describe: 'A titled table with a header row; each row has an id so beats can pulse it (for example the route a packet matches).',
  build(spec, { theme, slot, problems }) {
    const p = new Props(spec, `block "${spec.id}"`, problems, theme);
    const id = p.id(spec.id, 'id');
    const title = spec.title === undefined ? undefined : p.text(spec.title, 'title', 4);
    const columns = p.list(spec.columns, 'columns').map((c, i) => p.text(c, `columns[${i}]`, 3));
    const rows = p.list(spec.rows, 'rows').map((r, i) => {
      const cells = Array.isArray(r.cells) ? r.cells.map((c, j) => p.text(c, `rows[${i}].cells[${j}]`, 3)) : [];
      if (cells.length !== columns.length) p.fail(`rows[${i}] has ${cells.length} cells but there are ${columns.length} columns`);
      return { id: p.id(r.id, `rows[${i}].id`), cells };
    });
    const role = p.role(spec.role, 'role', 'gateway');
    const accent = theme.roles[role];

    const titleH = title ? 56 : 0, n = rows.length + 1;
    const rowH = Math.min(64, (slot[3] - slot[1] - titleH) / n);
    const size = Math.min(theme.type.text, rowH * 0.58);
    const w = slot[2] - slot[0], padX = 20;
    // column widths in proportion to their widest cell
    const widest = columns.map((c, j) => Math.max(textWidth(theme, c, size), ...rows.map(r => textWidth(theme, r.cells[j] ?? '', size))) + 2 * padX);
    const need = widest.reduce((a, b) => a + b, 0);
    if (need > w) p.fail(`table is ${Math.round(need)} px wide but the slot is ${Math.round(w)} px -> shorten cells or use a wider slot`);
    const extra = Math.max(0, w - need) / columns.length;
    const colX: number[] = []; let x = slot[0];
    for (const cw of widest) { colX.push(x); x += cw + extra; }
    const top = slot[1] + titleH;
    if (size < theme.type.minPx) p.fail(`table rows are too short for readable text -> use fewer rows or a taller slot`);

    return {
      ids: [id, ...rows.map(r => r.id)],
      frame(t, cues) {
        const k = enter(cues, id, t, 0.5);
        if (k <= 0) return [];
        const out: El[] = [];
        if (title) out.push({ kind: 'text', id: `${id}:title`, owner: id, alpha: fade(k), z: 60, box: [slot[0], slot[1], slot[0] + textWidth(theme, title, theme.type.sub), slot[1] + theme.type.sub * 1.05], text: title, size: theme.type.sub, color: accent, align: 'left' });
        const row = (rid: string, cells: string[], i: number, header: boolean) => {
          const base = cues.appear(id) === -Infinity ? -9 : cues.appear(id);
          const rk = header ? k : cues.mentioned(rid) ? enter(cues, rid, t, 0.4) : Math.max(0, Math.min(1, (t - base - 0.3 - 0.12 * i) / 0.4));
          if (rk <= 0) return;
          const y0 = top + i * rowH, box: Box = [slot[0], y0 + 3, slot[2], y0 + rowH - 3];
          const hot = header ? 0 : cues.pulse(rid, t);
          out.push({ kind: 'panel', id: `${rid}:row`, owner: header ? id : rid, alpha: fade(rk), z: 55, box, fill: header ? accent : mixHex('#0a2350', accent, 0.12 + 0.5 * hot), stroke: header ? accent : mixHex('#2b4c86', accent, hot), strokeWidth: 2 + 2 * hot, radius: 8 });
          cells.forEach((c, j) => out.push({ kind: 'text', id: `${rid}:c${j}`, owner: header ? id : rid, alpha: fade(rk), z: 60, box: [colX[j] + padX, y0 + (rowH - size) / 2, colX[j] + padX + textWidth(theme, c, size), y0 + (rowH + size) / 2], text: c, size, color: header ? theme.ink : theme.paper, align: 'left' }));
        };
        row(`${id}:head`, columns, 0, true);
        rows.forEach((r, i) => row(r.id, r.cells, i + 1, false));
        return out;
      },
    };
  },
};
