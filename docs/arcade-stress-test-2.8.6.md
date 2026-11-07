# Arcade 2.8.6 verification

## Scope

Typing gains font family and size controls, native selection, Select All and
Copy. Face Lab gains a size button instead of a slider. The release retains
all verified 2.8.5 menu, clock and Young Kid Trivia fixes.

## Actual checks

- `tools/test-typing-tools-browser.mjs` passes at 320x568, 390x844, 844x390
  and 1440x900. It checks every font/size option, actual partial mouse selection,
  selected/all copying, Ctrl+A/C, repeated/reversed Shift selection, Home/End,
  collapsed selection, selection replacement, composition exclusions, emoji
  editing, exact saves/cursor and font preferences across reload.
- Modern clipboard, fallback and denied-copy fixtures pass. Failure does not
  claim a successful copy, and the source text, focus and selection survive.
- The real two-browser shared Typing flow passes local observer controls,
  checkpoint exclusion, unchanged authoritative text/cursor, private document
  restoration and preference persistence after room leave/reload. The native
  partial-selection pointer guard for observers is unchanged; local Select All
  and Copy remain available.
- `tools/test-face-size-browser.mjs` passes all six scenarios: four viewport
  layouts with keyboard/actual touch, exact older saved sizes, full size range
  and wrap, undo, stickers and native reload; actual pinch and undo; actual
  Worker controller/observer size changes, canvas display, blocked observer
  mutation, handoff and exact local restoration.
- New screenshots were visually reviewed at 320x568 and 844x390. The local
  test Chromium lacks some emoji glyphs, a previously recorded environment
  limit; the controls and geometry are verified and existing emoji content is
  unchanged.
- Existing `tools/test-local-ui-browser.mjs` passes the original Typing input,
  cursor, emoji and autosave checks plus the existing other activity UI checks.
- Native keyboard and persistent Home-route source audits pass all 47 entries.
- Independent source review reproduced and verified the fix for a newly added
  Shift-selection range bug. No further material defect was found in the new
  controls, saves, clipboard failure handling or shared authority.

## Home navigation regression

The 2.8.5 post-push CI passed 154 of 156 Home cases, but two direct-page checks
reported an aborted navigation. Official Chromium navigation events confirmed
that both pages assigned the same index URL twice before displaying Arcade.
The default multiplayer bridge contract is retained, and ArcadeSave now probes
only the bridge before choosing its own parent/native/direct fallback.
The strict final URL and visible Arcade audit remain in place, with exactly one
main-frame navigation required. All 112 transport/shell checks pass, including
33 bridge checks covering the direct, parent, native and authenticated routes. ProjectStatus
records the final direct/native/parent regression and full Home audit results.
The earlier 2.8.5 CI failure is not described as an all-green broad run.

## Packaged release and limits

The final offline manifest and ZIP are checked for all runtime sizes/hashes,
ZIP CRC and archived runtime content. Source and focused browser checks are
complete before committing. Pages publication, live HTTPS hash comparisons,
the exact artifact and any still-running supplementary broad CI are recorded
in ProjectStatus. No physical Android/iOS or operating-system clipboard paste
verification is claimed. Speech limitations remain those documented for 2.8.5.
