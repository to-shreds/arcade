# Tank Tactics 2.13.6: Arc-only launches and slower floating scores

## Source and scope

PR #15 merged into `to-shreds/arcade` main as
`157e70d757e42e40122b794d2d223b85270b8382`, preserving
the current Comic Library 2.13.5 large-book support and Monster Forge.

The arsenal retains all 132 original IDs and 14 mechanism families.
The 12 energy/beam-family weapons no longer fire instant, straight
line-of-sight rays. Each launches a visible, gravity-controlled
projectile. Previously stored `beam` IDs remain available and
distinguish the family; reach influences launch speed, while angle
and power use the same ballistics as other weapons. The old ray
graphics are replaced by glowing moving shells and post-impact
sparks. Cutting Ray cuts its special trench only after its shell
lands. Secondary rollers, electrical aftershocks and underground
cutting effects can still travel along the surface after the
initial shell follows its arc.

The actual aiming dots and CPU aim predictor use the new energy
flight speed and gravity. No browser-only trajectory trick
changes the authoritative engine physics.

Each floating individual scoring number takes 8.4 seconds to
reach the upper screen area and fade, rather than 2.1 seconds.
Numbers continue moving across turn boundaries and are limited to
64 simultaneous DOM elements. Reduced-motion treatment remains
a brief, stationary 1.1-second number.

## Verification

- Local deterministic sweep: 660 shots spanning all 132 weapons,
  five aiming scenarios per weapon, with exact terrain replay,
  deterministic state, valid checkpoints and size below the Nearby
  transfer limit.
- Separate arcing test: for every one of the 12 beam-family weapons,
  a 45-degree, 30-percent shot recorded more than eight distinct
  projectile points and a strongly bowed path, with no instant
  beam event; energy effects occurred only after landing.
- The arcing Cutting Ray continued to produce a longer trench
  than Laser Pencil and preserved chronological ground playback.
  Hard CPU targeting used real arced shots.
- The focused Tank/Upwords browser test in
  [project stress run 43966149573](https://github.com/to-shreds/arcade/actions/runs/43966149573)
  passed. It covered mobile and desktop viewports, 132 icons,
  real hotseat/CPU/Internet/Nearby play, old save restore,
  visual arcing shots, per-hit score floats, and full 20-shot
  games. The model/package and Nearby jobs also passed.
- [Project web CI 43966149444](https://github.com/to-shreds/arcade/actions/runs/43966149444)
  contains the broader full Arcade tests; its final result is
  independent of the focused Tank checks. Do not represent any
  unrelated failure as a Tank-specific regression without evidence.

## Constraints and open verification

Older shot traces with straight `beam` segments remain accepted for
saved-game compatibility. New shots do not emit these rays.
The shooting model remains authoritative on the server for
Internet/Nearby rooms. Original damage totals, points scoring,
knockback, world boundaries, tank movement allowances, weapon IDs,
terrain replay and save schema remain stable except for the
intentional change to energy-weapon trajectories.

Physical performance on low-end Android tablets has not been
directly tested. Preserving render smoothness with long-lived
score labels requires retaining the 64-element display cap.

The portable web ZIP is produced by the verified GitHub Actions
release workflow, which checks `offline-manifest.json` sizes and
SHA-256 hashes for every runtime file. The exact release provenance
and Library copy are recorded separately in ProjectStatus.
