# Arcade 2.10.0 verification

Runtime source: `f55e55ce031b2da65d8a91ed1d3682b71cc6394a`.
Final shared-test repair: `8d96a80793ad6b45150dd5b5b0ac0a1d1c748eef`.
The repair changes only a browser test and its read-only workflow. Final release
notes do not change runtime. ProjectStatus records the final publication and
package metadata. Snapshot `2.10.0+20261107.1` contains 415 runtime files,
22,969,994 bytes and 49 enabled activities.

## New games

Train Trouble has 28 dispatcher jobs and seeded generated jobs, with switches,
signals, brake deceleration, different speeds, cargo, coupling, repair stops,
route preview/assistance, pause, slow time and paint unlocks. Every accepted
job has a schedule executed to victory in the same simulator. Timetable targets
are attainable. Trolley Trouble is a separate mode with 36 scenarios, facts
shown before choices, saved risk outcomes and direct consequences. There are
no moral scores, explanation questionnaires or crash movies for trolley deaths.

Three original crash cartoons show extravagant train destruction and visibly
safe occupants. Each is 4.5 seconds, 960 by 540 at 30 fps, supplied as H.264/AAC
MP4 and VP9/Opus WebM. Skip and Replay remain available. Both formats, posters
and sound are bundled offline. The generator and media provenance are in source.

Robot Workshop has 30 missions, three generated difficulties and free building.
It teaches direct wires, NOT, AND, OR, XOR, branching and multiple machines.
Every input combination is checked; equivalent solutions pass. Tap, drag,
keyboard controls, movable gates, persistent undo and progressive hints work.
Generated orders are checked, nonconstant and depend on every switch. Generated
replay can repeat structures, especially at the first difficulty.

## Runner verification

[Preflight 42432891781](https://github.com/to-shreds/arcade/actions/runs/42432891781)
ran the exact runtime source. Engines, menus and catalog/offline groups passed:

- 229 Worker/authority/client tests and 112 transport tests.
- 25 new-game/movie-response model tests: all 30 logic missions, 1,200 generated
  logic orders, 28 witnessed campaign train wins, 1,000 generated train jobs and
  3,504 trolley decision/restore branches.
- Native keyboard and persistent-shell Home source audits for all 49 activities;
  retained Android wrapper source validation and every offline runtime hash.
- 147 multiplayer menu checks, 164 actual Home cases, 16 native wheel/touch menu
  cases and two Minesweeper startup/resize regressions.
- 11 catalog scenarios, all 49 repeat/rotation/save cases and all 49 denied-storage
  cases, four shell viewports, complete PWA/offline use and offline story play.
- Real Chromium WebRTC pairing, locked identities, offline chat, room creation,
  synchronized control passing and both actual new-game adapter round-trips.

The new-game group passed six focused Robot and seven focused Train browser
groups, then 20 of 21 consolidated cases in branded Chrome. Those 20 include
six native layouts per game, alternate logic solutions, actual MP4 and WebM
playback of all three clips over both ranged HTTP and archive-style responses,
seek/end/Replay/Skip, complete cached PWA playback and Robot Worker sharing.
There were no codec blocks or uncaught page errors. One Train room readiness
wait stalled because spectator mode intentionally freezes browser timers.

The test now polls from Node with the same predicate and 15-second bound.
[Focused repair 42433406509](https://github.com/to-shreds/arcade/actions/runs/42433406509)
passed both actual Worker flows in Chrome: observer mutation blocking, local
menus, exact control transfer, dynamic trolley choices and private-game restore.
Its source gate proves all runtime is unchanged from the preflight. The initial
whole run is not represented as green. Both required shared flows now pass.

## Additional independent checks

Independent playability review passed eight game/layout combinations, deeper
keyboard/branching/multi-output logic controls, alternate DeMorgan solutions,
750 generated logic puzzles and simulator completion/par checks for all 28
train jobs. Separate consolidated model checks covered 480 generated logic
orders, 120 train jobs, 300 moving snapshots and 1,752 trolley decisions.
All 36 untouched shared lobbies and both new-game online reconnect/control-pass
flows also passed. Local media decoding used WebM because the local Chromium
shell lacks H.264; the positive MP4 evidence is from branded Chrome on the runner.

A supplementary 2.9.0 main run had a six-second Tank Tactics resume-readiness
timeout despite a screenshot of the restored game. The unchanged targeted test
and eight fresh local contexts restored exact saved terrain, ammo, turn, score
and aims. This release's all-activity runner also passes Tank Tactics. The old
failure's precise timing cause remains unproved; no save corruption was found.

## Limits and use

Browser checks use desktop and emulated touch viewports. Physical Android/iOS,
OS-specific behavior and personal TorBox-account playback were not tested.
Local RTC cannot gather usable ICE; positive Nearby evidence comes from the
runner. Existing TV/account, speech and notification limits remain in prior
release documentation. Existing APKs are retained; the web update needs no
wrapper rebuild. Refresh Arcade and update its offline copy to install both games.
