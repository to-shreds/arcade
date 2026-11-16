# Tank Tactics 2.13.4: Battlefield HUD and scored impact feedback

Source: [PR #10](https://github.com/to-shreds/arcade/pull/10), merged into main as
`98bc4dd3bb5ddff81743a61e41e66595141d0664` on November 16, 2026. All 132 original and new weapons remain
available in all modes, with the existing single-use 10-weapon inventory.

## Changes
- An overlong voluntary move is clamped to the safe battlefield edge or
  opposing tank. The move is consumed if actual travel occurs. Trying to
  move further while already blocked does not spend an allowance.
- Every damaging explosion, cluster child, beam, mine and self-hit may
  record a validated `damageHits` event. Each positive point amount
  appears above the struck tank and rises to the screen's top edge,
  individually, over approximately 2.1 seconds. The cosmetic DOM layer
  does not affect scoring, game state, or turn readiness.
- The battlefield is a full-screen stage with compact floating scores,
  controls, and status. The permanent loadout is hidden; the ordinary
  per-turn weapon picker still works. The camera considers all ground
  samples, so the actual gameplay field is proportionally fitted rather
  than horizontally cropped or stretched.

## Verification and qualifications
- Local direct simulation covered 132 distinct weapons with 330 individual
  positive scoring events, matching the authoritative score totals.
  Edge tests ended at x=45 and x=955 and at x=179 beside an opposing
  tank x=215, without invalidating saved games.
- The [combined feature-branch stress suite](https://github.com/to-shreds/arcade/actions/runs/43959852413)
  passed its focused Tanks/Upwords browser job and model/package checks.
  Dedicated Tank screenshots and real browser regression tests previously
  passed at 320x568, 390x844, 844x390, and 1280x800. The suite verifies
  edge behavior, rise animation, terrain fit, Internet/Nearby transport,
  CPU/hotseat, older saves, 132 icons, and 20-shot play.
- The [original branch stress run](https://github.com/to-shreds/arcade/actions/runs/43812774438)
  had passed all jobs before the later Comic Library and Monster Forge
  changes were merged. The combined branch was tested again.
- Separately, broad Test Arcade Web runs have shown intermittent Train
  Trouble / unrelated TV failures; do not describe all unrelated full
  project tests as green without checking their exact final outcomes.
- Physical Android tablets remain untested for frame rate and touch comfort.

## Safety and continuation
The 84 original weapon IDs, scoring rules, deterministic terrain,
knockback physics, four deliberate moves, saved match identities, and
multiplayer Worker authority remain intact. Old saves without `damageHits`
remain valid. The latest Comic Library CBZ picker fix and Monster Forge
expanded parts are preserved. The 2.13.4 offline manifest must include
all 437 runtime entries and match their individual SHA-256 hashes.
