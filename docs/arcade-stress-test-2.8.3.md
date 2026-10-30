# Arcade 2.8.3 verification

## Scope

Upwords allocates a fixed feedback frame above its action row. Preview text and
independent notifications share that bounded frame, so they cannot move or
resize the board. The end-of-game result overlays the board instead of adding
a row. Existing compact controls and near-full-width portrait boards remain.
At a fixed viewport, the board's x/y, width and height stay constant through
placement, invalid/valid previews, undo, clear, rejected drops and end results.
Long feedback can scroll inside the frame without moving the game surface.

Drag painting, hover and release use the same tile-center function. Touch
places the visible tile above the finger and uses that visible center as the
target. Mouse/pen center the tile on the pointer. Private draft behavior,
physical rack indices, saved games, dictionary and authority intents remain.

## Verification

- All 40 Upwords checks passed, including a regression where the visible touch
  tile and the hidden finger point lie over different board squares. Both the
  hover highlight and release use the visible tile's square.
- Browser checks measure the real board rectangle before and after taps,
  drags, errors, valid scores, undo and clear at five viewport sizes.
- Mouse and native touch gestures are driven by the observed ghost position,
  rather than duplicating an implementation offset. The ghost's painted
  center must reach the intended square, that square must be highlighted,
  and the resulting draft must use it. The finger occupies a different square.
- Native keyboard and Home routing audits passed for all 47 activities.
- Every offline runtime file size and SHA-256 hash passed.

All 12 actual Chromium scenarios passed with no JavaScript errors in
https://github.com/to-shreds/arcade/actions/runs/40998771225 on

dfa93ffec01ca729d7a2619101c341b0ab38d922. The final promotion changes only
documentation and removes the temporary workflow; runtime is identical.
All 208 Worker/model/client checks also passed. Existing save/reload, CPU,
private Internet rooms, reconnect, and real offline Nearby RTC checks passed.
Screenshots at all five sizes, the scored touch draft and ending overlay were
visually reviewed. Spatial reads wait for completed browser input/paint frames.
No physical Android/iOS or pen hardware test is claimed. Publication details
are recorded in ProjectStatus.

## Broader baseline

The previous 2.8.2 whole-Arcade run 40993738390 passed Nearby but stopped in the
broad browser stage on an Orb Slicer projectile-wait timeout. Its dedicated
Upwords preflight passed. Orb Slicer source is unchanged by this release;
this report does not count that broader run as a pass or assert that timeout
is resolved. Review the new main run before the next project change.
