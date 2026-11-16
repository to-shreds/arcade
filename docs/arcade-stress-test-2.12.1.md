# Tank Tactics 2.12.1: Impact knockback, universal arsenal, precision input

## Scope

Release source: `to-shreds/arcade` PR #8, main merge
`0368c43a38a03ee7626234332a1ba34dac087892`.
Offline snapshot `2.12.1+20261115.1`: 420 runtime files,
23,099,181 bytes, each tracked by SHA-256 in `offline-manifest.json`.
50 enabled Arcade activities are retained.

The old weapon-pool preference and setup selector are removed. All new
matches use the full 132-weapon roster, randomly dealing 10 different
single-use weapons to each player. Existing saved matches keep their
inventories. The player's normal shot selection still works.
Precise angle, power and move-distance arrow steppers have limits of
0-180 degrees, 1-100 percent and 1-5 tank lengths respectively.

Strong hits now move the target tank in the authoritative simulation.
Small hits may produce visual impact without displacement. Knockback is
family-dependent, bounded to 75 world units, clamped against both game
edges and the other tank, settled onto the terrain and stored in
per-impact effect `pushes`. Temporary hop and tilt are display-only;
the final horizontal position affects subsequent turns. Player movement
allowances are unchanged. Mine detonations during voluntary movement
record both intended destination and actual final position.

## Verification

- Direct deterministic JS checks on all 132 weapons showed 55 knockback
  events, no invalid save states or crossed tank positions, with a
  cannonball hit moving a target from x210 to x243 and producing a
  27.44-unit temporary hop. A mine-triggered move from x130 toward
  x210 settled at x146, preserving the player's movement counter.
- CI tank engine tests, saved-game backwards compatibility tests, and
  worker model tests passed on PR #8.
- [Project stress preflight run 43799933209](https://github.com/to-shreds/arcade/actions/runs/43799933209):
  focused Tanks/Upwords browser group passed, including actual browser
  local play and CPU, real Internet and Nearby peer interactions,
  deterministic 20-shot gameplay, weapon graphics, terrain animation
  and reloads. Its new `tanks-impact/report.json` records five
  successful control/knockback checks with no JS exceptions.
- Browser screenshots at 320x568, 390x844, 844x390 and 1280x800
  were captured for the new controls. Inspection showed legible
  arrows beside all three sliders without horizontal clipping.
- CI model/package, Nearby, Heist and stories/TV subgroups passed.
  Other broader groups and the consolidated full Arcade workflow
  should be checked separately for definitive overall CI status.
- GitHub Pages deployment
  [43800413593](https://github.com/to-shreds/arcade/actions/runs/43800413593)
  and multiplayer Worker deployment
  [43800414181](https://github.com/to-shreds/arcade/actions/runs/43800414181)
  succeeded after the merge.

## Limitations and do-not-break constraints

The visual hop is a bounded interpolation, not a full rigid-body physics
solver. Deep caves and tank collisions are not physically simulated.
The game's deterministic height map and scoring rules remain authoritative.
Real mobile Android hardware, particularly inexpensive tablets, was not
available for physical performance testing. Pre-existing Train Trouble
offline-video CI instability is unrelated to the Tank modifications
unless a specific new failure proves otherwise.

The offline ZIP is packaged by `tools/package-web-release.py`, which
verifies every manifest asset hash, and includes the README, changelog,
source handoff and this report.
