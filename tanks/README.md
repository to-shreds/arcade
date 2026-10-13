# Tank Tactics

An original artillery game for Arcade. Two tanks fire ten single-use weapons each, taking turns on destructible terrain without wind. Damage adds points. Self-damage awards points to the other tank. The higher score wins after all twenty shots.

## Play

Choose computer play, two players on one device, or a multiplayer room. Select colors and flat, hilly, or random terrain. Internet and Nearby rooms use the current Arcade transport, the same room codes, invitations and turn notifications as Arcade's other competitive games.

Select a weapon, set an angle from 0 to 180 degrees and power from 1 to 100, then fire. Zero degrees aims right, 90 up, and 180 left. Each tank also has four optional moves per game, each up to five tank lengths. Moving does not pass the turn.

Every tank receives ten distinct randomized weapons. The arsenal contains 84 mechanically different weapons across shells, clusters, bursts, bouncers, rollers, drills, tunnels, beams, fire, mines, terrain builders, terrain carvers, lightning and waves. Each has individually composed SVG artwork, a description, and matching projectile or impact animation. Icons remain distinct without their color or label. No image files or external artwork services are needed.

## Landscape and impacts

Use Landscape in the top bar (the screen icon on a narrow phone) to give the battlefield more room. It requests fullscreen and landscape orientation when the browser permits it. Otherwise the wide layout still works: turn the phone sideways. Exit wide returns to the usual layout. This is a device-only preference, not a room setting, and never changes a saved shot or another player's view.

Every weapon now has an explicit terrain profile rather than a scaled version
of the same crater. Surface Slap and Soft Swell are broad but shallow; Pinpoint
is tiny; Crater Maker digs deeply. Fire scorches and electricity makes small
pits. Drills bore before their stated number of charges detonate. Tunnels cut
continuous collapsed channels, while carvers maintain their specified depth
regardless of path length or animation step count. Wall Drop builds a flat top;
Mountain Maker creates a triangular ridge. Cutting Ray bores through soil while
ordinary beams stop at the first obstruction. Bedrock limits all excavation.

The weapon picker includes same-scale terrain cross-sections and specific
terrain descriptions. These illustrate profiles, not guaranteed landing points.
The dashed line is the original surface. Actual craters depend on impact height,
slope, existing holes, and bedrock. Surface fire and electrical sparks no longer
reuse the explosive flash and flying-soil effect.

Shot records carry the actual changed ground samples for each effect. Animation
replays those changes in order; an early blast cannot reveal the final hole
from a later blast or mine. Bursts and cluster fragments advance on the same
simulation clock and collide with the terrain that exists at that instant.
Tanks settle on the ground shown during animation. Mines make no crater when
planted and retain their own terrain profile for later detonation. Old saves
remain readable, including mines without the new optional weapon identifier.

Terrain remains a height map. Underground weapons collapse into open channels,
not enclosed caves or overhangs. This is deliberate and described in the UI.

## Persistence and authority

Local progress is stored through `ArcadeSave`, including resolved terrain, inventories, scores, mines, turn, remaining movement, computer difficulty and aim settings. Every resolved action is saved before its visual animation. Reloading cannot replay a shot or double its score.

Multiplayer stores only the room reconnection credentials under a transport-specific browser key. Room state is authoritative and never replaces the local autosave. Only the room host can choose lobby terrain or start the battle. Each player selects their own color. Both players must request a rematch, which alternates the starting player.

`engine.js` is the shared deterministic simulation. `weapons.js` is the stable weapon catalogue. `terrain-rules.js` is the shared excavation model. `weapon-art.js` supplies all 84 SVG drawings and `graphics.js` handles canvas visuals. `battle-view.js` owns the local-only display preference. `game.js` owns UI, local autosave and the versioned room client. The read-only `window.TanksGame` hook returns cloned state and debug snapshots for automated verification.
