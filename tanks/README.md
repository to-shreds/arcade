# Tank Tactics

An original artillery game for Arcade. Two tanks fire ten single-use weapons each, taking turns on destructible terrain without wind. Damage adds points. Self-damage awards points to the other tank. The higher score wins after all twenty shots.

## Play

Choose computer play, two players on one device, or a multiplayer room. Select colors and flat, hilly, or random terrain. Internet and Nearby rooms use the current Arcade transport, the same room codes, invitations and turn notifications as Arcade's other competitive games.

Select a weapon, set an angle from 0 to 180 degrees and power from 1 to 100, then fire. Zero degrees aims right, 90 up, and 180 left. Each tank also has four optional moves per game, each up to five tank lengths. Moving does not pass the turn. If a move would exceed the battlefield boundary or reach the opposing tank, the tank travels as far as it safely can and stops. An attempted move when already at that boundary does not consume a move.

Every tank receives ten distinct randomized weapons. The default arsenal contains all 132 weapons (84 original and 48 new playful additions) across shells, clusters, bursts, bouncers, rollers, drills, tunnels, beams, fire, mines, terrain builders, terrain carvers, lightning and waves. Each weapon has its own offline icon and behavior profile. The 48 new additions cover food fights, school, toys, sports, backyard, home, gross-out fun and science; 26 originals also have playful names and effects without changing their physics. There are no external artwork dependencies.

## Arsenal selection and Test Range

Every new match, including local, computer, Internet and Nearby, draws from all **132 weapons**. There is no weapon-pool setting. Older saved matches keep the ammunition they already received, including matches originally made with a different pool. Each tank still receives ten different randomized weapons.

The Test Range is available at `tanks/range.html` and through the game setup and settings. It is an isolated, repeatable practice field without ammunition limits. It never replaces a saved battle or submits multiplayer actions. Reset terrain restores the original practice landscape.

## Four-times-slower damage floats and arc-only firing

Scoring numbers now drift toward the screen ceiling over 8.4 seconds,
four times the earlier 2.1-second duration. They stay visible when a
new turn begins and have a bounded 64-number overlay; reduced-motion
players still receive a brief stationary damage value.

Every fired weapon now launches a visible gravity-controlled arc. This
includes all twelve historical energy (beam-family) weapons, which are
still present with the same IDs and distinct damage, launch speeds and
terrain effects. Their old instant muzzle beams are gone. The energy
round bursts on impact, and the Cutting Ray carves its special slot
after the payload lands. A roller, drill, tunnel, surface wave or
lightning aftershock may continue along the ground after the initial
arc. The aiming dots now use the same gravity and speed as the real
shot, and the computer no longer uses direct-ray targeting.

## Full battlefield HUD and impact damage numbers

The battlefield fills the game screen, with translucent score and
control docks floating over the stage. The full horizontal terrain
profile, including both ends and the highest/deepest ground changes,
stays within the Canvas viewport. On narrow portrait screens the full
playfield is proportionally smaller rather than cutting off either
tank or stretching sprites. The ten-weapon selection is in the normal
weapon picker instead of a permanent loadout panel.

Each individual impact that scores points has an optional validated
`damageHits` event in the authoritative saved trace, with the struck
tank and exact point amount. Each hit emits its own rising `+N`
number above the struck tank. Numbers travel toward the visible sky
boundary for roughly two seconds, stagger when hits overlap and fade
out without pausing the battle. With reduced motion, they show briefly
without traveling. Delayed mines and self-hits work the same way.
Old saves with no per-hit entries remain valid.

## Knockback and precision controls

Large kinetic hits can now knock tanks horizontally and briefly throw them
into the air. They settle on the actual changed ground when the animation
finishes. Smaller hits usually leave them in place. The blast direction,
weapon type and actual damage determine the shove, limited to 75 world
units per impact. Tanks cannot pass each other or leave the battlefield.
These shifts are part of deterministic game state, not visual-only motion,
and do not consume the player's four deliberate moves. A mine detonating
during a deliberate move can also knock the moving tank away.

Angle, power and movement distance have one-step left/right buttons next to
the original sliders. Angle adjusts in one-degree steps (0–180), power in
one-percent steps (1–100), and move distance in single tank lengths (1–5).
The original slider, numeric entry and keyboard controls remain available.
Buttons disable at endpoints and whenever it is not the player's turn.

## Landscape and impacts

Use Landscape in the top bar (the screen icon on a narrow phone) to give the battlefield more room. It requests fullscreen and landscape orientation when the browser permits it. Otherwise the wide layout still works: turn the phone sideways. Exit wide returns to the usual layout. This is a device-only preference, not a room setting, and never changes a saved shot or another player's view.

Every weapon now has an explicit terrain profile rather than a scaled version
of the same crater. Giant High-Five (formerly Surface Slap) and Jelly Belly Wave (formerly Soft Swell) are broad but shallow; Pinpoint
is tiny; Crater Maker digs deeply. Fire scorches and electricity makes small
pits. Drills bore before their stated number of charges detonate. Tunnels cut
continuous collapsed channels, while carvers maintain their specified depth
regardless of path length or animation step count. Wall Drop builds a flat top;
Mountain-in-a-Box (formerly Mountain Maker) creates a triangular ridge. Cutting Ray bores through soil while
arcing energy payloads burst where their shells land. Bedrock limits all excavation.

The weapon picker includes same-scale terrain cross-sections and specific
terrain descriptions. These illustrate profiles, not guaranteed landing points.
The dashed line is the original surface. Actual craters depend on impact height,
slope, existing holes, and bedrock. Surface fire and electrical sparks no longer
reuse the explosive flash and flying-soil effect.

Shot records carry the exact changed ground samples and, for stronger hits,
the displacement and hop height for each affected tank. Older saves without
impact motion continue to load unchanged. Shot records carry the actual
chronological ground samples for each effect. Animation
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

`engine.js` is the shared deterministic simulation. `weapons.js` retains the stable 84 original IDs and includes the 48 additions from `fun-weapons.js`. `terrain-rules.js` is the shared excavation model. `weapon-art.js` supplies all 132 offline SVG drawings and `graphics.js` handles canvas visuals. `battle-view.js` owns the local-only display preference. `game.js` owns UI, local autosave and the versioned room client. The read-only `window.TanksGame` hook returns cloned state and debug snapshots for automated verification.
