# Arcade 2.8.0 verification

## Scope

Upwords adds a 10x10 stacking word game, 127,350-word offline Arcade English
dictionary, computer and pass-and-play modes, and authoritative Internet/Nearby
rooms with private racks. Existing game code, saves and transport behavior are
preserved. The enabled catalog has 47 activities.

## Verified before browser preflight

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

## Pending preflight

Real browser gameplay, native browser saves/reload, mobile layouts, private
two-client rooms and actual Nearby RTC must pass the dedicated preflight before
publication. Local Chromium downloads returned an unavailable-site document
instead of a browser archive. The separate managed browser cannot reach this
executor's localhost. Neither limitation is counted as a passed browser check.

No physical Android/iOS device test is claimed. Final per-commit CI and deployment
results will be recorded here and in ProjectStatus after verification.
