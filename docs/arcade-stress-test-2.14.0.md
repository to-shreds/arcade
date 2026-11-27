# Arcade 2.14.0 preview verification

## Approved reference collection

The approved records are 127 original articles across 26 published subject areas, 271 headwords, 405 senses, 382 in-library follow-up questions and 13 quizzes. The editorial register contains 244 source records. Three independently reviewed article batches cover natural science, people and cultures, and body systems, math, computing and machines. The dictionary's 219 core words and 52 domain words were reviewed separately from authorship. Reviewers checked prose, claim fidelity, school-age readability, examples, and the six context flags involving historical war, extinction and related terms. Source URLs, publisher, scope and reuse basis are in the repository's editorial records. No source links are included in the child reader packs.

- Deterministic pack rebuild, five engine tests, and an independent runtime read of every approved article, 417 aliases, 382 question links, 271 words, every marked word and all sense content passed. No dangling links or marked term gaps.
- Chromium passed at 1280×800 with mouse and keyboard, 320×568 and 844×390 with touch and an Android speech bridge fixture. Exercises included search, typo and inflection lookup, unrelated and protective queries, inline and standalone definitions, bookmarking, pagination and scroll restoration, quizzes, Home, installed local speech selection and Stop. The browser check saw zero requests to an outside origin. Actual installed voices and the Android bridge on physical devices are still to be tested.
- The fresh PWA install and network cut passed for both reference pages and Mouse Lab. A separate real Chromium run replaced a pack with corrupt bytes of the correct length. The updater rejected it, retained the prior snapshot and a real user bookmark, then installed a verified retry. Offline article definitions worked after the retry.
- The runtime snapshot contains 508 verified files and 25,357,086 bytes. Reference modules and packs contribute 423,139 bytes. Editorial records, external links and native wrapper files are outside the web runtime archive.
- Warm Node v24.22.3 pilot timings are for lexical matching after the index is loaded. A pass through 417 curated aliases measured p95 under 1 ms. After bounding fuzzy edit distance and ending scans when no candidates can match, a separate 25,000-token synthetic five-token miss benchmark measured 37.8 ms median and 112.2 ms maximum across 20 runs. It excludes browsing, storage and rendering and does not forecast timings for the expanded collection or older tablets.

## Mouse and Windows

Mouse Lab's ten desktop exercises, actual touch tap, drag, trace, scroll and hold, keyboard alternatives, narrow portrait, short landscape, reset, reload, storage rejection and cold offline launch passed. Minesweeper's right-click flagging, drag cancel, primary mouse and touch interactions passed. The [per-activity mouse audit](arcade-mouse-audit.md) documents 52 baseline entries, 178 mouse action probes and 36 save reloads, plus focused tests where applicable. The audit is incomplete for full gameplay and native Windows input.

The Windows 11 x64 preview cross-built and published cleanly with .NET SDK 10.0.404. The native loader supports 19 vetted activities and its embedded snapshot matched the source snapshot hash. The 139 portable policy, archive and authentication assertions passed. A Chromium test replayed the wrapper policy and startup restrictions for all 19 activities and dictionary lookup with standalone Dictionary revoked. The Windows runner built the package and passed 21 real WebView2 assertions covering the local launcher, storage, both reference indices, and denial of unauthorized resource requests, bridges, file-picker access, navigation and revoked activities. Physical password prompts, OS recovery, DPI, multiple monitors and sleep/resume still need desktop testing. [Windows run 46065132360](https://github.com/to-shreds/arcade/actions/runs/46065132360).

## Regression comparison

The detached main baseline at `f37d6c1f84391df920fddd14030f1f9daf31546a` passed all 21 Train/Robot browser scenarios and both stress modes for all 52 entries with the local Chromium. Remote baseline runs 43967453373 and 43966149444 had failed when the offline badge was ready but `navigator.onLine` was still true at the test assertion. Stress run 43966149573 hit a six-second Monster Dentist timeout. No baseline test was relaxed. Run any failed assertion against the exact detached main and feature heads before assigning a regression.

On the feature source, 232 transport, game, and Comic Library model checks, 229 Worker tests, 11 catalog scenarios across four sizes, existing narration checks, offline runtime verification, Android source verification, and Home routing for all 55 enabled entries passed. For the latest broad test and artifact results, see the root handoff and ProjectStatus.

A concurrent feature stress run passed 109 of 110 cases. Its Picnic Heist
heading/setup wait timed out at six seconds. The isolated repeat/rotate/save
and denied-storage retry passed, and the dedicated Picnic Heist suite passed
all seven browser scenarios. The sequential full rerun passed 110 of 110 cases for 55 activities. The focused Tank impact and 160 MiB-plus CBZ
browser checks passed. No test thresholds were edited.

The first Windows workflow reached snapshot preparation and rejected a
checkout with CRLF-converted resource bytes. A follow-up keeps Git's
checkout byte-identical and normalizes path separators in the pack checker.
The corrective Windows run succeeded. The downloadable Windows preview includes the appropriate .NET and
WebView2 notices and matches the embedded snapshot SHA-256.
