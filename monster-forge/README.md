# Monster Forge 1.0

A creative monster-drawing activity for Family Arcade. Works with touch,
stylus, or mouse, and has no external images, fonts, libraries or network calls.

## Play

- **Draw:** Freehand brush, colors, sizes, mirrored strokes, and filled shapes.
- **Parts:** Add 33 hand-drawn body/face/limb/effect shapes. Move, resize,
  rotate, mirror-copy, recolor, layer, and erase them.
- **World:** Seven illustrated environments, 36 rotating drawing challenges,
  and procedural Monster DNA starter creatures.
- **Collection:** Name monsters, choose habitat/food/powers/danger ratings,
  save/reopen/delete them, and export PNG images.
- **Evolve:** Preserve the original in the collection, then mutate a new copy.
- **Test chamber:** Animated blinking/wings/tentacles with stomp, roar,
  flame, slime and dance effects and optional short sound effects.

## Install

For an offline Arcade content folder, copy the `monster-forge` directory
(alongside other game directories) and rescan your library in Manage Games.
The provided `game.json` is the activity metadata. Current Arcade web builds
which include the matching catalog entry will open this activity directly.

Saves: in the Arcade, the in-progress drawing uses Arcade's standard
IndexedDB autosave adapter. The saved monster collection uses its own
IndexedDB database on the current device. Both are local to the browser/app.
No account, cloud service, or multiplayer connection is required.
If browser database storage is unavailable, the collection attempts a
localStorage fallback, which has more limited capacity.

No source assets from other games are changed by these files.
