# Arcade 2.14.3 reference verification

This release adds 135 original articles, 863 unique dictionary headwords and
405 curated questions. The approved catalog contains **1,359 articles in
42 subjects**, **3,031 headwords**, **4,681 senses**, **4,079 follow-up links**
and 13 quizzes. Together with 2.14.2, the expansion adds 353 articles,
2,251 headwords and 1,060 links to 2.14.1.

| Article batch | Articles | Follow-up links | New technical headwords |
| --- | ---: | ---: | ---: |
| Structures and sounds | 42 | 126 | 18 |
| Languages, libraries and museums | 50 | 150 | 8 |
| Wildlife near home | 43 | 129 | 18 |

The three additional everyday vocabulary batches contain 819 headwords.
Every batch received a separate editorial read and targeted source checks
for major and unfamiliar claims. The 1,487-record register keeps provenance
outside the reader packs. All new context flags were reread in context.
There are zero pending drafts, missing marked terms, broken question
destinations, ambiguous forms or length warnings.

## Verified packaging and reading

- Clean rebuild, five lexical tests and the exhaustive corpus audit passed,
  including 3,957 search aliases and all approved definitions and question
  destinations. Selected real searches cover a library call number, organ
  pipes, eastern gray squirrels, and the new past-of-grind meaning of “ground.”
- The manifest `2.14.3+20261127.1` verified 541 files and 29,180,891 bytes.
  The shared reference assets take 4,246,939 bytes, including an
  1,122,700-byte article index and an 809,694-byte word index.
- Chromium 151 passed all three reference viewports, 11 catalog scenarios,
  fresh offline install and corrupted update recovery. The offline reader
  found the new call-number article and opened its inline definition with
  networking cut. App Home routing passed for all 55 activities and the
  existing Android wrapper source checks passed.
- At 390 × 844 with 4× CPU throttling in Chromium, cold article and word
  queries took about 156 ms and 103 ms including local index fetching.
  The 60 subsequent samples had a 24.9 ms p95 and a 60.8 ms maximum.
  These are controlled browser measurements. Physical low-end Android
  and Windows acceptance checks remain open.

See [ProjectStatus](https://github.com/to-shreds/ProjectStatus/blob/main/projects/arcade/STATUS.md)
for production deployment, exact downloads and continuation.
