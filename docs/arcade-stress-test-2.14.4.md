# Arcade 2.14.4 reference verification

This release adds 322 original Encyclopedia articles, 1,513 unique Dictionary
headwords and 967 curated follow-up questions. The approved collection totals
1,681 articles, 4,544 headwords, 6,611 senses, 5,046 question links and 13 quizzes.

| Article batch | Articles | Follow-up links | Technical headwords |
| --- | ---: | ---: | ---: |
| All 50 U.S. states and regional geography | 85 | 256 | 10 |
| Plants and animal behaviors | 95 | 285 | 28 |
| Community jobs and public services | 83 | 249 | 18 |
| Space missions | 42 | 126 | 7 |
| Signals and inventions | 17 | 51 | 6 |

Three general vocabulary batches contribute the other 1,444 headwords.
Different reviewers read each set, checked representative original sources,
and had authors address accuracy, clarity, and link issues. All 50 state
capitals were checked against the Census Bureau table. The coverage ledger
includes 1,865 source records, with no drafts, missing terms, broken links,
ambiguous forms or answer-length warnings. Three new context flags were
reread as ordinary senses of “belief,” “setback” and “mourn.”

## Verified

- The deterministic rebuild, five lexical checks and exhaustive corpus audit
  passed, including all 5,030 search aliases and exact lookup for every
  headword. Comparing the old and new dictionary indexes found no lost
  published lookup keys. Eight keys now lead to exact entries that retain
  their former meaning alongside new meanings.
- Offline manifest `2.14.4+20261127.1` covers 553 files and 30,588,391 bytes.
  All 68 changed runtime files are reference packs. The verified reference
  payload is 5,654,439 bytes.
- Chromium 151 passed three reader viewports, 11 catalog scenarios and all 55
  Home routes. With the network cut, a fresh PWA install found Apollo 15 and
  opened the inline “lunar rover” definition. A damaged update preserved the
  earlier snapshot and bookmark before a verified retry. Android wrapper
  source verification passed.
- The 390 × 844 benchmark with 4× Chromium CPU throttling measured cold
  article and dictionary queries at about 304 ms and 129 ms, including index
  fetches from the local fixture. Across 60 subsequent queries, p95 was
  22.3 ms. Physical low-end Android and Windows acceptance remain open.
- The previous comprehensive web run stopped at a TV timing assertion. Its
  event trace showed correct playback at 0.252 s after a quality change, but
  the test later read 1.4 s after the clip ended. The assertion now checks the
  replacement source’s captured playback-start event. With a 1.75 s delay,
  the original assertion failed and the corrected one passed. All 12 TV
  browser scenarios passed with local synthetic media. TV runtime files
  match the previous release. [Prior CI job](https://github.com/to-shreds/arcade/actions/runs/46079619663/job/140775386620).

See [ProjectStatus](https://github.com/to-shreds/ProjectStatus/blob/main/projects/arcade/STATUS.md)
for production deployment, exact downloads and continuation.
