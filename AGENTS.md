# explainer-studio

Turns a spoken script into a themed, deterministic explainer animation for the upper two thirds of a YouTube Short.
The animation panel is 1080 x 1280; the lower 640 px of the 1080 x 1920 frame is the creator's face cam.
There is no voiceover: the creator speaks on camera, and beat timing comes from the spoken words.

An episode is one JSON file in `episodes/`.
It is a list of scenes; each scene picks a layout, fills its slots with blocks from the catalog, and lists beats that cue those blocks.
Blocks emit a display list (plain data) for any time `t`, and one canvas renderer draws it, so the browser player, the MP4 render and the checks always agree.

The design and roadmap live in `~/Projects/_TASKS/animation-builder/PLAN.md`.

## Working in this repo

- Do not create git worktrees for this repo.
  Work directly in the main checkout at `~/Projects/explainer-studio`.
  This overrides the global "always work in a worktree" rule, because the `/explainer-studio` skill is linked to this checkout.
- No gitignored files are needed to build or run (the font is committed).
- Do not open output in a browser or take screenshots to check it.
  The user reviews visuals; the build checks are the verification.
- Do not edit files in `dist/`; they are generated.

## Layout of the repo

| Path | What it is |
|---|---|
| `src/types.ts` | Episode spec, display-list elements and the block contract. |
| `src/theme/blueprint.ts` | Theme tokens: frame, safe zone, font metrics, type sizes, colour roles, node sizes, limits. |
| `src/runtime/compile.ts` | Timing, cues, flows (packets), focus dimming, captions and scene-to-scene glides. |
| `src/runtime/layouts.ts` | Scene templates and their slots. |
| `src/blocks/*.ts` | The block catalog, registered in `src/blocks/index.ts`. |
| `src/render/draw.ts` | Canvas 2D renderer for display lists (browser and Node). |
| `src/checks/index.ts` | Layout, readability, pacing and determinism checks. |
| `src/player/` | Player page and controls, bundled into each `dist/<id>.html`. |
| `cli/build.ts` | Validate, check and write `dist/<id>.html`. |
| `cli/render.ts` | Render MP4 in Node (Skia canvas + FFmpeg). |
| `test/` | Block harness and episode tests. |
| `golden/` | Source scripts that episodes must keep building from. |
| `skills/explainer-studio/SKILL.md` | The agent skill (canonical copy). |

## Commands

Node 24+ (TypeScript runs directly), npm, and FFmpeg for MP4.

```sh
npm install
node cli/build.ts episodes/<id>.json --report   # check and write dist/<id>.html, print scenes and beat timing
node cli/build.ts --all                          # every episode
node cli/render.ts episodes/<id>.json            # dist/<id>-1080x1280-30fps.mp4 (animation panel)
node cli/render.ts episodes/<id>.json --full     # dist/<id>-1080x1920-30fps.mp4 (face-cam area left dark)
npm test                                         # block harness + every episode
npm run typecheck
```

The build exits non-zero and writes nothing if the episode is invalid or any check fails.
`--force` writes the HTML anyway, for debugging only.

## Making an episode from a script

1. Read the whole script and split it into beats: one sentence, or a short pair, per beat.
2. Group beats into scenes.
   A new scene starts when the picture must change (a different diagram, a summary).
   Reuse ids across neighbouring scenes for things that stay (a VPC, a gateway): they glide instead of popping.
3. For each scene pick a layout and blocks from the catalog below.
   If nothing in the catalog can show a beat, write a new block (see "Adding a block") instead of bending an existing one.
4. Write `episodes/<id>.json`; `episodes/vpn-peering-tgw.json` uses every block and most cues.
5. Run `node cli/build.ts episodes/<id>.json --report` and apply the fix each failure names, then rebuild.
6. Run `node cli/render.ts episodes/<id>.json` for the MP4.

### Planning rules

- Put the spoken text in `line`, word for word; it sets the beat length (2.6 words per second).
  Set `dur` only when the beat needs a pause.
- Captions are at most 4 words, plain ASCII, uppercase, and must fit the caption slot.
- Keep labels to 1 to 3 words; put detail (IPs, CIDRs, full names) in `sub`.
- Things appear on the first beat that names them (`focus`, `show`, `pulse`, `ring`, `strike`, a flow `route`, `set`); things never named appear when the scene starts.
- Use `focus` to light the subject of a beat; everything else dims.
- Every beat must change something on screen within its first second (a flow, a pulse, a ring, a show or a focus change).

## Episode schema

```jsonc
{
  "id": "vpn-peering-tgw",            // output name: lowercase, digits, dashes
  "title": "VPN vs VPC Peering vs Transit Gateway",
  "theme": "blueprint",               // optional
  "scenes": [{
    "id": "peering",
    "layout": "full",                 // see Layouts
    "blocks": [{ "id": "peerMap", "type": "network-map", "slot": "main", ... }],
    "beats": [{
      "id": "aToC", "name": "A cannot reach C",            // name is optional, shown in the player
      "caption": "A TO C BLOCKED",
      "line": "If VPC A connects to B, and B connects to C, that doesn't mean A can communicate with C.",
      "dur": 6,                                             // optional
      "focus": ["vpcA", "vpcB", "vpcC"],                    // or "all" (default)
      "show": ["vpcC"],                                     // introduce without focusing
      "pulse": ["vpcB"],                                    // glow for the whole beat
      "ring": ["vpcC"],                                     // ring burst at the start
      "strike": ["internet"],                               // red X drawn over an id for the rest of the scene
      "set": { "count": { "value": 20, "label": "ATTACHMENTS" } }, // change a stat-counter
      "flows": [ ... ]
    }]
  }]
}
```

### Flows (packets)

```jsonc
{ "route": ["dcServer", "cgw", "vgw", "app"],  // ids in order; any block that owns them draws the path
  "mode": "stream",              // "stream" (repeating), "once" (one packet, holds at the end), "line" (path only)
  "color": "public",             // a theme role
  "glyph": "plain",              // "plain" diamond or "locked" padlock
  "transform": [{ "at": "cgw", "glyph": "locked", "color": "response" }, { "at": "vgw", "glyph": "plain" }],
  "reverse": false, "delay": 0.3, "untilBeat": "laterBeatId",
  "blockAt": "vpcC",             // packets stop just before this id at a red X; the line turns dashed
  "period": 0.75, "speed": 320, "dur": 3,
  "line": true }                 // draw the route line under the packets (set false when a link is already drawn)
```

## Layouts

| Layout | Slots |
|---|---|
| `full` | `main` (the whole content area) |
| `focus+aside` | `main` (upper 60%), `aside` (lower 40%) |
| `main+strip` | `main` (upper 70%), `strip` (fits a 4-row table) |
| `hero+stat` | `main` (upper 78%), `stat` (a short strip for a stat-counter) |
| `split-2` | `left`, `right` |
| `stack-3` | `top`, `middle`, `bottom` |

## Block catalog

| Type | Shows | Main props | Addressable ids |
|---|---|---|---|
| `network-map` | Zones with isometric nodes, links and encrypted tunnels | `zones` (`id`, `label`, `role`, `size`, `direction`, `children`), `nodes` (`id`, `type`, `zone`, `x`, `y`, `label`, `sub`, `side`, `edge`, `role`), `links` (`id`, `from`, `to`, `style`: `line`/`tunnel`, `bend`: `direct`/`hv`/`vh`, `dashed`, `color`) | zones, nodes, links (default link id `from-to`) |
| `mesh-graph` | N nodes on a circle, fully meshed or attached to a hub | `mode` (`mesh`/`hub`), `count`, `prefix`, `nodeType`, `role`, `named` (`id`, `label`, `at`), `hub` (`id`, `label`, `type`, `side`), `extras` (nodes in a gap at the bottom, joined by a tunnel), `gap`, `margin`, `nodeScale` | block id, nodes, hub, extra spokes (`hub-extra`) |
| `stat-counter` | A big number that counts between values, with a label | `value`, `label`, `role` | block id |
| `table` | A titled table; rows light up when pulsed | `title`, `columns`, `rows` (`id`, `cells`), `role` | block id, row ids |
| `summary-cards` | 2 to 4 takeaway cards revealed one by one | `cards` (`id`, `title`, `text`, `role`, `icon`: `type` and optional `id` of a node from the previous scene, which glides into the card) | block id, card ids |

Node types: `server`, `gateway`, `vpngw`, `router`, `vpc`, `datacenter`, `database`, `cloud`, `users`, `firewall`.
Zone roles: `external`, `boundary` (dashed), `public`, `private`, `neutral`, `aws`, `onprem`; a child zone must use a different role from its parent.
Colour roles for nodes, links and flows: `gateway`, `public`, `private`, `response`, `blocked`, `external`, `boundary`, `neutral`, `aws`, `onprem`.
Label `side`: `below` (default), `above`, `left`, `right`; mesh-graph ring labels default to `radial` (outside the ring).

## What the build checks

At every beat start, middle and end, and every 0.1 s:

- every text box is inside the safe zone and at least 26 px,
- no two text boxes overlap, no label covers a node or a packet, no settled line passes through a node it does not connect (mesh links may cross),
- these overlap rules are skipped while elements glide between scenes, and apply again once they settle,
- text has contrast of at least 3 against what is under it,
- at most 16 labels on screen,
- nothing moves faster than 2600 px/s (a glide that jumps across the frame),
- every label stays readable for at least 1.2 s, and every beat lasts at least 1.5 s,
- caption words that name a visible label have that label in focus,
- every beat changes something within its first second,
- frames are identical when visited out of order (blocks keep no state),
- the renderer draws every other frame without errors (canvas stand-in).

## Fixing build failures

| Message | Fix |
|---|---|
| `... leaves the safe zone` | Shorten the label, move the node (`x`/`y`), or change `side`. |
| `... overlaps ...` / `label ... covers node ...` | Change the label `side`, move the node, or for a mesh ring use `at` to spread named nodes. |
| `a packet passes under label ...` | Move that label to a side the route does not use. |
| `the link between ... would pass through ...` | Move one node, change `bend`, or add the node to the route. |
| `zone ... is only N px tall/wide` | Raise its `size` or use fewer zones. |
| `too short for packets to cross` | Lower `delay`, set `dur`, or keep the flow running with `untilBeat`. |
| `moves at N px/s` | Keep the shared id closer to its previous position, or drop the shared id so it fades instead. |
| `nothing moves in its first second` | Add a flow, pulse, ring, `show` or a focus change to that beat. |
| `the caption names ... but none of them is in focus` | Add that id to `focus`. |
| `... names "x", which is not in scene` | Use an id from that scene's blocks (the message lists them). |

## Adding a block

1. Write `src/blocks/<name>.ts` exporting a `BlockDef`: `build(spec, { theme, slot, problems })` returns `{ ids, frame(t, cues), route?, anchor? }`.
2. `frame` must be a pure function of `t` and `cues`: no `Math.random`, `Date`, timers or state kept between calls (use `rng(seed)` from `src/util.ts` for randomness).
3. Ask the theme for colours, sizes and fonts; never hard-code them.
4. Validate props with `Props` from `src/blocks/common.ts`, pushing problems that end in `-> how to fix`.
5. Give every element a stable `id` and the `owner` id beats use, so focus, carrying across scenes and checks work.
6. Register it in `src/blocks/index.ts`, add an example to `test/blocks.test.ts`, and document it in the catalog above.
7. Run `npm test` and `node cli/build.ts --all`.
