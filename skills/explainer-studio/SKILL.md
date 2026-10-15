---
name: explainer-studio
description: >
  Turns a spoken script into a themed blueprint explainer animation (scenes, blocks, glides between scenes)
  for the upper 2/3 of a YouTube Short, using ~/Projects/explainer-studio, and renders it to MP4.
  Use when the user says "/explainer-studio", "animate this script with explainer-studio", or pastes a script
  that needs more than a single network map (several diagrams, charts, tables, counters, summary cards).
metadata:
  author: user
  version: "0.1.0"
---

# explainer-studio

The schema, block catalog, layouts, checks and fixes live in the repo.
Read `~/Projects/explainer-studio/AGENTS.md` first; it is the reference for everything below.

## Steps

1. **Plan the story once.**
   Split the script into beats (one sentence or a short pair each), group beats into scenes where the picture changes,
   and pick a layout plus blocks per scene.
   Reuse ids across neighbouring scenes for things that persist, so they glide.
2. **Write `episodes/<id>.json`.**
   Copy patterns from `episodes/vpn-peering-tgw.json`.
   Put the spoken text in `line` word for word; do not rewrite the user's script.
3. **Build:** `node cli/build.ts episodes/<id>.json --report`.
4. **Fix and rebuild** until it passes, applying the fix each failure names.
   If the catalog cannot show a beat, add a block following "Adding a block" in `AGENTS.md`, then run `npm test`.
   If it still fails after 5 rounds, stop and tell the user which constraint is blocking.
5. **Render:** `node cli/render.ts episodes/<id>.json` (add `--full` for the 1080 x 1920 frame).
6. **Report:** the HTML and MP4 paths, the scene and beat list with timings, any new block, and any line you merged.

## Rules

- Do not open the HTML or MP4 in a browser or player, and take no screenshots; the user reviews visuals.
- Do not edit files in `dist/`.
- Commit or open a PR only when the user asks.
