# Arcade 2.6.2 verification

This release completes the previously unfinished Mad Libs request. The
published 2.6.1 Adventure and TV implementation is preserved. Its full web and
Nearby CI run [37845326148](https://github.com/to-shreds/arcade/actions/runs/37845326148)
has now completed successfully; its earlier pending status is resolved.

## Story review

All 68 existing themes were rewritten around shorter, more familiar plots.
School, food, outings, parties, chores and games give the favorite-character
and fantasy stories ordinary goals. Each story uses all 18 answers, including
six new choices for the cast, goal, fix, reward and closing remark. There is
no sentence without a blank and no fixed run longer than seven whitespace
tokens. Aggregate fixed tokens dropped from 6,559 to 2,263, approximately 65.5%.
These counts remove placeholder tokens before splitting on whitespace; they
include standalone punctuation and are not rendered reading-word counts.

Original theme order, titles, categories and the first twelve prompt positions
were compared directly with the prior commit and are identical. Contextual
Ideas and hints make the added phrase answers easy to use. Full-story editing
was omitted following the user's clarification. A title remains optional.

## Passed checks

- Source validation covers all 68 templates, every prompt reference, short
  fixed passages, every-sentence variable coverage and inline script syntax.
- Actual Chromium rendering at 1440x900, 390x844 and 320x568 covered every
  answer in every story, then changed the goal and regenerated the output.
- Ideas, Fill Empty preserving existing words, escaped markup, 100-character
  titles and 120-character answers, and narrow-screen wrapping passed.
- Version 2 autosaves restored exact answers, screen and title after a real
  navigation. A stored version 1 entry was loaded through the actual ArcadeSave
  bridge; its twelve answers stayed in place and new word-entry fields were empty.
- Two actual Worker-backed browsers created and joined a room from the initial
  picker, passed controls, chose a story, shared answers and the custom title,
  and rendered the same result with no page errors.
- The complete offline manifest was checked against every file's size and hash.
  A downloaded PWA was placed offline, reloaded, and played both Adventure and
  Mad Libs, including story generation and Home navigation.
- Retained Adventure/TV checks passed: 23 source/model checks, four full
  Adventure viewport routes, ten progress-save browser checks, and the family
  integration flows for Adventure, TV playback/next-episode fixtures and vault
  behavior. Native keyboard, shell navigation and Android source audits passed.

Reproducible commands are in package.json and each activity's README. Browser
evidence is written under test-results and retained by CI. CI runs the new
Mad Libs checks in addition to its existing suite.

## Limits

TV was tested with controlled metadata and real browser video fixtures, not a
real TorBox account; no API key was supplied. No physical Android/iOS hardware
was tested, and existing APKs were not rebuilt. Downloads contain the current
web release. Exact publication and current CI results belong in ProjectStatus.
