# Tank Tactics

An original artillery game for Arcade. Two tanks fire ten single-use weapons each, taking turns on destructible terrain without wind. Damage adds points. Self-damage awards points to the other tank. The higher score wins after all twenty shots.

## Play

Choose computer play, two players on one device, or a multiplayer room. Select colors and flat, hilly, or random terrain. Internet and Nearby rooms use the current Arcade transport, the same room codes, invitations and turn notifications as Arcade's other competitive games.

Select a weapon, set an angle from 0 to 180 degrees and power from 1 to 100, then fire. Zero degrees aims right, 90 up, and 180 left. Each tank also has four optional moves per game, each up to five tank lengths. Moving does not pass the turn.

Every tank receives ten distinct randomized weapons. The arsenal contains 84 mechanically different weapons across shells, clusters, bursts, bouncers, rollers, drills, tunnels, beams, fire, mines, terrain builders, terrain carvers, lightning and waves. Each has a local SVG icon, a description, and matching projectile or impact animation. No image files or external artwork services are needed.

## Persistence and authority

Local progress is stored through `ArcadeSave`, including resolved terrain, inventories, scores, mines, turn, remaining movement, computer difficulty and aim settings. Every resolved action is saved before its visual animation. Reloading cannot replay a shot or double its score.

Multiplayer stores only the room reconnection credentials under a transport-specific browser key. Room state is authoritative and never replaces the local autosave. Only the room host can choose lobby terrain or start the battle. Each player selects their own color. Both players must request a rematch, which alternates the starting player.

`engine.js` is the shared deterministic simulation. `weapons.js` is the stable weapon catalogue. `graphics.js` contains local SVG/canvas visuals. `game.js` owns UI, local autosave and the versioned room client. The read-only `window.TanksGame` hook returns cloned state and debug snapshots for automated verification.
