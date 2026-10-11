# Arcade 2.6.4 verification

## Changes

All 68 Mad Libs themes use exactly twelve original word prompts. The player
supplies nouns, verbs, adjectives, adverbs, names, places, and familiar word
categories such as food. Characters and plots come from the story. There are
no main character, helper, mission, solution, or reward questions.

Stories have 126-150 words with one-word answers (average 141.5), twelve short
sentences, and 18-24 blanks. Every supplied word appears. Fixed passages stay
at most fifteen words between blanks. Plot and cast remain specific to each
theme. All stories were reviewed with ordinary part-of-speech examples.

Adapter version 3 explicitly saves the story format. The real v1 and v2 story
banks remain available for completed old results, preserving their answers and
optional title. Unfinished old entries and Change Words carry the first twelve
answers into the longer story, with all original answers backed up in the save.
Story order, categories, and original prompt positions remain unchanged.
Restoring a saved/shared story no longer schedules autofocus that can steal
the cursor from the field the player is editing. Story selection focuses
the first field immediately.

The prior capitalization and browser/native narration fixes remain. No APK
rebuild is required. Adventure and TV game source is unchanged in this release.

## Verification

- Source checks passed all 68 stories: exactly twelve original prompts, every
  index used, normal labels, word/sentence/blank counts, and fixed-passage limits.
- Actual Chromium rendered all 68 stories at 1440x900, 390x844, and 320x568
  with ordinary category examples and raw marker answers. Ideas, Change Words,
  escaping, long-word wrapping, v3 saves/reloads, archived v2 completed results,
  and v1/v2 entry migration with original-answer backups passed. A regression
  checks that restoration preserves the chosen input focus and edited answer;
  intentional story selection still focuses the first word.
- Contextual capitalization checks passed ordinary words, names/places,
  sentence and quoted-reply starts, I, escaping, and raw-answer preservation.
- Actual browser narration fixtures passed browser, native-only, optional
  native callbacks, and unavailable-capability cases. Whole-story playback,
  Stop, stale callbacks, voice failures/readiness, Android top-shell pause,
  and Adventure page behavior were checked.
- Actual two-browser shared play passed create/join/pass, picking a story,
  filling words, rendering, and title/snapshot synchronization.
- Offline size/hash/import audits passed all 360 files (18,368,828 bytes).
  A fresh actual PWA download reached Offline Ready, reloaded offline, generated
  a twelve-prompt story, restored an archived completed result, and opened
  Adventure with case/speech helpers available. Home navigation passed.

Run `npm run test:mad-libs`, `npm run test:narration`,
`node tools/test-shared-lobby.mjs --case=mad-libs`, and
`node tools/test-offline-runtime.mjs` from the repository root. Generated
browser evidence stays in test-results and CI artifacts, not release archives.

## Retained baseline and limits

The full 2.6.3 CI run `38156801638` completed successfully, including the
previously repaired Tic Tac Toe and full online regression checks. This
release repeats checks relevant to changed story content, saves, shared play,
narration, and offline packaging. Exact current deployment and CI results
belong in ProjectStatus.

Speech engines in browser fixtures are controlled. Physical Android/iOS audio
output was not tested. Existing APKs have no completion callback: Adventure
reads the current page, and Stop remains available until stopped or navigation.
Normal Mad Libs stories fit within the old bridge's 2,000-character request
limit with ordinary answers. Oversized answers get the existing clear recovery
message instead of silent truncation. TV account streaming still needs the
user's TorBox account.

Refresh Arcade and update its offline copy. A completed old story deliberately
keeps its original version until Change Words or another story is selected.
