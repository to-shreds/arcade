# Tank Tactics 2.7.3: weapon/terrain correspondence

## Diagnosis

The 2.7.2 engine sent most weapons through one crater-size formula. Long carvers
divided their depth by their step count, single-charge drills produced two blasts,
and burrows made disconnected holes. The renderer inferred reveal times from a
shot's weapon and nearby effect radii, revealing the final composite terrain too
early and using the wrong profile for older mines. Burst/cluster shells and
lightning branches also resolved whole trajectories/chains out of time order.

## Implemented

Explicit width/depth/shape profiles, nonstacking reference-surface channels,
continuous tunnels, actual declared carver depth, bore-before-charge drills,
cutting-beam penetration, separate surface heat/electricity, distinct building
shapes and mine-owned profiles. Exact bounded terrain patches attach to the
effect that caused them. Concurrent flight generators and chronological lightning
resolution keep simulation and playback consistent. Same-scale profile sketches
and clear descriptions explain terrain behavior in the picker.

No changes to weapon IDs, damage budgets, game schema, twenty-shot rules,
monotonic points, four moves, landscape preferences or transport authority.
Optional trace/mine fields are backward compatible. Height-map tunnels collapse
into open trenches; no enclosed-cavity simulation is claimed.

## Local verification

`tanks/terrain.test.mjs`: 1,764 weapon/terrain/aim combinations, 15 complete CPU
matches, every animation endpoint compared to authoritative saved terrain, no
terrain change before first contact, meaningful depth/shape assertions, beam
obstruction/penetration, mine planting/detonation/movement, malformed patch
rejection, all 84 summaries/previews and a genuine 2.7.2 eight-shot save fixture.
All twelve terrain-specific tests passed, including the legacy fixture.
Largest sweep save was 22,173 bytes; the largest complete-match save was 22,573 bytes, both below the 44,000-byte test limit.

Managed Chromium blocks navigations, including localhost. Local visual review
therefore used the actual shipped modules via inline import maps with a named
in-memory storage fixture, not native persistence or live multiplayer. It
exercised five layouts, the picker and 672 Canvas2D frames across all 84 weapons,
with no page errors. Real served-browser and network verification was then performed in CI,
as detailed below. Production deployment status is recorded in ProjectStatus.

## Retained integration checks

Existing Worker/authority, transport, Tanks engine/polish, native-save browser,
two-client Internet, real offline Nearby, globe, Home, keyboard and complete
runtime hash checks remain enabled. The artwork uniqueness selector explicitly
excludes terrain sketches; the 84 original drawings are still checked separately.
The new browser suite tests actual served modules, profile selection, native
save/reload and renderer traces without replacing the transport implementation.

## Completed preflight

Run https://github.com/to-shreds/arcade/actions/runs/38404322439, job
115319809112, passed every step on 2026-10-13. The runner committed the tested
source as `b3b7d76ee419708101d1c5787e8eb19782242c9b`, tree
`1cc1fb8cbf7697b1c4442c93e9d54100f8df0c63`.

Passing checks: 198 Worker/authority tests, 109 transport/shell tests and all 31
Tanks engine/polish/terrain tests. Real served Chromium passed full local
matches, computer turns, two-client Internet rooms against the Worker,
reconnect/resume, real offline Nearby Tanks transport, and the standalone WebRTC
pairing/control-transfer suite. Native saved-game reload, landscape fallbacks,
84 distinct weapon drawings and the draggable globe passed.

The new served-browser suite passed controlled shots for all 14 weapon families,
exact animation endpoints, production-adapter/native reload, same-scale terrain
previews, arsenal search and six phone/desktop layouts. It does not replace
actual network transports with mocks.

Two test-fixture defects were corrected without changing unrelated game code:
the query "road" also matches "broad", so the one-result check now searches for
"road grader"; the globe resize test now waits for its saved normalized position
before attempting the next drag, rather than targeting coordinates while resize
handlers are still pending. All original drag/keyboard/bounds assertions remain.

The preflight verified all 374 runtime files (18,567,179 bytes) and manifest
SHA-256 `a3536f23e91999926c460766ce2da6e9f8407042f64caa03dbc8d460cb973287`.
Promotion removes only the three preparation files and finalizes this report;
no untested runtime changes are substituted. Deployment and the supplementary
whole-Arcade rerun are recorded in ProjectStatus. Physical phones, physical
Nearby radios and a production-endpoint multiplayer match were not tested.
