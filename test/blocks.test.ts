// Block harness: every block must build from its example, stay inside its slot, render deterministically,
// survive the renderer, and the checks must catch a broken layout. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderSmoke } from '../cli/smoke.ts';
import { BLOCKS } from '../src/blocks/index.ts';
import { verify } from '../src/checks/index.ts';
import { EpisodeError, compile, elBox } from '../src/runtime/compile.ts';
import { LAYOUTS } from '../src/runtime/layouts.ts';
import type { BlockSpec, Episode } from '../src/types.ts';
import { containsBox, inset } from '../src/util.ts';

const beat = { id: 'b1', caption: 'EXAMPLE', line: 'One example sentence that is long enough to read comfortably on screen.' };

const EXAMPLES: Record<string, BlockSpec> = {
  'network-map': {
    id: 'm', type: 'network-map',
    zones: [{ id: 'net', label: 'INTERNET', role: 'external', size: 0.8 }, { id: 'vpc', label: 'VPC', role: 'boundary', children: [{ id: 'sub', label: 'SUBNET', role: 'private' }] }],
    nodes: [{ id: 'users', type: 'users', zone: 'net', x: 0.3, label: 'USERS' }, { id: 'gw', type: 'gateway', zone: 'vpc', edge: 'top', x: 0.5, label: 'IGW', side: 'right' }, { id: 'srv', type: 'server', zone: 'sub', x: 0.5, label: 'APP', sub: '10.0.1.5', side: 'right' }],
    links: [{ from: 'gw', to: 'srv' }],
  },
  'mesh-graph': { id: 'g', type: 'mesh-graph', mode: 'hub', count: 12, named: [{ id: 'a', label: 'VPC A' }], hub: { id: 'hub', label: 'HUB' } },
  'stat-counter': { id: 'n', type: 'stat-counter', value: 42, label: 'THINGS', slot: 'stat' },
  'table': { id: 't', type: 'table', title: 'ROUTES', columns: ['DEST', 'TARGET'], rows: [{ id: 'r1', cells: ['10.0.0.0/16', 'LOCAL'] }], slot: 'strip' },
  'summary-cards': { id: 'c', type: 'summary-cards', cards: [{ id: 'k1', title: 'ONE', text: 'First takeaway in a sentence.' }, { id: 'k2', title: 'TWO', text: 'Second takeaway.' }] },
};
const LAYOUT_FOR: Record<string, string> = { 'stat-counter': 'hero+stat', 'table': 'main+strip' };

test('every registered block has an example', () => {
  assert.deepEqual(Object.keys(BLOCKS).sort(), Object.keys(EXAMPLES).sort());
});

for (const [type, spec] of Object.entries(EXAMPLES)) {
  test(`block ${type}: builds, stays in its slot, passes checks, is deterministic`, () => {
    const layout = LAYOUT_FOR[type] ?? 'full';
    const ep: Episode = { id: 'harness', title: type, scenes: [{ id: 's', layout, blocks: [spec], beats: [beat] }] };
    let E;
    try { E = compile(ep); } catch (e) { assert.fail(e instanceof EpisodeError ? e.problems.join('\n') : String(e)); }
    const v = verify(E);
    assert.ok(v.ok, v.fails.join('\n'));
    assert.equal(renderSmoke(E), null);
    const slot = LAYOUTS[layout].slots(E.theme)[spec.slot as string ?? 'main'];
    for (const t of [0.5, E.duration / 2, E.duration]) for (const e of E.frame(t)) {
      if (e.id.startsWith('caption:') || e.kind === 'ring' || e.kind === 'packet') continue;
      const b = elBox(E.theme, e);
      // labels may stick out of the slot (above a node on the top edge), but never out of the safe zone
      if (b) assert.ok(containsBox(e.kind === 'label' ? E.theme.safe : inset(slot, -24), b), `${e.id} at ${t}s is outside its slot: ${b.map(Math.round)}`);
    }
  });
}

test('checks catch a label pushed out of the safe zone', () => {
  const spec = structuredClone(EXAMPLES['network-map']) as BlockSpec & { nodes: Record<string, unknown>[] };
  spec.nodes[2] = { ...spec.nodes[2], x: 0.98, label: 'EXTRAORDINARILY WIDE' };
  const E = compile({ id: 'bad', title: 'bad', scenes: [{ id: 's', layout: 'full', blocks: [spec], beats: [beat] }] });
  const v = verify(E);
  assert.ok(v.fails.some(f => f.includes('leaves the safe zone')), v.fails.join('\n'));
});

test('compile rejects unknown ids in beats with a fix hint', () => {
  assert.throws(() => compile({ id: 'bad', title: 'bad', scenes: [{ id: 's', layout: 'full', blocks: [EXAMPLES['network-map']], beats: [{ ...beat, focus: ['nope'] }] }] }),
    (e: unknown) => e instanceof EpisodeError && e.problems.some(p => p.includes('"nope"')));
});

test('every episode in episodes/ passes', () => {
  for (const f of fs.readdirSync(new URL('../episodes', import.meta.url)).filter(f => f.endsWith('.json'))) {
    const E = compile(JSON.parse(fs.readFileSync(new URL(`../episodes/${f}`, import.meta.url), 'utf8')));
    const v = verify(E);
    assert.ok(v.ok, `${f}:\n` + v.fails.join('\n'));
  }
});

// ---------- regressions from the first code review ----------
const two = (beats: Episode['scenes'][number]['beats'], blocks: BlockSpec[] = [EXAMPLES['network-map']]): Episode =>
  ({ id: 'r', title: 'r', scenes: [{ id: 's', layout: 'full', blocks, beats }] });
const rejects = (ep: Episode, needle: string) => assert.throws(() => compile(ep), (e: unknown) => e instanceof EpisodeError && e.problems.some(p => p.includes(needle)));

test('bad flow numbers, cue shapes and set values are rejected at compile time', () => {
  rejects(two([{ ...beat, flows: [{ route: ['users', 'gw'], period: 0 }] }]), 'period');
  rejects(two([{ ...beat, flows: [{ route: ['users', 'gw'], mode: 'zigzag' as 'once' }] }]), 'mode');
  rejects(two([{ ...beat, focus: 'users' as unknown as string[] }]), 'must be an array');
  rejects(two([{ ...beat, dur: 0 }]), 'dur');
  rejects(two([{ ...beat, set: { n: { value: 'abc' as unknown as number } } }], [EXAMPLES['stat-counter']]), 'value must be a number');
});

test('transforms apply in route order, whatever order they are listed in', () => {
  const E = compile(two([{ ...beat, dur: 8, flows: [{ route: ['users', 'gw', 'srv'], mode: 'once', dur: 4, line: false, transform: [{ at: 'srv', glyph: 'locked' }, { at: 'gw', color: 'private' }] }] }]));
  const looks = E.flowsOf(0)[0].looks.map(l => [l.color, l.glyph]);
  assert.deepEqual(looks, [[E.theme.roles.public, 'plain'], [E.theme.roles.private, 'plain'], [E.theme.roles.private, 'locked']]);
});

test('a mesh carried into the next scene keeps its links drawn', () => {
  const mesh = { id: 'g', type: 'mesh-graph', mode: 'mesh', count: 6 };
  const E = compile({ id: 'r', title: 'r', scenes: [
    { id: 'a', layout: 'full', blocks: [mesh], beats: [beat] },
    { id: 'b', layout: 'full', blocks: [mesh], beats: [{ ...beat, id: 'b2' }] },
  ] });
  const links = E.frame(E.scenes[1].t0 + 0.5).filter(e => e.kind === 'link');
  assert.equal(links.length, 15);
  assert.ok(links.every(l => l.kind === 'link' && l.progress === 1));
});

test('focusing one table row does not fail the header contrast check', () => {
  const E = compile({ id: 'r', title: 'r', scenes: [{ id: 's', layout: 'main+strip', blocks: [EXAMPLES['table']], beats: [{ ...beat, focus: ['r1'], pulse: ['r1'] }] }] });
  const v = verify(E);
  assert.ok(v.ok, v.fails.join('\n'));
});
