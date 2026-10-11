# Arcade 2.6.3 verification

## Changes

Mad Libs formats rendered answers in sentence context. Ordinary words and
phrases are lowercase within sentences; names and places retain spelling,
character descriptions follow ordinary case, and I stays capitalized.
Sentence starts and quoted replies after a comma/colon are capitalized.
Raw inputs and saved answers are preserved; formatting happens before escaping.

Both story activities now share `arcade-speech.js`. It uses the Android app's
existing native speech bridge when present, otherwise browser speech synthesis.
Browser requests use short chunks with retained utterances and real completion
events; cancellation invalidates stale callbacks. Stop, screen changes,
Home/pause and hidden documents stop narration. A missing native voice gets
a bounded initialization check rather than an indefinitely queued request.

The prior 2.6.2 CI failure was in a Tic Tac Toe test waiting on a transient
winning board after both clients had already correctly started the next round.
Retained failure evidence showed identical version 9 empty boards and score
1-0. The test now checks that transient state through strict recorded winning
version/board/score assertions, then checks the next round and reconnect.
No game runtime was changed for that repair.

## Passed targeted verification

- Mad Libs case unit checks cover ordinary values, multiword names/places,
  character descriptions, I, sentence and quoted-reply starts, escaping and
  exact raw-answer preservation.
- Actual Chromium rendered all 68 stories at 1440x900, 390x844 and 320x568.
  Contextual capitalization, Change Words, Ideas, Fill Empty, safe rendering,
  long input wrapping, actual saved reloads and legacy save migration passed.
- The speech fixture suite runs actual browser pages with controlled browser,
  native-only and optional callback engines. Whole-story/browser chunking,
  Adventure page advancement, current-page legacy playback, stale completions,
  Stop, shell pause, page exit, missing voices and voice readiness passed.
- Adventure source/save models passed, including 5,000 complete routes covering
  all scenes/endings. Four viewport routes, narration lifecycle and the actual
  save/reload/history/storage/corruption browser suites passed.
- Family integration passed Adventure shell navigation and retained TV playback,
  queue, fullscreen/autoplay fallback and encrypted-vault fixtures.
- Native keyboard, Home routing and unchanged Android wrapper source audits
  passed. The complete offline manifest passed every size/hash/import audit.
- The repaired Tic Tac Toe test passed real two-browser Worker-backed winning,
  next-round score and reload checks. The full online regression then passed
  42/42 activities across desktop/mobile browsers with no page errors.
- A fresh actual PWA download reached Offline Ready, reloaded offline, and
  opened both story activities with their new speech/case helpers available.
  An earlier PWA attempt overlapped helper/manifest edits and timed out; the
  frozen-release audit and fresh download passed.

Run `npm run test:mad-libs`, `npm run test:narration`, `npm run test:family`,
`node tools/test-shell-browser.mjs`, `node tools/test-offline-runtime.mjs`,
and `node tools/test-online-browser.mjs` from the repository root. Generated
browser evidence stays in test-results and CI artifacts, not release archives.

## Compatibility limits

This is a web release, with no APK rebuild or new native ABI dependency.
Existing APKs provide no speech-completion event: Adventure reads the current
page, and Stop remains available until tapped or navigation. Normal Mad Libs
stories are sent in one native request. The existing native request limit is
2,000 characters; a longer story gets a clear shorten/open-browser message
instead of silent truncation. Optional callback-bridge support is covered by
fixtures but is not claimed as a new released APK feature.

No physical Android/iOS audio output was tested. Speech fixtures verify code
and lifecycle, not installed device voices. TV uses controlled account/media
fixtures; real TorBox playback still needs the user's account. Exact current
publication and CI state belong in ProjectStatus.
