# Arcade continuation handoff

## Current work: 2.10.0 Train Trouble and Robot Workshop

IN PROGRESS release verification. Canonical published main remains
2.9.0 dc96bfb0a35499f18dfe115edea03cd599fee0cb. The complete new-game build
is checkpointed at a71a7cec4e8c314aa5496d44bd51212e4497a4e8 on
work/arcade-2.10.0-build. Subsequent narrow QA fixes are staged for preflight.
Controlling agreed scope: docs/arcade-2.10.0-design.md.

Implemented: Train Trouble's 28 witnessed dispatcher jobs, generated fresh tracks,
cargo/coupling/repair, brake/signal/route controls, paint unlocks; separate 36-case
Trolley Trouble with seeded disclosed outcomes; three original 4.5-second crash
movies in MP4 and WebM; Robot Workshop's 30 lessons, three endless tiers, free
building, all-input truth checking, alternate solutions, touch/keyboard and undo.
Both register native menus, transactional full-state saves and shared adapters.

Local checks passed: 25 new-game/static model tests, 1,200 logic seeds,
1,000 train seeds, 3,504 trolley decision branches, seven focused Train browser
groups, six Robot groups, eight independent playability viewports, 229 Worker
checks, 112 transport checks, 147 multiplayer menus, 36 untouched room lobbies
and both new-game online room/reconnect/control-pass cases. Offline manifest
currently covers 415 files, 22,969,994 bytes; its full hash audit passes.

Remaining release gates: final consolidated media/PWA/shared browser test, exact
source CI including positive RTC with both actual adapters, production Worker
allowlist deploy, public-file hashes and persistent ZIP/provenance. Local RTC
cannot gather usable ICE and is not counted as a pass. Local Chromium shell
cannot decode H.264, so actual local playback uses WebM; branded Chrome in CI
must independently decode the MP4 files. See docs/arcade-stress-test-2.10.0.md.

Do not break: trolley choices have disclosed facts before the decision, direct
consequences, no why/justification quizzes and no moral scores. Serious trolley
outcomes remain off-screen and separate from safe-occupant crash movies. Keep
all switch combinations in logic validation and accept equivalent circuits.
Preserve seeds, state, undo, private backups, controller gates and exact logical
video position through restore/handoff. New games use native canonical redraw,
not generic canvas image overlays. Cached movie ranges must preserve verified
full responses in the atomic snapshot. Preserve the 2.9.0 baseline below.

Next action: finish exact-source release verification, then publish/package and
record artifact metadata. Update this handoff before final ProjectStatus readiness.


## Current implementation: 2.9.0, verified

Canonical repository: to-shreds/arcade. Final runtime is the complete review
source `9fe4b6d6185e71687669e94d7ff06280876079ea` plus the Minesweeper startup
repair `409aa89df655b5e2580285861205eca9b7296b46`. Later release documentation
changes do not alter runtime. ProjectStatus controls exact publication, final
main/source commit, live-file checks and downloadable artifact metadata.
Snapshot `2.9.0+20261107.1`: 388 runtime files, 20,195,799 bytes.

Completed changes:
- Bug Squish gains Be the bugs / Picnic Heist for one or two bugs, with crumb
  carrying, hiding, dash, shields, warning swats, shared hearts and harder rounds.
- Chess Moves shows the actual selected board beside/before its controls/list.
  Illegal historical input preserves future moves; branching occurs only when
  a legal move is played, including completed promotion selection.
- Solitaire and Regex Lab now supply the no-argument save callbacks that the
  shared save layer invokes. Failed/incompatible loads retain saved bytes and
  block replacement until retry or an explicit fresh start.
- Nearby rejects damaged shared-room checkpoints before replacing a session.
  Thirteen legacy settings loaders and Chess tolerate unavailable storage.
- Make 10, Jigsaw, Memory and Minesweeper setup controls scroll with native input.
  Minesweeper also guards rendering before its board initializes on window load.
- Forty-eight wording changes across 21 pages replace slogans and technical copy.
  New game ideas were suggestions only and were not implemented.

Verification:
- Final repair CI 42427761898 passed at exact source 409aa89d:225 Worker/model/
  client tests,112 transport tests,18 native menu/startup cases,94 all-activity
  rotation/save/denied-storage cases and full PWA/offline play. Its source gate
  proved the only runtime change after the broad review was the Minesweeper guard.
- Broad preflight 42426873524 passed models, Tanks/Upwords, stories/TV, catalog/
  offline, Heist and shared/competitive groups. Menus/tools failed solely on the
  now-fixed Minesweeper startup race; all its other commands passed. Preserve
  that history rather than calling the original whole run green.
- Actual Nearby pairing/shared play passed job 128566930440; real offline Tanks
  and Upwords peers passed job 128566929672. Guess Who 42426873662 also passed.
- Coverage includes196 visual records,47 enabled entries,42 retained online
  entries plus separate Tanks/Upwords,139 menus,156 Home cases,50 clocks,
 36 kid question mappings, all Typing/Face/TV tools,225/112 final checks,
  six Heist models/seven browser cases and seven Chess layouts. Local PWA and
  desktop/mobile adapter flows passed. See the release report for precise counts.

Do not break:
- Heist lives in bug-squish/heist.js and uses the existing pause/save/shared loop.
  Gate classic input by mode; v2 mode-less saves remain classic. Preserve v3 mode,
  pause, cargo, shields, progression/timers/effects and private room-exit restore.
- Chess history must restore the same board parent/inert state on Done/Escape,
  cancel pending CPU/drag work, retain keyboard/zero-move focus and square boards,
  and preserve online live-only authority. Small-board pieces must fit cells.
- Preserve rejected saves until explicit user choice. Nearby checkpoint import
  remains transactional. Keep transport pinning, local backups, private drafts,
  controller validation, bounded frames/checkpoints and no public Nearby fallback.
- Keep the atomic hash-verified offline snapshot, retained APKs, TV credential
  isolation and earlier feature-specific constraints documented below/in READMEs.

Test qualifications:
- Historical Tanks native Load Saved timed out under concurrent local rendering;
  strict isolated and CI repeats passed 14 families,seven native reloads and six
  layouts without forced clicks or altered GPU settings. Its cause is unproved.
- Orb Slicer’s old ten-second test expired before its deliberate tick 200 spawn.
  The bounded progress-qualified wait retains actual slicing/scoring, observer
  pixels, reconnects and terminal-state preservation; fresh CI passes.
- Local actual RTC is unavailable in this sandbox. Real RTC passes above are from
  GitHub runners. Physical Android/iOS, device voice/notification/OS clipboard
  behavior and personal TorBox-account playback were not tested.

Next action: use ProjectStatus for final release/publication readiness. For a new
issue, reproduce the precise activity, mode, viewport, save and room state first.

## Current state: 2.8.7 TV update

TV defaults to a persisted 480p preference and exposes quality controls in
details and the player. Safe compatible sources take precedence over nominal
quality. Actual source or measured resolution is shown; no transcoding is
implied. Quality changes reuse the video/fullscreen surface and preserve position.

Startup reports lookup, cache, candidate, file, playback-link, loading and
buffering stages. Bounded account-specific metadata/source caches and a
cancellable 300ms selected-episode prefetch remove repeat checks. Prefetch never
prepares or adds torrents, and playback links stay fresh. Preserve cancellation
and token/revision/epoch guards. Successful explicit login clears rejected-copy
memory so one account's failures cannot affect another.

Backend 1.2.11 (main 0713abb6, deployment mirror 611cf0a5) repairs the screenshot's
false identity rejection when a detail hash is omitted, using independent
hash-and-ID proof. Actual conflicts remain blocked. Exact-hash stale-ID repair
is read-only and verifies the replacement independently. TV refreshes ready
sources after failed explicit preparation and only tries cached alternatives.
Permanent mismatch/unsupported exclusions stay separate from transient
per-attempt failures, so explicit Retry works after an outage.

The workspace disconnected before final packaging. Sources were recovered
deterministically from the recorded successful patches against 48e52e48.
This is not claimed as an independent byte comparison with the unavailable
filesystem. GitHub preflight 42422326599 passed on the recovered sources:
33 TV logic checks, 12 focused browser scenarios, eight existing TV integration
scenarios, 112 transport/shell tests, 47-activity native keyboard/Home audits,
offline validation and ZIP CRC/runtime hashes. The seek fixture supports actual
206 byte ranges and retains the strict position assertion.

Verified runtime release commit: 681e3db55187e2e98619cef59ec357e397a8d664.
Pages run 42422477990 succeeded. The runner independently verified the live
snapshot 2.8.7+20261107.1 and SHA-256/size of the four TV assets and service
worker. It also fetched the deployed backend /healthz and verified 1.2.11.
The snapshot has 387 runtime files and 20,164,370 bytes. The 413-entry ZIP is
available in GitHub release arcade-v2.8.7 with provenance, source commit and
checksum. ProjectStatus records exact artifact metadata and readiness.

The user's personal TorBox response/key and physical Android playback were
not available. These tests cover intercepted service responses and synthetic
media, not personal-account availability. A preferred 480p copy is not guaranteed
for every title; actual fallback quality is shown.

All prior 2.8.6 menu, clock, Young Kid Trivia, Typing and Face Lab fixes remain.
The supplementary 2.8.6 broad run 42418533256 failed an unchanged Tank Tactics
terrain test waiting to click Load Saved; its Nearby job succeeded. Do not call
that historical full run green or confuse it with the successful TV preflight.
A supplementary broad run for 2.8.7 is tracked in ProjectStatus separately.

## Current state: 2.8.6

The November 7 follow-up adds Typing font/size choices, Select All and Copy,
and replaces the Face Lab size slider with a size button. All 2.8.5 menu,
clock and picture/voice Trivia changes below remain in this release.

Typing retains its custom keyboard, text/cursor save schema (version 2), native
composition exclusions and grapheme-aware editing. The local toolbar offers
Simple, Rounded, Storybook and Typewriter faces, Auto or 24/32/40/56/72 pixel
sizes, Select All and Copy selected text (or all text when none is selected).
Native selection, Ctrl+A/C, Shift selection and selection replacement preserve
text and cursor expectations. Clipboard failure is reported honestly; the
fallback preserves original text, selection and focus. Appearance preferences
and selection are local UI, excluded from room checkpoints. In-room preferences
stay in memory and persist through the existing restore context on leave,
without weakening shared save guards. Observers can use the local toolbar;
native partial pointer selection remains subject to existing observer guards.

Face Lab's size button cycles 50%-250% in 25-point steps and wraps. Exact
older saved sizes and continuous pinch values remain unchanged until tapped.
Every tap has one undo entry. Stickers, pinch, shared controller permissions,
canvas observer rendering, handoff and local restoration remain intact.

A direct-page Home path was found to navigate twice: the multiplayer bridge
fallback navigated and returned false, then ArcadeSave navigated again. The
bridge-only probe used by ArcadeSave preserves existing default bridge behavior
and native/parent fallbacks while performing one actual navigation. Keep the
strict final URL and visible Arcade checks in the browser audit.

`npm run test:activity-tools` covers the two follow-up controls.
`npm run test:arcade-fixes` retains menu, clock and kid Trivia checks. The new
release uses snapshot 2.8.6+20261107.1 and an updated visible release date.
See docs/arcade-stress-test-2.8.6.md and ProjectStatus for final evidence,
publication and the exact current source/download identities.

## Prior release 2.8.5 benchmark

The November 7 request adds missing Arcade exits, fixes the clock face geometry,
and adds Young Kid Mode to Trivia. Dots had an old global `.back-btn` rule hiding
its header Menu. Its explicit visible header now opens Resume, New Game, Save,
Load and Back to Arcade; CPU work pauses locally while this menu is open, and
online room state continues normally. The menu is not part of saved game state.

`multiplayer/shared-activity.js` adds missing Back to Arcade controls to native
setup/pause menus, marks them as local UI and uses ArcadeSave.goHome. Existing
shared observer navigation, checkpoint exclusions, transport and authority
remain. Chess and Chat gained setup/lobby exits; Checkers and Tic Tac Toe exits
use the clear Back to Arcade label. Preserve direct Home controls elsewhere.

`time/index.html` sets the canvas bitmap from actual client dimensions after CSS
sizing, using device pixel ratio. The face cannot flex-shrink into an oval.
A zero-size guard and ResizeObserver handle hidden shell restores and reveal.
Do not return to a separate guessed bitmap size that disagrees with mobile CSS.

Trivia's `kids` mode uses 36 local picture questions, ArcadeSpeech for the
Android/browser voice, local replay and child-paced next controls. The existing
save/shared schema and answer identities remain; manual saves now retain the
full question display order, score, highlights and answered state. Kid questions
never auto-advance. Normal categories keep their existing automatic advance.
Speech cancels on menus, keyboard menu activation, mute and navigation. The
Listen control is local UI while Next remains controller-only. Device voice
availability is reported honestly; browser/native bridge fixtures are not a
physical-device audio test.

`npm run test:arcade-fixes` covers all menu exits, Dots, clock rendering and kid
Trivia. See docs/arcade-stress-test-2.8.5.md for the actual checks. The current
release is 2.8.5 and the offline snapshot is 2.8.5+20261107.1. ProjectStatus
records the exact published source, deployment result and download identity.

## Prior release 2.8.4 baseline

The canonical project is `to-shreds/arcade`, default branch `main`. Production
web content is served at <https://to-shreds.github.io/arcade/>. The repository
controls implementation and release substance; the applicable entry in
`to-shreds/ProjectStatus` controls readiness and next steps.

The 2.8.4 menu update was explicitly approved for committing, merging and
publication. PR #3 is merged as `2d4830f02fc7b1ce53ace7ca5e7c74f7837a15f4`.
No user-approval step remains for this request. The verified download is already
saved; do not rebuild it merely for publication. Its 387 runtime files remain
unchanged by continuation documentation. Final deployment, current CI and
artifact identities are recorded in ProjectStatus.

Release 2.8.4 removes the floating multiplayer globe from all 34 shared
activities. `multiplayer/shared-activity.js` explicitly maps native menus and
adds an Internet / Multiplayer entry. Where no accessible in-game menu existed,
the original Home control opens local navigation with Resume, multiplayer and
Arcade Home. Music Maker also has a menu on its portrait rotation screen.
Native competitive game controls and Adventure/TV are unchanged.

Menu UI and launcher state must stay out of shared checkpoints. Observers open
local navigation instead of mutating the controller's native menu; only the
current controller can pass controls or change gameplay. Window capture handles
menu activation before legacy Home routing. Keep keyboard isolation, focus
restoration/trapping, invitation auto-open, room/session keys and original save
guards intact. The obsolete globe positioning timer, mutation observer, drag
handlers and preference writes are removed. Existing position keys are ignored
and need no migration or deletion.

`npm run test:menus` verifies all 34 activities at four viewport sizes using
actual mouse/touch menus. Existing gameplay suites use the supported openPanel
API so opening a native pause menu does not itself change their game scenarios.
The production smoke suite uses actual menu navigation. The current verification
and publication results belong in docs/arcade-stress-test-2.8.4.md and ProjectStatus.

Release 2.8.3 fixes board movement during preview/error changes and aligns
hover/release with the floating letter. Keep the feedback frame allocated even
when empty; preview and global notices share that bounded space. Never let
their content resize or reposition the board at a fixed viewport. Touch uses
the visible tile center above the finger for both drawing and hit-testing;
mouse/pen use the pointer center. Spatial browser checks compare actual board
rectangles and target highlighting with the painted ghost.

The 2.8.2 supplementary whole-Arcade run 40993738390 passed Nearby but stopped
in the broad browser stage on an Orb Slicer projectile wait timeout. Its
Upwords-specific preflight passed. No Orb Slicer source was changed here.
Preflight 40998771225 passed all 12 browser scenarios on
dfa93ffec01ca729d7a2619101c341b0ab38d922, including actual touch projection
and fixed board rectangles. All 40 Upwords and 208 Worker/model/client checks
passed. Final publication belongs in ProjectStatus and
docs/arcade-stress-test-2.8.3.md.

Release 2.8.2 gives Upwords more board space with a single compact action row,
small scores and no persistent rules/empty preview. Turn announcements remain
available to screen readers and active score styling shows the current player.
Zoom moved to the header. Rules remain in Help.

`upwords/tile-drag.js` owns mouse/touch/pen gestures; `game.js` owns drop legality.
Only rack indices and unplayed gold tiles move. Keep physical rack indices,
private draft/save behavior, authority intents and scores unchanged. A drag
must remain tied to the same actor, board, rack and draft, and must cancel on
handoff, turn change, modal, pause, lost capture or viewport change. Never mutate
a draft during pointer movement or let a compatibility click take back a drop.
The previous whole-Arcade 2.8.1 run 40971124102 passed both jobs.
2.8.2 preflight 40993361208 passed all 12 browser scenarios on
69c4ff62923b5dfc59227b34b41aac730bde3882, including actual touch stacking.
All 39 Upwords checks and 208 Worker/model/client checks passed. Screenshots
were visually reviewed. Final publication details belong in ProjectStatus and
docs/arcade-stress-test-2.8.2.md.

Release 2.8.1 corrects ten omitted standalone two-letter words, including UN.
The base ESDB list is retained and the reviewed 107-word short-word audit is
recorded in the generator and dictionary metadata. The old dictionary is a
strict subset, so local saves and room checkpoints accept that exact previous
ID and upgrade to the new one. Old clients cannot submit moves under the old
list. Unknown dictionary versions remain rejected.

Upwords now sizes the board from its actual allocated viewport using a resize
observer. Keep the board, rack and all move buttons visible without scrolling.
The word checker and history use optional overlays; deliberate Zoom can scroll
inside the board. Preserve draft privacy and keyboard controls. Dedicated browser preflight 40970825545 passed all ten scenarios on
8bcc5bcf0d0fd601ffbe70916b717a1ca5ff859a, including five viewport sizes and
real Internet/Nearby peers. Screenshots were visually reviewed. Publication
results are recorded in ProjectStatus and docs/arcade-stress-test-2.8.1.md.

Release 2.8.0 adds Upwords in `upwords/`, the 47th enabled activity. Dedicated
preflight run `40965998912` passed all rule, authority, client, real browser,
catalog and offline-shell checks on `3f66791c43677902db53089a485c1a25639bf2a5`.
Actual Internet rooms and offline Nearby RTC both passed. The final promotion
changes only this handoff and the verification report. Consult
`docs/arcade-stress-test-2.8.0.md` and ProjectStatus for the final main commit,
deployment results and supplementary whole-Arcade CI status.

`upwords/engine.js` is the source for local and authoritative play. The fixed
Arcade English list has 127,350 words and ESDB plural metadata. Keep dictionary
words, morphology, ID and notices synchronized through the reproducible build.
Clients send only versioned placement/pass/exchange intent. Opponent racks,
bag order, seed/RNG and exchanged letters must never enter public room views.
Nearby authority checkpoints retain private game state for their trusted host.

Local saves retain draft placement indices and visual rack order separately
from the physical rack. A device handoff must conceal both the rack and draft
board/preview. Entering a room preserves the local game and suppresses autosave;
leaving restores it. An older valid action acknowledgment cannot roll back a
newer socket state or report a false failure. Move dialogs must close when the
authoritative turn or round changes. Preserve all earlier activities and fixes.

Release 2.7.3 replaces the uniform crater heuristic with explicit weapon terrain
profiles. `terrain-rules.js` controls widths/depths/shapes, nonstacking reference
channels, builders, and exact chronological patch playback. `terrainVersion: 1`
on new shot/move traces distinguishes exact patches from legacy animation.
Keep the game schema and all weapon IDs stable; old trace/mines remain readable.
New mines optionally store `weaponId` so later shots cannot change their digging
profile. `flight` is a generator so burst/cluster projectiles advance together
and collide against the same evolving ground. Branching lightning must also
resolve in chronological order. Never sort effects without matching physics.

Terrain sketches use one shared scale, show profiles rather than predictions,
and must not count as weapon icons in the artwork uniqueness test. Fire and
spark visuals must remain separate from explosive blasts. Tunnels are collapsed
height-map channels, not enclosed cavities. Whole-Arcade 2.7.2 CI completed
successfully before this work began. For 2.7.3 verification/publication results
consult `docs/arcade-stress-test-2.7.3.md` and ProjectStatus.

Release 2.7.2 polishes Tank Tactics without changing the game/save schema or
weapon IDs. `weapon-art.js` has 84 distinct geometry compositions, not family
symbols with different badges. `terrain-rules.js` is the shared excavation
source imported by the engine and used to size visual terrain reveals. Damage
radius and damage budgets remain unchanged. Deploy the Internet Worker with
the browser because both authorities must use the updated excavation model.

`battle-view.js` owns only `arcade.tanks.wide.v1`. Fullscreen/rotation requests
must be user-triggered, rejection-safe and cancellation-safe. Unsupported
orientation locking falls back to a wide layout and a rotate-phone hint.
Keep movement distance usable in short landscape and title/actions separate.
Never store display mode in room state or replace the local game on a toggle.

The new checks include 1,764 extreme weapon cases, twelve complete CPU games,
a full shared-authority match, geometry uniqueness, genuine old-save restore,
and six browser layouts. The managed local browser denies navigation, so its
local visual tests used an inline bundle of the actual modules and a storage
fixture. Do not call that native persistence or live multiplayer verification.
`tools/test-tanks-polish-browser.mjs` runs actual modules/native browser reloads
in CI, including display rejection and cancellation cases. The existing real
Tanks Internet/Nearby browser suite is retained. Exact CI/publication results
belong to ProjectStatus and `docs/arcade-stress-test-2.7.2.md`.

Release 2.7.1 makes the shared multiplayer globe draggable with mouse or touch
and movable with arrow keys. Its normalized position is a local preference
saved separately per activity under `arcade.shared.launchPosition.<activity>.v1`.
The existing automatic placement applies until the user chooses a position;
periodic placement, room updates and DOM changes must never undo that choice.
Resize and visual-viewport changes clamp it inside the visible screen.
Dragging suppresses the following click, while ordinary taps and Enter/Space
still open multiplayer. Cancellation restores the previous position. The
original storage writer persists only this UI preference even for spectators;
game-save guards, room checkpoints and control authority remain unchanged.
`tools/test-multiplayer-globe.mjs` verifies real mouse/touch input, no accidental
activation, persistence, rotation, bounds, keyboard, cancellation, per-activity
isolation and blocked storage. All 109 transport/shell tests also pass.

Release 2.7.0 adds Tank Tactics under `tanks/`, the 46th enabled entry. It is a
competitive two-tank artillery game with 84 differentiated weapons, player
colors, flat/hilly/random destructible terrain, and no wind. Each tank receives
ten distinct random consumable weapons and four optional moves of up to five
tank lengths. Damage only adds points; self-hits award the opponent. Both tanks
fire all ten shots, remaining mines resolve, and higher points wins.

`tanks/engine.js` and `weapons.js` are the deterministic gameplay source for
local play and both room authorities. `multiplayer/models/tanks-authority.js`
accepts only configuration, start, move, fire and mutual-rematch intents. The
authority chooses the seed/inventory, validates the turn and computes scores
and terrain. Never accept client snapshots, scores or random seeds. Names stay
bound to room identities, and each player configures only their own color.
Tanks room chat is bounded at 16 KiB to leave headroom under Nearby's 64 KiB
checkpoint cap. The engine's measured largest extreme-shot snapshot was
21,876 bytes; accepted state and animations remain bounded.

Local saves include the resolved game, mines, aim/weapon choices, difficulty
and remaining movement. Save before animation so a reload cannot fire twice.
Network entry preserves the local aim backup and suppresses local autosave;
leaving restores it before autosave resumes. Transport-specific room keys keep
Internet and Nearby credentials separate. Unsubmitted lobby choices must survive
presence, poll and guest-configuration updates. The start button submits the
host's current draft settings before starting.

The responsive camera preserves physics coordinates and keeps both tanks
visible. Short landscape uses the available width; high shots have an offscreen
indicator. Idle scenes do not redraw continuously, the night backdrop is cached,
and active shots draw at a bounded frame rate. A movement animation has no shot
record, so its rendering must never dereference a null shot.

The 2.7.0 local checks include 10 engine tests, a 1,512-shot extreme sweep,
198 Worker/authority checks, nine actual browser cases, all 84 rendered icons,
full local and Internet games, save/reload, reconnect/rematch, four viewports,
109 shell/transport checks, 23 family model checks and complete PWA verification.
The local environment has only loopback and cannot gather a usable Nearby ICE
candidate. The browser test records that as blocked, not passed. LAN-enabled CI
must run the real Tanks RTC case. Exact publication/CI readiness belongs in
ProjectStatus. Snapshot `2.7.0+20261012.1` contains 370 runtime files.
See `docs/arcade-stress-test-2.7.0.md` and `tanks/README.md`.

Release 2.6.5 adds main-menu live search (title/category), default A-Z order and
a Recently used view of ten distinct launches, newest first. History uses only
device/browser localStorage key `arcade.recent.v1`, an ordered array of folder
IDs; blocked storage falls back to this page's memory. Filters intersect both
views. Record successful `ArcadeShell.openGame` calls via `arcade:game-opened`,
including URL/history/invitation launches, and the older native launch fallback.
`arcade:game-closed` refreshes saves/recent tiles after removing the frame;
restore focus to the connected launcher or its replacement `data-arcade-folder`
tile. Do not redraw the launch tile during open and strand the focus target.
Existing Android 2.4.0 remote-first APKs get the same menu without rebuild.
See `docs/arcade-stress-test-2.6.5.md` and the canonical ProjectStatus entry for
verification/publication; all prior activity, save and multiplayer work remains.
Shell events must use `new window.CustomEvent` to preserve the dispatch target's
realm in both real browsers and jsdom. The final snapshot is
`2.6.5+20261011.2`; all 187 Worker checks and the final catalog/offline shell
browser checks passed after that compatibility correction.

Release 2.6.4 restores classic Mad Libs word prompts. All 68 themes
have exactly 12 prompts, 126-150 one-word-template words, 12 short sentences,
and 18-24 blank occurrences. Every supplied word is used. Preserve the original
first twelve prompt positions, story order, categories, and fixed thematic cast.
Avoid asking players to invent the plot, cast, mission, solution, or reward.
The canonical story bank remains inline DATA in `mad-libs/index.html`.

Autosave adapter version 3 tags `storyFormat`. `legacy-stories-v2.js` preserves
the real v1 and v2 templates so completed old stories retain their exact words
and title. Old unfinished entries and Change Words move the first 12 answers
into the current story, with all old answers retained in `legacyAnswers`.
New snapshots with twelve answers must explicitly use `storyFormat: 3`.
The legacy script must be included in offline releases. Intentional story
selection focuses the first word immediately; save/shared restores skip
autofocus so they cannot steal focus during editing. Current checks and
publication belong in ProjectStatus and `docs/arcade-stress-test-2.6.4.md`.

Release 2.6.3 fixes Mad Libs capitalization and both story narrators.
`mad-libs/word-case.js` formats rendered answers without changing raw save/input
values. Keep name/place spelling, ordinary descriptions, sentence and quoted
reply capitalization, and escaping intact. `arcade-speech.js` selects the
existing Android native bridge or browser speech, retains utterances, and
cancels on Stop/navigation/hidden shell. Existing APKs require no rebuild.
Their bridge has no completion events: Adventure reads the current page, and
Mad Libs speaks a <=2000-character story once while Stop remains available.
Oversized native text must report the limit instead of silently truncating;
voice initialization gets a bounded readiness check. Do not infer physical
Android audio testing from the browser bridge fixtures.

The prior CI failure was a Tic Tac Toe browser assertion racing the winning
board's automatic round reset. Preserve the strict recorded-winning-version,
board, score, next-round and reload assertions. The transient sameState wait
was removed only for the final winning move. The full CI run for source commit `2177b1700650eee68cb582ea24a9daed77027a75`
completed successfully (run `38156801638`). Its checks are recorded in
`docs/arcade-stress-test-2.6.3.md`.

Release 2.6.2 adds the requested Mad Libs rewrite to the verified 2.6.1
release. Preserve the original twelve answer positions and 68 story themes for
old saves. That historical format used 18 answers with thematic role and plot prompts.
It is retained only for completed old results. Optional titles, v1 migration,
shared control and real local reloads were tested. See
`mad-libs/README.md` and `docs/arcade-stress-test-2.6.2.md`.

Release 2.6.1 keeps the following 2.6.0 additions and revises Adventure
with grounded prose, 70-word maximum reading pages, and actual progress saves.
Preserve all 124 scene IDs, branch conditions, inventory consequences, 30
choices per complete run, and eight endings. The new progress save is distinct
from recipe-history storage. It includes the director recipe, state, exact
Back history, and word anchor; validated versioned restores must not silently
switch to a different story. Save behavior and checks are described in
`adventure/README.md` and `docs/arcade-stress-test-2.6.1.md`.

The 2.6.0 web release adds two solo catalog entries to the previously verified
2.5.0 release. `adventure/index.html` is now the maintained canonical source for
Logan and Jenkins: Operation Giggle. `Misc/AdventureGame` is a historical import,
not a second maintenance target. Preserve its 124-scene graph, eight endings,
30 decisions per route, exact Back state, age 7-8 prose, measured pagination,
and narration cancellation. Recipe history remains separate from progress saves.

`tv/` is a minimal preset-only TorBox client. It uses the existing
`https://torbox-web-player-key.onrender.com` API, exact title identities, and
browser media playback. Remembered API keys use a TV-specific encrypted
IndexedDB vault; the backend has the key temporarily in process memory. Never
put TV keys/session tokens/media URLs into generic Arcade saves, shared rooms,
logs, archives, or metadata. The owner browser can receive TorBox credentialed
CDN URLs, as in the full player. TV has no multiplayer adapter or search UI.

The TorBox API permits `https://to-shreds.github.io`. Live requests from
`https://arcade.local` and localhost were rejected by its CORS policy. TV must
show the hosted Arcade link for those origins rather than claiming local
archive playback works. The existing Android online mode uses the allowed
web origin. Changing the backend allowlist was not part of this release.
Nearby's no-public-network guard remains intact; disconnect Nearby for TV.
Fullscreen defaults to the screen-filling player, requests native fullscreen
within the Play gesture, and retains a tap-to-play fallback for blocked
browser autoplay. No physical Android/iOS or real TorBox account playback
verification is claimed for 2.6.0.

The enabled catalog now has 45 entries, including the existing 43 online
entries. Source and browser checks for the new activities are described in
`docs/arcade-stress-test-2.6.0.md`; exact publication and artifacts belong in
ProjectStatus. Existing APKs are retained without rebuild.

## Prior release 2.5.0 baseline

The 2.5.0 web release is implemented in this repository. It adds
Internet/Nearby shared play to all 34 previously unsupported activities,
retains the eight competitive multiplayer games, and adds images to Chat.
The enabled catalog has 43 entries. Backyard Baseball remains disabled.
The Worker, shared transport/client, two-browser gameplay, all-catalog visual,
initial-lobby, recovery, and adapter checks have passed. The service-worker
marker is `2026-10-03-arcade-shared-online-v1`; the complete offline manifest
is `2.5.0+20261003.1` with 343 files. Publication readiness, the exact release
commit, deployment results, and the real RTC CI result belong to the canonical
ProjectStatus entry. Do not infer deployment merely from `package.json`.

## Controlling sources

- `catalog.json` and each activity's `game.json`: enabled entries and online mode.
- `multiplayer/arcade-multiplayer.js`: transport bridge, transport pinning,
  authoritative-room observation, invitations, and turn/control alerts.
- `multiplayer/shared-activity.js` and `multiplayer/shared-room-client.js`:
  shared checkpoints, simulation pause, observer rendering, passing/recovery,
  local backup restoration, HTTP/WebSocket acknowledgement, and reconnects.
- `multiplayer/models/`: environment-neutral room models, competitive rule
  validators, shared-activity control validation, and image validation.
- `multiplayer/nearby-room-service.js` and the Nearby session/protocol modules:
  host authority, locked identities, bounded RPC/socket delivery, and recovery.
- `cloudflare/chess-worker/src/index.js`: production Internet room service.
- `arcade-save.js` and game-specific adapters: local saves and shared restoration.
- `README.md`, `CHANGELOG.md`, and
  `docs/arcade-stress-test-2.5.0.md`: behavior, release scope, verification, and limits.
- `sw.js`, `offline-manifest.json`, and
  `tools/generate-offline-manifest.mjs`: complete versioned offline release.
- `.github/workflows/test-arcade-web.yml` and
  `.github/workflows/deploy-arcade-worker.yml`: CI and production Worker rollout.

## Completed work

Shared rooms have one controller, up to eight members, observer state/animation
delivery, explicit passing, controller-loss recovery, and restoration of the
browser's local activity on exit. Make 10, Blackjack, Shuffleboard, and Bowling
can hand controls off automatically when their configured player roster matches
the room. Shared play is not simultaneous independent control and does not
award competitive Arcade Stars.

Dedicated adapters preserve Simon phase/input, Hangman private drafts, Jigsaw
media/completed state, Make 10 and Trivia progress, and Music Maker notes,
compact shared loops, and local audio state. Accepted checkpoints and canvas
frames remain bounded. Music Maker retains full-quality local recordings.

Competitive repairs cover pending-action input, stale-response and
acknowledgement races, reconnect/presence updates, Sorry visible-card/no-move
phases, and Monopoly animated-roll/Jail transitions. Responsive repairs cover
narrow portrait and short landscape boards, headers, setup panes, controls,
Bowling, and native Typing cursor/emoji behavior.

Chat supports selected/pasted/dropped images, compression, preview/remove,
captions, image-only messages, an accessible larger viewer, retained reconnect
history, and idempotent retries. Limits are 24 KiB per attachment, 1280 pixels
per dimension, and 48 KiB/100 messages in recent history. Raster type and
dimensions are validated by the shared authority. Existing chimes and desktop
notifications remain intact.

The Chat suite passed 17 tests and its real Chromium/Miniflare two-client flow
passed actual upload/compression, WebSocket delivery, viewer, reload/resume,
lost-response retry, paste/drop, and four viewport layouts. The final
two-browser competitive/shared run passed 42/42 entries with no page errors.
The complete Worker regression suite passed 187/187 tests after fixing a queued
initial Chat scroll that could override a reader's newer scroll position. The
combined transport/client check passed 116 tests. Generated evidence is under
`test-results/`. The verified visual sweep passed 180/180 records across 45
catalog/shell pages and four viewport sizes, with no JavaScript errors,
failed/missing assets, or interaction failures. Remaining final results belong
in the release test report.

## Verification and publication

Local evidence includes 187 passing Worker tests, 108 shared transport/client
tests, 42 competitive/shared online flows, Chat image flows at four sizes,
180 visual/interaction records, 34 untouched shared lobbies, seven adversarial
recovery cases, and six physics control transfers. Dedicated adapters passed
at desktop and mobile sizes. Offline hashes, complete browser download/reload,
Paint launch, Home navigation, native input, and Android wrapper source checks
passed. Test scripts and release packaging are committed; generated evidence
is under `test-results/` and CI retains browser artifacts.

GitHub Actions tests the release and deploys Pages and the existing Worker.
Use ProjectStatus and the Actions history for the exact per-commit publication
result. The optional `tools/test-production-browser.mjs` checks public Typing
and Chat rooms without substituting local endpoints and cleans its memberships.

Actual Nearby RTC cannot gather interfaces in the managed local sandbox
(`uv_interface_addresses` returns `EPERM`). Its real browser check is configured
in CI. Preserve the distinction between that CI result and local model/session
verification. No physical iOS or Android hardware was tested during this run.

## Do-not-break constraints

- The active room remains pinned to its original Internet or Nearby authority.
  Loss of Nearby must never send the room or saved token to Cloudflare.
- Pairing is managed once by the persistent Arcade shell, not as a new game mode.
  Direct activity links remain usable with Internet rooms.
- Preserve existing local/CPU modes, local saves, preferences, statistics, and
  private unsubmitted drafts. Shared observations cannot overwrite local saves.
- Only the accepted turn/controller can change shared game state. Observers
  must not independently run random choices, animation resolution, or timers.
- A control transfer must drain pending state acknowledgement and apply the
  accepted checkpoint before the receiving device starts its simulation.
- Retain competitive rule validation, Guess Who secret privacy, and exact
  Memory reveals. Shared control validation is not full competitive-rule validation.
- Keep frame/request limits and decompression bounds. Oversized state must fail
  clearly rather than partially synchronize. Chat images require no new storage.
- Keep Nearby runtime offline: no public STUN/TURN, signaling service, media
  relay, silent Cloudflare fallback, or new paid dependency.
- Preserve the atomic, hash-verified last-known-good offline snapshot and the
  retained APK releases. Deployment credentials remain outside the repository.

## Next action

Read the canonical ProjectStatus entry and the current commit’s Actions before
reporting publication readiness. For a new device-specific issue, refresh the
offline copy, reproduce on the affected devices, and retain local saves while
collecting the exact room, browser, viewport, and disconnect behavior.
