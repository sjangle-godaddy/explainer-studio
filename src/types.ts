// Shared types: episode spec (what the agent writes), display list (what blocks emit) and the block contract.

export type Box = [number, number, number, number]; // x0, y0, x1, y1
export type Pt = [number, number];

// ---------- episode spec ----------

export interface Episode {
  id: string;
  title: string;
  theme?: string;
  scenes: SceneSpec[];
}

export interface SceneSpec {
  id: string;
  layout: string;                 // a name from runtime/layouts.ts
  blocks: BlockSpec[];
  beats: BeatSpec[];
}

export interface BlockSpec {
  id: string;
  type: string;                   // a name from blocks/index.ts
  slot?: string;                  // a slot of the scene layout (default "main")
  [prop: string]: unknown;
}

export interface BeatSpec {
  id: string;
  name?: string;
  caption: string;
  line: string;                   // spoken text; sets the duration from its word count
  dur?: number;
  focus?: string[] | 'all';
  show?: string[];
  pulse?: string[];
  ring?: string[];
  strike?: string[];
  flows?: FlowSpec[];
  set?: Record<string, { value?: number; label?: string }>;
}

export interface FlowSpec {
  route: string[];                // element ids the packets pass through, in order
  reverse?: boolean;
  mode?: 'stream' | 'once' | 'line';
  color?: string;                 // a theme role
  delay?: number;
  untilBeat?: string;
  blockAt?: string;               // an id on the route: packets stop just before it at a red X
  transform?: Transform | Transform[]; // packets change look after passing "at" (encrypt, decrypt, translate)
  glyph?: Glyph;
  period?: number;
  speed?: number;
  dur?: number;
  line?: boolean;
  dashed?: boolean;
}

export type Glyph = 'plain' | 'locked';
export interface Transform { at: string; glyph?: Glyph; color?: string; }

// ---------- display list ----------
// Every element has a stable id (used to carry it across scenes) and an owner:
// the addressable id that beats refer to (focus, show, pulse...).

interface Base { id: string; owner?: string; alpha: number; z: number; }

export interface ZoneEl extends Base { kind: 'zone'; box: Box; fill: string; edge: string; dashed: boolean; progress: number; lip: number; }
export interface NodeEl extends Base { kind: 'node'; type: string; x: number; y: number; scale: number; color: string; glow: number; }
export interface LinkEl extends Base { kind: 'link'; pts: Pt[]; color: string; width: number; dashed: boolean; style: 'line' | 'tunnel'; progress: number; ends?: string[]; mayCross?: boolean; }
export interface LabelEl extends Base { kind: 'label'; box: Box; lines: string[]; sub?: string; size: number; subSize: number; color: string; fill: 'dark' | 'solid'; pulse: number; scale: number; }
export interface TextEl extends Base { kind: 'text'; box: Box; text: string; size: number; color: string; align: 'left' | 'center' | 'right'; }
export interface PanelEl extends Base { kind: 'panel'; box: Box; fill: string; stroke: string; strokeWidth: number; radius: number; }
export interface PacketEl extends Base { kind: 'packet'; x: number; y: number; r: number; color: string; glyph: Glyph; }
export interface MarkEl extends Base { kind: 'mark'; x: number; y: number; r: number; }
export interface RingEl extends Base { kind: 'ring'; x: number; y: number; r: number; color: string; width: number; }
export interface StrikeEl extends Base { kind: 'strike'; box: Box; progress: number; }

export type El = ZoneEl | NodeEl | LinkEl | LabelEl | TextEl | PanelEl | PacketEl | MarkEl | RingEl | StrikeEl;

// ---------- block contract ----------

export interface Theme {
  name: string;
  W: number; H: number; fullH: number; fps: number;
  safe: Box;
  captionBox: Box;               // the caption slot at the top of the safe zone
  content: Box;                  // where layouts place their slots
  font: { family: string; stack: string; cap: number; adv: Record<string, number> };
  type: { label: number; sub: number; caption: number; text: number; stat: number; minPx: number };
  roles: Record<string, string>; // role name -> colour
  zoneFill: Record<string, string>;
  ink: string; paper: string; page: [string, string];
  wordsPerSecond: number;
  packetSpeed: number;
  transition: number;            // seconds an element takes to glide between scenes
  limits: { maxLabels: number; maxSpeed: number; minCaption: number };
  nodeSizes: Record<string, { hw: number; h: number }>;
  dim: { map: number; label: number; zone: number };
}

/** What a block reads at frame time: when its ids appear, how focused they are, pulses, values. */
export interface Cues {
  /** Scene-local time an id appears; -Infinity if it was carried over from the previous scene. */
  appear(id: string): number;
  pulse(id: string, t: number): number;          // 0..1
  value(id: string, t: number): { value?: number; label?: string; from?: number; k: number };
  carried(id: string): boolean;
  /** True if any beat of the scene names this id. */
  mentioned(id: string): boolean;
}

export interface BuildCtx {
  theme: Theme;
  slot: Box;
  problems: string[];            // push "message -> fix" strings instead of throwing
}

export interface BlockInstance {
  /** Ids beats may address (nodes, zones, links, rows, cards...). */
  ids: string[];
  /** Natural duration after its last appearance, so beats are not cut short. */
  frame(t: number, cues: Cues): El[];
  /** Polyline through the given ids, for flows. Return null if this block does not own them. */
  route?(ids: string[]): { pts: Pt[]; stops: number[] } | string | null;
  /** Centre and radius of an id, for rings and blocked marks. */
  anchor?(id: string): { x: number; y: number; r: number } | null;
}

export interface BlockDef {
  type: string;
  describe: string;              // one sentence, for the storyboarder
  build(spec: BlockSpec, ctx: BuildCtx): BlockInstance;
}
