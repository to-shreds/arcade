# Arcade 2.14.2 reference verification

The release adds 218 original articles, 1,388 unique dictionary headwords and
655 curated questions. The approved collection totals 1,224 articles across
42 subjects, 2,168 headwords, 3,328 senses, 3,674 follow-up links and 13 quizzes.

| Article batch | Articles | Follow-up links | New technical headwords |
| --- | ---: | ---: | ---: |
| Habitats and wildlife | 67 | 202 | 37 |
| Everyday mechanisms and transportation | 56 | 168 | 18 |
| Places and communities | 62 | 186 | 12 |
| Math in action | 33 | 99 | 17 |

Three everyday vocabulary batches add 1,236 headwords. A school and story
phrases batch adds 68. The source register includes 1,290 records. Each batch
had a separate review of prose, major claims, common senses, examples and
links. Reviewers checked representative original sources and authors applied
targeted corrections. The final corpus has no pending drafts, unknown question
targets, missing marked terms, length warnings or ambiguous word forms. The
new contextual flags identify ordinary dictionary senses for “bite,” “ghost”
and “treat.” Their examples were reviewed in context.

## Verified packaging and reading

- The clean corpus rebuild matched the checked-in generated files. Manifest
  `2.14.2+20261127.1` verified all 536 files and 28,412,941 bytes. The content
  update changes only reference packs within the runtime payload. Reference
  assets total 3,478,989 bytes, including a 1,004,617-byte article index and
  a 579,275-byte word index.
- Five lexical tests, the exhaustive corpus audit, and 3,552 search aliases
  passed. The audit verifies every approved word and sense, article, linked
  question and marked term. A scratch draft reproduced a bug that hid “feet”
  from direct lookup. The corrected builder preserves “feet” → “foot” in
  the approved release and still flags ambiguity in a deliberate draft preview.
- Chromium 151 passed reader navigation, controls, and input at 1280 × 800,
  320 × 568 and 844 × 390. A fresh offline PWA install opened the new
  fraction article, its linked definition, and a related article, and
  resolved “borrowed” and “fair” in the standalone Dictionary. A corrupted
  update preserved the previous snapshot and bookmark before verified retry.
  Home routing for all 55 activities and Android wrapper source checks passed.
- Chromium 151 with a 390 × 844 touch viewport and 4× CPU throttling took
  approximately 195 ms for the first article query and 76 ms for the first
  word query, including index requests from a local fixture. On 60 subsequent
  searches, p95 was 15.3 ms and maximum was 23.9 ms. This is a controlled
  laptop benchmark. Physical low-end Android testing remains open.

Check [ProjectStatus](https://github.com/to-shreds/ProjectStatus/blob/main/projects/arcade/STATUS.md)
for production deployment, downloads and the next approved target.
