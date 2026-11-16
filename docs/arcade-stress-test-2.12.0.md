# Arcade 2.12.0: Tank Tactics weapon and rendering expansion

## Scope and source
The 2.12.0 release merges PR #7 to `to-shreds/arcade` main as
`e89c35d4ad8d185148c1b19a3c3a4b09e4cef2a5`.
The previously working Arcade remains intact: 50 enabled activities,
Retro Vault, shared saves and Internet/Nearby rooms. The offline runtime
is `2.12.0+20261115.1`, with 420 files and 23,090,029 bytes.

Tank Tactics increases from 84 to 132 weapons in 14 deterministic
mechanisms. All 132 participate in new default and online games. The
48 additions have eight familiar kid-oriented themes, visual identities
and individual terrain parameters. Twenty-six originals receive playful
display names and effects without changing saved IDs or original mechanics.
The original 84-only and weighted extra-silly options are local-only.
The Test Range simulates practice shots without altering real saves.

## Verification observed
- Original 84 plus 48 additions: 132 unique IDs and 132 SVG artwork
  compositions checked, with no missing IDs or duplicate geometries.
- Direct module checks: 264 shots spanning all 132 weapon definitions,
  528 rendering samples (four per weapon), exact chronological terrain
  playback, deterministic actions, bounded saves, and all three local
  arsenal mixes passed.
- GitHub Actions project-stress preflight
  [43792746365](https://github.com/to-shreds/arcade/actions/runs/43792746365):
  Tanks/Upwords browser group passed after correcting two assumptions in
  existing display-name tests. That group checks real Internet/Nearby
  multiplayer, saved-game reloads, CPU/hotseat, landscape, ammunition
  display, terrain cut previews, and the Test Range.
- The same preflight passed model and offline package checks, menus/tools,
  shared/competitive rooms, stories/TV and Bug Squish. The separate
  Retro Vault and Guess Who browser workflows passed.
- Consolidated web suite
  [43792746309](https://github.com/to-shreds/arcade/actions/runs/43792746309)
  passed its Worker, Tank engine, other models and hash-verified package
  checks. Its initial attempt failed on a *Train Trouble* PWA
  `navigator.onLine` assertion following Playwright offline emulation.
  All earlier Train dispatcher, video-format and real-Worker tests passed.
  This is a separate test result and is not a proved Tank defect.
  A re-run was requested; treat that run as not fully green unless its
  final attempt succeeds.
- Production deployment: GitHub Pages
  [43793967953](https://github.com/to-shreds/arcade/actions/runs/43793967953)
  and the Arcade Worker
  [43793968401](https://github.com/to-shreds/arcade/actions/runs/43793968401)
  succeeded on the merged source.

## Limits and next verification
A real-browser screenshot set for the dedicated Tank browser run was
reviewed at portrait and landscape sizes, with no observed clipping.
The emulator/desktop tests do not establish performance or sound fidelity
on any specific inexpensive Android tablet. The long full-catalog
preflight group and the consolidated web rerun may finish separately.
If either is unsuccessful, report the exact failure without describing
an untested part as passed.

The 2.12.0 ZIP is created using `tools/package-web-release.py`, which
verifies every runtime file's SHA-256 and includes the manifest,
release instructions, changelog and this report.
