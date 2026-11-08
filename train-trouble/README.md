# Train Trouble

One Arcade activity with two separate modes. Dispatcher jobs use a deterministic
railway model and safe cartoon crashes. Trolley Trouble uses disclosed changing
facts, direct choices and immediate consequences, including serious off-screen
fatal stakes. Trolley choices never earn moral points or trigger crash clips.

## Dispatcher

28 campaign jobs introduce routes, simultaneous engines, coupling, workshop
stops and multi-stop cargo. Eight connected track layouts retain an outside
loop with different central links. Fresh tracks uses a stored 32-bit seed and
job number to create more jobs. Each accepted job has a constructive route
schedule executed to victory in the same simulator used by the player.
Timetables are slower than that witnessed safe schedule. Running engines
together offers an efficiency challenge, but missing the timetable never
blocks completion. Three optional stars reward completion, planning without
a route hint and meeting that timetable. Campaign stars unlock engine paint.

All engines begin held. Select an engine, select a numbered junction and point
its arrow toward the next track. Send starts the clock. Arrival at a station,
red signal or backward-facing points stops the engine. A requested brake
decelerates to its next junction; heavy/rescue engines brake less sharply.
Deliberately sending a held engine permits a reverse. A coupled wagon reduces
speed. A workshop takes three simulated seconds, then waits for Send.
Pause, half speed, route preview and an optional route hint remain available.

## Persistence and rooms

`engine.mjs` contains no DOM, timers, storage or randomness outside seeded
construction. `app.mjs` registers both ArcadeSave and the custom shared adapter.
Checkpoints include the full rail model, campaign paint/stars, seed, choices,
selection, pause/menu/help state and crash-video position. Restore validates
the complete candidate before changing the live game. Rejected saves return
false. The shared adapter restores every observer checkpoint and explicitly
gates controller mutations. Only the controller advances railway time.

The bundled H.264 MP4 crash clips work offline, have Skip/Replay controls and
show the occupants safe. A typed Blob fallback supports older archive hosts
that send the wrong MIME type. Video pauses while hidden or in the menu, and
logical clip position resumes on restore or control transfer. Sources and
generation instructions are in the media documentation.

## Checks

`node --test train-trouble/engine.test.mjs train-trouble/trolley.test.mjs`
validates 28 campaign schedules, 1000 varied endless jobs, deterministic
mid-edge/workshop restore, braking, red signals, collisions, terminal guards,
reverse recovery and damaged saves, plus trolley branches and risk resolution.

`node tools/test-train-trouble-browser.mjs` exercises native routes, deliveries,
pause/menu/rotation, save/reload, denied storage, choices, real clip decode and
the shared adapter controller gate. The broader two-game browser suite covers
real multiplayer handoff and restoration separately.
