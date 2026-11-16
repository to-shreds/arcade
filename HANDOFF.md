# Comic Library 2.13.5: large CBZ/PDF books without a total file cap (2026-11-16)

Canonical source: `to-shreds/arcade` main, `comic-reader/`.
PR #14 runtime merge `b28e1d449c5381e276ff41f3847af2a1eca84a23`.
Live: https://to-shreds.github.io/arcade/comic-reader/
GitHub bookshelf: https://github.com/to-shreds/Misc/tree/main/cbz

Issue: Comic Library 2.13.3 hard-rejected files over 150 MiB, CBZ archives
exceeding 750 MiB total uncompressed images, and books above 2,000 pages;
JSZip loaded entire archives and PDF.js copied whole documents into
Uint8Array. Those ceilings were arbitrary and made large comics unusable.

Implementation: the 150 MiB and 750 MiB total restrictions are removed;
CBZ reading uses bundled zip.js 2.25.0 ZipReader/BlobReader with ZIP64
and per-page BlobWriter extraction rather than whole-file inflation.
PDF.js uses its Blob-backed PDFDataRangeTransport and demand-based
requestDataRange reads (no eager complete Uint8Array). Browser downloads
use streamed Blobs, and image URLs remain bounded to twelve pages.
An individual decompressed image is guarded at 256 MiB to prevent
malicious ZIP bombs; this is not a total book limit. Offline saves
remain subject to the device's actual browser storage quotas.

For GitHub books over 100 MiB: `comic-reader/split-book.py` cuts
the original CBZ or PDF into 24 MiB *raw byte* parts named
`Title.cbz.001`, `Title.cbz.002`, etc. Parts uploaded into public
`Misc/cbz` are grouped automatically into a single bookshelf item
and reassembled into a composite Blob when opened. Missing middle
parts invalidate the group; downloaded parts are verified against
declared sizes. The updated Misc/cbz/README.md documents it.
Do not use 7-Zip multi-volume compression; keep the original bytes.
GitHub Releases allow individual assets under 2 GiB but are not
auto-listed through this directory; this update does not claim otherwise.
Standard repo website uploads: 25 MiB per file, git pushes: 100 MiB.

Verification: targeted GitHub Actions Comic Library workflow
43962371808 succeeded on branch. Tests included actual CBZ and
PDF.js browser rendering, ZIP entries with nested paths, local CBZ
over 160 MiB (sparse ZIP fixture), file selection, GitHub grouping,
large book unit tests, bookmarking, offline storage and shell Home.
Main deployment workflow 43962723355 succeeded; main Comic
Library run 43962727112 and Retro Vault run 43962727121 succeeded.
Broad web suite 43962727126 was still in progress at handoff time,
so do not report comprehensive project-wide success or actual
physical Android tablet verification.

Verified complete offline ZIP (all 439 entries matched individual
manifest SHA-256/length): `/Arcade/Arcade-2.13.5-Large-Books.zip`
in ChatGPT File Library. 16,044,732 bytes;
SHA-256 `dca6e2641e40c4c4f01373aef24af52213bbed550fbeeb18529415ba3d6a5e85`.
Manifest: `2.13.5+20261116.1`, 439 runtime files,
24,844,361 bytes. Library upload and listing verified.

Do not break Tank Tactics 2.13.4 full-stage terrain/knockback,
its save and multiplayer authority, Monster Forge v2 artwork and
saved creatures, previous Comic Library bookmarks and IndexedDB,
the Android unfiltered file picker, Home navigation, or atomic
offline-manifest hashes. On future edits run
`node --test tools/test-comic-library-core.mjs tools/test-comic-library-large-core.mjs`,
`node tools/test-comic-library-browser.mjs`,
`node tools/test-comic-library-large-browser.mjs`, and
`node tools/test-shell-navigation.mjs`. Next action: test an actual
multi-hundred-MiB local CBZ and a multipart GitHub CBZ on the user's
Android device. Investigate device-specific memory/quotas only with
a reproducible failed file; do not reimpose a whole-book cap.

---

# Tank Tactics 2.13.4: full battlefield and floating hit numbers (2026-11-16)


**Release verified:** runtime merge `98bc4dd3bb5ddff81743a61e41e66595141d0664`;
Pages 43960652900 and Worker 43960653609 succeeded.
Portable release [Arcade v2.13.4](https://github.com/to-shreds/arcade/releases/tag/arcade-v2.13.4)
was built by successful workflow 43960958476 and independently verified
against provenance SHA-256 `b35b5b98a8f67d49fa9e28b847b79f54a8593530290c50967e64f907c424a0f2`.
ZIP: 16,002,353 bytes; manifest `2.13.4+20261116.1`, 437 validated
runtime files, 24,730,449 runtime bytes. The identical archive was
uploaded to and verified accessible in ChatGPT File Library at
`/Arcade/arcade-2.13.4-web.zip`.
The combined project-stress Tanks/Upwords browser job and model/package
checks passed. Broad unrelated browser groups remained in progress
when this release record was written; do not claim the full suite green
without a final result. Low-cost physical tablets remain untested.


Merged source `98bc4dd3bb5ddff81743a61e41e66595141d0664`, PR #10. The 2.13.4 Tank update is in main;
publication and packaged archive are verified separately.

Authoritative changes: movement is clamped to the closest legal boundary
and charged only on actual displacement; per-hit positive damage records
are added to effect traces, including blast, beam and mines; cosmetic
damage numbers float toward the top of the complete screen; and scores,
controls and status are translucent overlays over a full-screen stage.
The camera accounts for all terrain samples and retains proportional
geometry. The permanent weapon loadout was removed from the battlefield,
but the in-match weapon chooser remains available.

Preserve: all 132 weapons and original IDs, shot/scoring rules, knockback,
four deliberate moves, old saves, multiplayer Worker, Arcade Home helper,
Comic Library CBZ picker fix, Monster Forge 2, Retro Vault and other games.
The `damageHits` array is optional for legacy saved traces and must
remain bounded and validated. Overlay numbers are cosmetic; do not
change authoritative scores for visual reasons. The camera must show
both horizontal terrain ends on narrow phones.

Verification: [Tank browser preflight run 43959852413](https://github.com/to-shreds/arcade/actions/runs/43959852413)
passed the dedicated Tanks/Upwords group and model/package checks on
the combined latest source. [Full report](docs/arcade-stress-test-2.13.4.md).
Production GitHub Pages and multiplayer Worker deploy on merge; confirm
their successful run states. Physical low-end Android tablet confirmation
is still outstanding.

Next steps: verify actual low-cost Android tablet performance and
control ergonomics, and inspect any unrelated broad CI failures.
Do not overwrite concurrent Comic Library or Monster Forge edits.

---

# Comic Library 2.13.3: Android CBZ picker repair (2026-11-16)

Canonical: `to-shreds/arcade` main; merged change PR #13,
`0891a74f2c7802b401cb394c8c312032e04f72e1`.
When a local CBZ was selected in Android's file manager, the file was
grayed out before browser JavaScript could receive it, while PDFs
remained selectable. Cause: the HTML file input's `accept` types
included an uncommon CBZ MIME type and PDF types, which Android's
document provider can resolve as a PDF-only filter. The targeted fix
removed only `accept` from Comic Library's local picker. File names
are still checked by the existing `supportedFile` validator for
case-insensitive `.cbz` or `.pdf` after selection, with a clear error
for unsupported files. No Android native code change or APK rebuild is
required for the hosted Arcade. All existing ZIP/PDF reader logic,
bookmarks, offline IndexedDB, Home, Monster Forge 2.0, and other
activities are unchanged.

Verification: branch Comic Library workflow 43818246022 succeeded,
including actual Chromium file chooser invocation and unsupported
`.txt` rejection, real CBZ and PDF page rendering at 320x568,
390x844, 844x390 and desktop sizes, bookmark and offline restore,
unit checks and Arcade shell navigation. Complete portable release
`2.13.3+20261116.1`, with 437 runtime files and 24,718,233 runtime
bytes, was verified for all entries against its manifest.
ZIP SHA-256:
`e657cc9976df7a1c666187461ae4896d50e881d78dbe31a61f431b2dc4d0fb5b`.
Exact ZIP in verified ChatGPT File Library path
`/Arcade/Arcade-2.13.3-CBZ-Picker.zip` (15,994,763 bytes).
Source GitHub folder `to-shreds/Misc/cbz` remains public.
Normal GitHub browser uploads are limited to 25 MiB per file; Git
pushes support up to 100 MiB per file. GitHub Contents API cannot serve
files larger than 100 MiB. This reader does not yet handle Git LFS
pointer assets. For large comics consider a separate asset host, rather
than silently assuming LFS works with the current reader.

Not yet hardware-verified: the Android system file-picker behavior
with the user's specific tablet/phone. Test opening a local CBZ and
then a PDF directly in the hosted Arcade after refreshing offline
content. If the CBZ is still grayed out, investigate the system picker
and Android WebView's `FileChooserParams.createIntent` output using the
real device; do not change CBZ decompression logic without a repro.

---

# Monster Forge 2.0, Arcade 2.13.2 (2026-11-16)

Source: monster-forge/ in this repository. This release adds 50
illustrated anatomical pieces and six fully editable starter creatures.
Existing saved v1 parts retain their original artwork through the
per-piece artVersion field. New pieces have recognizable teeth, claws,
feathers, wing membranes, suckers, joints, tails and robotic details.
The blank drawing canvas remains available. Larger cropped previews
and a separate selected-part panel make size, color, rotation, copy,
flip, mirror-copy and layering accessible without browsing past parts.

Also repaired: incremental live stroke rendering, geometry-based
picking, collection fallback preservation beyond fifty saves, safety
when saving before switching creatures, and 1800x1200 PNG export.
Preserve old storage keys, creature IDs, artVersion=1 rendering,
all existing games, Comic Library and multiplayer behavior.

Verification: tools/test-monster-forge-browser.mjs passed actual
Chromium checks at 320x568, 390x844, 832x384 and 1280x800; all 50
insertions; six starters; mouse/touch drawing; part transforms;
old-save artwork; IndexedDB collection and autosave reload; fallback
save failure protection; PNG dimensions; effects and shell Home.
Shell navigation and Comic Library core/browser regressions passed.
The offline manifest and complete ZIP are generated and validated.
No all-project green or physical Android tablet testing is claimed.
Next: play it on the children's tablets and report any device issue.
ProjectStatus records publication and final artifact fingerprints.

---

# Comic Library 2.13.1: CBZ/PDF reader (2026-11-16)

Canonical source: `to-shreds/arcade` main, `comic-reader/`.
Live: https://to-shreds.github.io/arcade/comic-reader/
Merge PRs #9 and #11; corrected reader runtime merge
`2cb90a836629b43e10fce1ab7cee66f2ad470a50`.
`to-shreds/Misc/cbz` now exists (public, with README); uploading
`.cbz` or `.pdf` on its main branch automatically populates the bookshelf.
Local files use the existing Android WebView/browser file chooser.
The Activity is `Comic Library`, with a house icon and shell-preserving
`ArcadeSave.goHome()`, and does not use the multiplayer Worker.

Reader features: GitHub browsing/refresh/search, local CBZ/PDF selection,
naturally sorted nested CBZ image pages, lazy PDF.js rendering, swipe/tap
page turns, keyboard navigation, pinch zoom/drag, fit page/width,
continuous vertical or landscape two-page mode, direction setting,
page slider, bookmarks and per-book last-page resume. GitHub comics are
downloaded only when opened, and optional offline copies are stored in
local IndexedDB. Local files are not uploaded. The PDF.js 3.2.146 and
JSZip 3.10.2 scripts and PDF.js worker are bundled with the offline
Arcade runtime. Explicit ZIP conversion is not part of this feature.
The GitHub Contents API is unauthenticated, so rate limits and public
file size limits apply; no GitHub personal token is needed.

Verification: 3 core tests and focused real-Chromium browser tests,
including real PDF.js rendering, local CBZ/PDF, nested page numbering,
bookmarks, last-page progress, IndexedDB offline saving, GitHub-library
mock, 320x568, 390x844, 844x390 and desktop layouts. The first CI
run identified a fast navigation race, repaired before PR #9. Broader
`test-shell-navigation` later identified a direct Home fallback,
repaired in PR #11. The corrected focused workflow run
43811283473 passed, including shell-navigation regression test,
offline manifest, packaging. No hardware Android tablet or browser
long-duration storage-quota test performed. Broad Arcade Web
regression tests have previously had unrelated failures; check their
current results before claiming a fully green project.

Offline manifest: `2.13.1+20261116.1`, 436 hashed runtime files,
24,676,360 bytes. Final repaired complete ZIP, internally verified
against all manifest sizes and hashes:
`/Arcade/Arcade-2.13.1-Comic-Library.zip` in ChatGPT File Library,
15,976,562 bytes, SHA-256:
`e1d487946e6ce6a2e638c9ed087b652ad25c46289832800d9c25c0d153149ba6`.
Its Library copy was overwritten and verified present. The unpacked
source and README are under `/Arcade/Comic Library/`.

Do not break: existing Arcade catalog, saved activities, Worker,
local-only content isolation, shell navigation, service-worker
offline manifest/atomic update, or previous games. On future edits,
run `node --test tools/test-comic-library-core.mjs`,
`node tools/test-comic-library-browser.mjs`,
`node tools/test-shell-navigation.mjs`, and manifest/archive
verification. Next action: verify reading a representative large
GitHub CBZ and PDF on a real inexpensive Android tablet; adjust only
if a reproducible device-specific issue appears.

---

# Monster Forge v1, Arcade 2.13.0 (2026-11-16)

Source: `to-shreds/arcade` main, `monster-forge/` directory.
The new creative activity is drawing-first and independent of Silly Face Lab.
It has freehand drawing, 33 draggable/rotatable/resizable parts, fill and
symmetry tools, seven backdrops, 36 prompts, randomized Monster DNA,
local IndexedDB collection, Arcade draft autosaves, metadata, evolutionary
copies, PNG export and an animated test chamber. The Home house icon
calls `ArcadeSave.goHome()` and works in the Arcade shell.
Catalog, versioned offline manifest and service-worker version are updated.
No modification was made to other games, worker authority, saves or controls.

Focused browser checks: mouse/touch drawing, symmetry, undo/redo, parts,
gallery save/reopen, evolution, PNG export, effects, and responsive
320x568, 390x844, 832x384 and 1280x800 views; no JS errors.
Static JS syntax and package integrity verified. Real physical Android
tablets, database persistence across an actual WebView restart, and broad
unrelated regression CI were not directly tested in this environment.
Future work: physical-device feedback, more parts, and optional richer
part rigging if useful. Preserve Monster Forge's namespaced collection and
avoid deleting existing user creations. Source package is in the ChatGPT
File Library under `/Arcade/Monster-Forge-v1.zip`.

---

# Tank Tactics 2.12.1: knockback and precise controls (2026-11-15/16)

Canonical repository: `to-shreds/arcade`, main runtime merge
`0368c43a38a03ee7626234332a1ba34dac087892` from PR #8. Live game:
https://to-shreds.github.io/arcade/tanks/.
The GitHub Pages run 43800413593 and multiplayer Worker run 43800414181
both completed successfully. The verified offline manifest version is
`2.12.1+20261115.1`, with 420 runtime files and 23,099,181 bytes.

Implemented: every new CPU, hotseat, Internet and Nearby Tank battle draws
10 distinct randomized weapons per player from the full 132-weapon roster.
The old Classic and Extra Silly selectors and local saved mix preference are
ignored/removed; no pool selection appears in setup or Settings. The normal
selection among the player's ten remaining weapons is preserved.

The authoritative Tank engine now moves tank x-position when sufficiently
strong hits land, including during armed mine explosions on a voluntary move.
Weapon-family impulse changes the force, small hits have no displacement,
and each shove is capped at 75 world units. Tanks cannot leave the playfield
or cross one another, and always settle onto current terrain. Knockback
does not use any of the four optional player moves. Each changed position
and its visual hop height is recorded in the bounded effect trace. Canvas
replays the position, hop and tilt; scored damage is unchanged. Old saves
without knockback fields still validate and load unchanged.

Both sides of angle, power and movement sliders have one-unit step buttons,
respectively 1 degree, 1 percent and 1 tank length. Existing sliders,
number boxes, movement left/right actions and keyboard behavior remain.
End stops and disabled-turn controls are enforced. In-match weapon picker,
Test Range, local saves, room credentials, 132 original icons, shared menus,
Retro Vault and other Arcade features remain.

Verification: the focused project-stress Tanks/Upwords browser group in
run 43799933209 succeeded; it covers real Internet and Nearby rooms,
CPU and local matches, 132 icon raster checks, terrain replay, 20-shot
games, local save/reload, full viewport geometry, arrow controls and mines.
The new tanks-impact browser report explicitly passed knockback replay,
steppers, saved displaced position, move-triggered mines and four layouts,
with zero JS errors. Tank engine/model tests passed, as did model/package,
Nearby, Bug Squish and stories/TV subgroups. Retro Vault and production
Pages/Worker deployments passed. Broader browser suites have separate
statuses; do not claim them green until confirmed. See
`docs/arcade-stress-test-2.12.1.md`.

Do not break: original weapon IDs, saves and old match inventory, damage
points, height-map terrain, deterministic physics, authoritative room
control, bounded checkpoint size and offline content hash verification.
Both client and Worker must ship `tanks/engine.js` together. Affected
module files: `tanks/engine.js`, `graphics.js`, `game.js`,
`index.html`, and the updated test files. The precision arrows are
`angleMinus/Plus`, `powerMinus/Plus`, and `moveMinus/Plus`;
the JS binds the last two using the `move` prefix, not `moveDistance`.

Next action: confirm the portable web ZIP and provenance hash, upload the ZIP
to the ChatGPT Library, and confirm behavior on the children's actual tablet
when available. The CI browser coverage does not prove physical-tablet
performance. If there is a future reported regression, reproduce it
against the exact current game state and viewport before changing physics.

# Tank Tactics 2.12.0: playable, playful 132-weapon arsenal (2026-11-15/16)

Canonical source: `to-shreds/arcade` main, runtime merge
`e89c35d4ad8d185148c1b19a3c3a4b09e4cef2a5` from PR #7.
Live game: https://to-shreds.github.io/arcade/tanks/.
GitHub Pages deployment 43793967953 and Arcade Worker deployment 43793968401
both passed. Offline snapshot `2.12.0+20261115.1` has 420 files,
23,090,029 runtime bytes, and a SHA-256 manifest verified in CI.

Implemented: the original 84 stable weapon IDs plus 48 new themed weapons
from `tanks/fun-weapons.js`; all 132 are the default for new games and
Internet/Nearby rooms. Exactly 26 classics have more playful display names
and visuals without altered original scoring, damage or excavation physics.
New weapons carry explicit terrain profiles, individual SVG pictograms,
Canvas projectile/impact signatures and light synthesized themed audio.
Additional signatures distinguish all older families and their variants.
Local setup has Original 84 and Extra Silly (seven new plus three classics);
these options never alter existing saves or authoritative room rules.
`tanks/range.html` is an isolated, unlimited-ammunition Test Range.
The existing Arcade Home house icons and Retro Vault stay intact.

Verification: the latest 132-weapon engine and 84-icon compatibility tests
passed, along with the dedicated Tanks browser/terrain/polish suite in
project-stress run 43792746365. That run covers real Internet/Nearby peers,
hotseat/CPU play, exact saves and reloads, six layouts and offline packaging.
Direct module sweeps included 264 deterministic shots and 528 drawing samples.
The full project-stress run 43792746365 passed every group, including
model/transport, Tank/Upwords, menus/tools, catalog/offline, stories/TV,
shared multiplayer, and Heist. Retro Vault and Guess Who also passed.
The separate consolidated Test Arcade Web run 43792746309 passed its
Tank/Worker/packaging steps but failed on both attempts at a Train PWA
`navigator.onLine` assertion after Chromium offline emulation.
Do not describe that entire web workflow as green. See the
[verification report](docs/arcade-stress-test-2.12.0.md).

Do not break: never change the 84 original weapon IDs, save schema,
turn/scoring rules, deterministic terrain timing, mine ownership or room
authority. Client/Worker must ship `tanks/fun-weapons.js` together;
explicit Miniflare test module lists must include it. Preserve the
hash-verified offline manifest, reduced-motion behavior, distinct
return-to-Arcade house icons, and existing 50 activity entries.
The new visual effects are cosmetic: only `engine.js` and
`terrain-rules.js` determine terrain and points.

The portable 2.12.0 ZIP was published and independently verified:
https://github.com/to-shreds/arcade/releases/download/arcade-v2.12.0/arcade-2.12.0-web.zip
(15,528,643 bytes, SHA-256 7c0e09cadb074acacf76439ba4d8c21adae6430348a71c8409d9b42a92f59057).
Its Library copy was uploaded and verified at
`/Arcade/arcade-2.12.0-web.zip`. Release packaging workflow
43794329130 passed; the ZIP checks all 420 runtime-file hashes.
ProjectStatus records final readiness and links. Future device-specific work
should verify performance on a physical low-end Android tablet; the browser
emulator cannot substitute for that device check.

# Arcade house icons for return-home controls (2026-11-15)

The current family Arcade includes 50 enabled activities, including Retro Vault.
Arcade exits now display a recognizable 🏠, without removing their text or
changing the existing click, save, or navigation handlers. Most activities
load `arcade-save.js`, which decorates initial and dynamically inserted
return-home buttons. This also covers the old `← MENU` / `Back to Menu`
controls whose `goToMenu()` action actually leaves for the Arcade. Controls
that open an activity's own menu instead are explicitly excluded after
`data-shared-menu-toggle` is assigned, preserving their ☰ identity.
Arcade Chat's two exits were updated in its standalone HTML; Guess Who already
had recognizable house symbols. Existing 🏠 icons are not duplicated.

Current offline snapshot: `2.11.0+20261115.2`, 417 files, 23,054,706
runtime bytes; updated `offline-manifest.json` SHA-256 and byte counts for
`arcade-save.js`, `chat-room/index.html`, and `sw.js` (worker
`2026-11-15-home-icons-v2`). Original game engines and checkpoint formats
remain unchanged. Browser regression assertions are in
`tools/test-menu-home-browser.mjs`. A real Chromium fixture passed 10
navigation icon and non-home-button cases in each of four layouts
(390x844, 844x390, 320x568, 1440x900), including dynamic menu insertion,
icon replacement and menu-toggle reclassification; existing button click
events were also checked. The full `arcade-save.js` passes JavaScript syntax
validation. Source and manifest checks matched the exact post-change asset
hashes. GitHub Pages published the runtime snapshot, and Retro Vault CI
passed on the runtime snapshot. Full web CI remains a separate check; the
preexisting web test suite had unrelated failures, and the new house-icon
assertions must be assessed with that distinction.

Do not break: home symbols must identify navigation to the main Arcade,
not an internal settings/play menu. Do not intercept or alter the existing
navigation routes. If a game gains a new navigation pattern, add coverage to
the shared recognizer or the game's own visible button, then test on a narrow
phone and in landscape. Next: check the newest `Test Arcade Web` run and
refresh the installed/offline Arcade on Scarlett's device to confirm the
icon is visible in the actual WebView.

# Retro Vault 2.11.0: classic game expansion

Implemented 26 original classic-inspired games in one self-contained `retro-vault/index.html`, with separate launcher tile `Retro Vault` and matching `retro-vault/icon.svg`. The existing 49 activities, shared/competitive games and Nearby transport are unchanged. Modes: 14 action (Snake, Breakout, Pong, Invaders, Asteroids, Flappy, Frog Crossing, Light Cycles, Meteor Dodge, Highway Dash, Ski Slalom, Star Catcher, Missile Defense, Jetpack) and 12 puzzles (Block Drop, 2048-style Merge, Sokoban, Lights Out, Four in a Row, Reversi, Peg Jump, Sliding Puzzle, Flood Fill, Match 3, Sudoku, Pipe Circuit). These are original JS implementations, not original DOS/Windows game binaries or ROMs.

Input: touch buttons, canvas taps, board swipes, keyboard, browser Gamepad API (D-pad/sticks, mapped A/B, mapped Start pause/resume), vault selection by gamepad and per-game localStorage checkpoints. A settings dialog permits action/menu button remapping. When available, ArcadeSave.goHome preserves shell navigation; direct downloads fall back to the hosted Arcade home. Separate group in catalog, no `shared-activity.js`, no online rooms, and no change to existing 49 activities' multiplayer semantics. The new HTML is self-contained; icon and ArcadeSave external script are optional when opened as a standalone download.

Local Chromium testing used content injection where this environment blocks navigation. All 26 engines passed inputs, 40 ticks and drawing in desktop, portrait, narrow portrait and landscape. Browser tests passed saving/reopening all modes, Sudoku/Flood extra selectors, keyboard, touchscreen 2048 swipe, simulated Gamepad API selection/action/start/disconnect, search/filter and screen geometry. There is no physical Bluetooth controller validation yet. `tools/test-retro-vault.mjs` and an independent GitHub Actions workflow give hosted-origin checks; consult workflow results before calling publication fully verified. Preserve canonical offline manifest with SHA-256 hashes, PWA atomic update behavior and the 2.10.2 Time Master clock fix. Do not treat unrelated existing TV/Face Lab stress failures as resolved.

Next: verify retro GitHub CI and broad regression against this branch; publish only after required tests, update ProjectStatus last.

# Time Master clock 2.10.2: mobile geometry repair

Published at https://to-shreds.github.io/arcade/ (runtime merge
3fec6d366dfd4deb95fd06ed50c8cd9e0e94fe20). Full verified web ZIP:
https://github.com/to-shreds/arcade/releases/download/arcade-v2.10.2/arcade-2.10.2-web.zip.
Snapshot 2.10.2+20261108.1, 415 runtime files, 22,971,520 bytes.

Root cause: the previous clock rendering mixed a device-pixel-scaled canvas
bitmap with CSS-pixel drawing geometry. If the drawing context reset (including
in Android WebView), the implicit scaling disappeared and left a tiny dial
drawn in the upper-left of the visible canvas. A separate guessed inline
canvas size also competed with CSS !important phone rules. Fix: CSS now
exclusively owns the displayed canvas size, resize() follows its actual client
dimensions and devicePixelRatio, and drawClock() starts with identity transform
and computes all geometry from actual backing-store dimensions. Phone clock
can be up to 298 px without displacing the keypad; landscape is bounded.
Preserve correct scaled fonts, ticks, pivot, pointer dragging, all three
modes, saved/restored game state, shared room authority, and CSS-owned
canvas sizing. Do not reintroduce ctx.setTransform(DPR) with CSS-space
drawing or independently change inline width/height.

Verified 90 real-browser clock scenarios (six viewports, DPR 1/2/3,
three modes, pointer/context reset, rotation and hidden restore), all PASS
in the 2.10.2 release job 42514388444. Save contract, native keyboard,
Android wrapper source, offline manifest and ZIP packaging checks PASS.
Main Pages deployment run 42514434917 succeeded. PR Test Arcade Web run
42513863079 passed its combined clock, menus and young-kid Trivia step;
its overall result was failure at an unrelated TV seek-preservation assertion,
with no TV runtime changed in this release. Do not call the whole CI green.
Physical Android handset rendering has not been independently observed.
See docs/arcade-stress-test-2.10.2.md and ProjectStatus for exact release
status. Next action for a reported device problem: refresh the live page and
update the hash-verified offline copy, then reproduce on the phone before
changing the drawing geometry again.

# Trolley card update 2.10.1

Track cards now are native choice buttons. Non-route options remain separate.
Local all36 scenarios/73 branches, keyboard/touch, four layouts, observer gate,
seven Train groups and offline hash audit pass. Focused CI and publication
readiness are recorded in ProjectStatus. Existing2.10.0 constraints below apply.

# Arcade continuation handoff

## Current implementation: 2.10.0, verified

Runtime source f55e55ce031b2da65d8a91ed1d3682b71cc6394a. Read-only shared-test
repair 8d96a80793ad6b45150dd5b5b0ac0a1d1c748eef changes no game assets.
ProjectStatus controls final main/publication, package and readiness. Canonical
repository remains to-shreds/arcade. Approved scope: docs/arcade-2.10.0-design.md.
Snapshot 2.10.0+20261107.1: 415 runtime files, 22,969,994 bytes, 49 enabled entries.

Completed: Train Trouble's 28 witnessed dispatcher jobs, generated fresh tracks,
cargo/coupling/repair, brake/signal/route controls, paint unlocks; separate 36-case
Trolley Trouble with seeded disclosed outcomes; three original crash movies in
MP4 and WebM; Robot Workshop's 30 lessons, three endless tiers, free building,
all-input truth checking, alternate solutions, touch/keyboard and saved undo.
Both register native menus, transactional full-state saves and shared adapters.

Verification: preflight42432891781 engines, menus and catalog/offline pass,
including229 Worker,112 transport,25 new models,147 menus,164 Home,18 short-menu/
startup checks,98 all-activity stress cases, PWA and real RTC with both new
adapters. Strict Chrome new-game group passes focused6+7 and20 consolidated
cases, including actual MP4/WebM and offline video. Its only failure was a
spectator-frozen test timer. Focused repair42433406509 passes both actual Worker
flows with Node polling, same predicates/deadlines and a gate proving unchanged
runtime. Do not call the original whole preflight green. Full detail and device
limits: docs/arcade-stress-test-2.10.0.md. No user input is required.

Do not break: trolley choices disclose facts before the decision and show direct
consequences, with no why quizzes or moral scores. Serious outcomes stay off-screen
and separate from safe-occupant crash movies. Check every input combination and
accept equivalent logic. Preserve seeds, full state, undo, private backups,
controller gates and logical clip position on restore/handoff. Use native redraw,
not generic canvas image overlays. Cached movie ranges preserve verified full
responses. Keep the 2.9.0 and earlier constraints below. Generated replay does
not promise infinitely many unique beginner truth functions.

Next action: use ProjectStatus for final publication/package facts. Reproduce any
new issue with its exact activity, mode, viewport, save and room state first.


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
