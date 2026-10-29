# Arcade 2.8.0 verification

## Scope

Upwords adds a 10x10 stacking word game, 127,350-word offline Arcade English
dictionary, computer and pass-and-play modes, and authoritative Internet/Nearby
rooms with private racks. Existing game code, saves and transport behavior are
preserved. The enabled catalog has 47 activities.

## Verified rules, data and authority

- Sixteen engine tests cover independent rule/scoring examples, stacks,
  crosswords, Qu, seven-tile bonuses, plurals, exchanges, passes and deductions.
- Nine client lifecycle tests cover saved-draft privacy, pending entry and Home,
  CPU cancellation, restored local state, and delayed network acknowledgments.
- Seven dictionary tests verify content, ordering, hashes, legal shapes and
  exact plural metadata. The complete Upwords suite passed 32 checks.
- Six full deterministic CPU matches conserve all 100 tiles at every turn and
  restore exactly from serialized saves. Both ending conditions occur.
- The Worker and authority suite passed 207 checks, including nine new Upwords
  checks for private responses, HTTP/WebSocket recovery, forged/stale intents,
  simultaneous requests, authoritative scores, rematches and Nearby checkpoints.
- Dictionary generation is pinned and reproducible; word count, ordering,
  uniqueness, content hash, lexical constraints and inflection metadata checked.
- Native-keyboard and persistent-shell Home audits pass for all 47 activities.
- All 109 shared multiplayer transport checks pass.
- The production Worker build passes Wrangler's deployment dry run.

## Real browser preflight

All steps passed in [preflight run 40965998912](https://github.com/to-shreds/arcade/actions/runs/40965998912).
Tested source: `3f66791c43677902db53089a485c1a25639bf2a5`.
The final promotion changes only this report and `HANDOFF.md`; every runtime
file is unchanged from the verified source.

- All nine Upwords browser scenarios passed with no JavaScript errors. Real
  rack and board clicks verify word checking, invalid previews, Undo/Clear,
  shuffle, native IndexedDB save/reload, exact draft restoration, concealed
  handoffs, a scored stacking move, computer turns, exchanges and end deductions.
- Desktop 1440x900, portrait 390x844 and 320x568, and landscape 844x390 passed
  layout, keyboard and zoom checks. Captured screenshots were visually reviewed.
- Two Internet clients used the real Worker/Durable Object fixture. They
  received only their own racks, agreed on turns and scores, reconnected,
  resumed after native reload and restored their separate local draft on exit.
- Two real Nearby RTC peers played four turns with public networking disabled.
  Private rack delivery and synchronized authority state passed. This case was
  executed successfully, not marked blocked or skipped.
- All 11 catalog browser scenarios passed. The existing persistent shell passed
  at all four sizes, including launch, Back/Forward, Home, settings and Escape.
- The browser downloaded a complete verified offline snapshot and reloaded it
  offline, including catalog tiles, shared scripts, Paint, recent history and
  search. Snapshot `2.8.0+20261029.1` has 386 files and 20,094,063 bytes; every
  runtime hash passed.

The first preflight exposed a test timing race: its handoff assertion checked
the new model before the deliberately awaited native save and screen render
finished. The corrected test waits for that completion, retaining all privacy
and exact-turn assertions. No runtime behavior was changed for that correction.

Before preflight, client review also fixed concealed restored drafts, delayed
acknowledgments after newer room revisions, stale move dialogs, and canceled
network entry. Focused client regression tests cover those boundaries.

## Publication and practical limits

The previous whole-Arcade run for 2.7.3, [38405115418](https://github.com/to-shreds/arcade/actions/runs/38405115418),
completed successfully before this release. The canonical ProjectStatus entry
records the final 2.8.0 main commit, Pages and Worker deployments, downloadable
archive, and supplementary whole-Arcade run. Do not infer publication from
the version number alone.

The managed local environment could not download Chromium or expose its
localhost to the separate browser. Served-browser verification therefore ran
in GitHub Actions. No physical Android/iOS hardware test is claimed.
