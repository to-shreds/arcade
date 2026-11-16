# Monster Forge 2.0

Draw a monster from scratch or change one of six fully editable creatures.
This activity uses the existing Arcade theme, Home route, save adapter, and
local collection database. It contains no remote artwork or runtime libraries.

## Artwork and starters

50 individually illustrated parts: eight bodies, five heads, six eye types,
five mouths, five horn/antenna styles, eight limbs, four wings/fins, three tails,
and six extras. Feathers, claws, teeth, joints, shell plates and tentacle suckers
are separate vector details. Colors can change without recoloring teeth or
turning eyes into solid shapes.

The six starting creatures are Mossback Dragon, Moon Yeti, Deep-sea Lurker,
Cave Crawler, Scrap Golem and Slime Monarch. Every part can be moved or changed;
they are not flattened pictures. Monster DNA varies coherent recipes and colors.

## Controls

- Draw: freehand, brush sizes, colors, mirrored strokes and filled shapes.
- Parts: choose a category, then a clearly illustrated piece. Auto uses a
  suggested color or matches the existing body; a selected color overrides it.
- Move: drag on the canvas. The separate edit panel provides size buttons,
  rotation, flip, duplicate, mirror-copy, color, layer order and delete.
- Erase: remove a piece or a whole stroke. Undo and redo remain available.
- World: backgrounds, drawing challenges, Monster DNA and Evolve.
- Creatures: choose a starting creature. When replacing an existing drawing,
  it is saved in Collection first; failure to save stops replacement.
- Animate: blinking, wings, tentacles, roar, fire, slime, stomp and dance.
  Fire and slime originate at the monster's mouth. Reduced-motion settings
  suppress idle bobbing, flapping and screen shaking.
- Menu: blank canvas, starter choices, help and 1800 x 1200 PNG export.

## Saved-art compatibility

The previous database name and storage keys are unchanged. New parts have
`artVersion: 2`; saved parts without that field keep their original v1 SVG
artwork, IDs, colors, coordinates and transforms. The original renderer remains
in game.js specifically for this compatibility. Do not remove it casually.

The active draft uses ArcadeSave. Collections use local IndexedDB, with a
localStorage fallback when available. A fallback collection is never silently
trimmed to fifty monsters. These are device/browser-local saves, not cloud sync.
PNG export is a picture, not an editable backup. A standalone HTML copy and the
Arcade-hosted copy have separate browser storage locations.

## Verification

Run `node tools/test-monster-forge-browser.mjs` in the repository after installing
its locked Playwright dependency and Chromium. It covers all 50 parts, all six
starters, four screen sizes, touch and mouse drawing, live-stroke rendering,
transforms, geometry picking, undo/redo, legacy art, real IndexedDB and Arcade
save/reload, collection preservation, PNG export, effects and the Home route.
The existing shell-navigation and offline-runtime checks remain applicable.
