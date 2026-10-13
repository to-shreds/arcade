# Tank Tactics

An original artillery game for Arcade. Two tanks fire ten single-use weapons each, taking turns on destructible terrain without wind. Damage adds points. Self-damage awards points to the other tank. The higher score wins after all twenty shots.

## Play

Choose computer play, two players on one device, or a multiplayer room. Select colors and flat, hilly, or random terrain. Internet and Nearby rooms use the current Arcade transport, the same room codes, invitations and turn notifications as Arcade's other competitive games.

Select a weapon, set an angle from 0 to 180 degrees and power from 1 to 100, then fire. Zero degrees aims right, 90 up, and 180 left. Each tank also has four optional moves per game, each up to five tank lengths. Moving does not pass the turn.

Every tank receives ten distinct randomized weapons. The arsenal contains 84 mechanically different weapons across shells, clusters, bursts, bouncers, rollers, drills, tunnels, beams, fire, mines, terrain builders, terrain carvers, lightning and waves. Each has individually composed SVG artwork, a description, and matching projectile or impact animation. Icons remain distinct without their color or label. No image files or external artwork services are needed.

## Landscape and impacts

Use Landscape in the top bar (the screen icon on a narrow phone) to give the battlefield more room. It requests fullscreen and landscape orientation when the browser permits it. Otherwise the wide layout still works: turn the phone sideways. Exit wide returns to the usual layout. This is a device-only preference, not a room setting, and never changes a saved shot or another player's view.

Explosions now excavate a much wider and deeper footprint independently of their damage radius. Precision and surface weapons retain lighter digging; dedicated carvers, drills and tunnels reshape the battlefield substantially. Exposed soil, settling tanks, debris, pressure rings, recoil and a short power-sensitive aiming guide make the changes visible. The guide is only the beginning of the shot, not a guaranteed hit prediction.

## Persistence and authority

Local progress is stored through `ArcadeSave`, including resolved terrain, inventories, scores, mines, turn, remaining movement, computer difficulty and aim settings. Every resolved action is saved before its visual animation. Reloading cannot replay a shot or double its score.

Multiplayer stores only the room reconnection credentials under a transport-specific browser key. Room state is authoritative and never replaces the local autosave. Only the room host can choose lobby terrain or start the battle. Each player selects their own color. Both players must request a rematch, which alternates the starting player.

`engine.js` is the shared deterministic simulation. `weapons.js` is the stable weapon catalogue. `terrain-rules.js` is the shared excavation model. `weapon-art.js` supplies all 84 SVG drawings and `graphics.js` handles canvas visuals. `battle-view.js` owns the local-only display preference. `game.js` owns UI, local autosave and the versioned room client. The read-only `window.TanksGame` hook returns cloned state and debug snapshots for automated verification.
