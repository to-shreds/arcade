# Arcade 2.14.1 Encyclopedia verification

The approved edition has **1,006 articles in 41 subjects**, **780 headwords**,
**917 senses**, **3,019 related questions**, 13 quizzes, and 1,063 editorial
source records. It adds 879 original articles to the 127-article preview,
including 106 country profiles, named wildlife and fossils, space travel,
engineering, modern and ancient history, visual arts, music, literature,
nutrition, computing, and science. The full country collection has 116 profiles.

A separate reviewer from each writer read the content and terminology, checked
representative claims against the provenance, and requested factual, reading,
and link refinements. Verified sources are retained in the editable corpus,
with adult-only provenance separated from the child runtime files. Writers
and reviewers applied corrections before approval. The corpus includes no
drafts. The audit found zero missing marked terms, duplicate headwords,
dangling linked questions, or article length warnings.

## Verified runtime

- Tested the exact offline manifest `2.14.1+20261127.1`, **528 files** and
  **27,151,057 bytes**. The reference files contribute 2,217,105 bytes.
  A clean pack rebuild reproduced the checked-in data. The article index is
  828,434 bytes and the word index is 190,211 bytes. The largest article shard
  is 103,441 bytes.
- Five lexical unit tests passed. The Node corpus test exercised every approved
  article and word, all 2,870 search aliases, all 3,019 question links, and
  every marked term. The measured alias search p95 was 0.463 ms after index
  loading in local Node v24.22.3. This measures lexical execution in that
  environment. Browser rendering, cold load and physical devices are separate
  measurements.
- Chromium passed at 1280×800, 320×568, and 844×390. Verified mouse, keyboard
  and touch, bookmark and navigation persistence, reading controls, Dictionary
  lookup, and local speech or an Android bridge fixture. After cutting the
  network, the verified PWA loaded old and new Encyclopedia articles,
  opened the new flying buttress definition, retrieved both meanings of
  “character,” and returned Home. The actual corrupted-pack fixture rejected
  incorrect bytes, retained the previous snapshot and bookmark, and installed
  the verified retry.
- Eleven catalog browser scenarios passed, including at four viewport sizes.
  Home routing verified all 55 enabled activities and the existing Android
  wrapper source checks passed.
- The Windows x64 cross-build verified 19 allowed activities and the entire
  reference collection in its embedded snapshot. All 139 portable assertions
  passed. The isolated Chromium child-policy replay passed for 19 activities
  and an inline definition after standalone Dictionary was revoked. The
  real WebView2 workflow is tracked in ProjectStatus, along with the package
  hashes and the remaining physical Windows and Android acceptance checks.

## Continuation

The first article milestone is reached. Continue the first 5,000-headword
milestone and author additional subject clusters from the editorial inventory.
The latest deployment and the exact artifact identities are in
[ProjectStatus](https://github.com/to-shreds/ProjectStatus/blob/main/projects/arcade/STATUS.md).
