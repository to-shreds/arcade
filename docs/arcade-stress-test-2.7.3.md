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
The first completed run passed 11 tests; the legacy fixture adds a twelfth.
Largest sweep save was 22,173 bytes, below the 44,000-byte test limit.

Managed Chromium blocks navigations, including localhost. Local visual review
therefore used the actual shipped modules via inline import maps with a named
in-memory storage fixture, not native persistence or live multiplayer. It
exercised five layouts, the picker and 672 Canvas2D frames across all 84 weapons,
with no page errors. Real served-browser and network verification is required in
CI before promotion. Its exact result is recorded in ProjectStatus.

## Retained integration checks

Existing Worker/authority, transport, Tanks engine/polish, native-save browser,
two-client Internet, real offline Nearby, globe, Home, keyboard and complete
runtime hash checks remain enabled. The artwork uniqueness selector explicitly
excludes terrain sketches; the 84 original drawings are still checked separately.
The new browser suite tests actual served modules, profile selection, native
save/reload and renderer traces without replacing the transport implementation.
