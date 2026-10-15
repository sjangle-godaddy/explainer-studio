// Block catalog. A new block is one file implementing BlockDef, registered here and documented in AGENTS.md.
import type { BlockDef } from '../types.ts';
import { meshGraph } from './mesh-graph.ts';
import { networkMap } from './network-map.ts';
import { statCounter } from './stat-counter.ts';
import { summaryCards } from './summary-cards.ts';
import { table } from './table.ts';

export const BLOCKS: Record<string, BlockDef> = Object.fromEntries(
  [networkMap, meshGraph, statCounter, table, summaryCards].map(b => [b.type, b]),
);
