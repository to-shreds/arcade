# Arcade 2.7.1 verification

The change is confined to the shared multiplayer globe in
`multiplayer/shared-activity.js`. Tank Tactics and all activity gameplay remain
unchanged from release 2.7.0, whose complete CI and production match passed.

`tools/test-multiplayer-globe.mjs` passed actual Chromium mouse and touchscreen
dragging, ordinary tap activation, no activation after dragging, persistence
despite the periodic placement timer and activity DOM changes, exact reload
restoration, portrait/landscape resize, edge clamping, keyboard movement and
Enter activation, pointer cancellation, separate activity positions, and
unavailable storage. The actual touchscreen path uses CDP touch input. There
were no browser page errors.

All 109 existing transport/shell tests passed. Source syntax and diff checks
passed. New UI positions are private browser preferences, excluded from shared
view capture. The existing game-save storage guard is unchanged; its original
writer persists only the globe's device preference during shared play.

Run `npm run test:globe` after installing browser test dependencies. Published
release and CI details belong in the canonical Arcade ProjectStatus entry.
