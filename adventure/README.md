# Logan and Jenkins: Operation Giggle

The canonical maintained game is now `to-shreds/arcade/adventure/index.html`.
The `Misc/AdventureGame` copy is the import source and is no longer required
for development or gameplay. Make subsequent story and engine fixes here.

Imported from `to-shreds/Misc` default branch `main`, path
`AdventureGame/Logan_and_Jenkins_Operation_Giggle.html`, on 2026-10-08.
Source blob: `5f76ab431d5cb3211d39f3728ba95bfae6367679`.
Source SHA-256: `4ba4942761c1cc88ea615a0de16a19fd0b21adbc7ba79fa7f261e41da42fe027`.

This is a single-player, offline choose-your-own-adventure for a reader around
age 7 or 8. Logan and the friendly monster Jenkins make a secret gift for
Scarlett. Mom and Dad help without taking over Logan's choices. The four gift
branches lead through 124 scenes, two recipe-selected side adventures,
30 story decisions, and eight happy endings.

The small Home, Back, Restart, and Read controls leave most of the viewport for
text. Measured pagination keeps each text page inside the available space;
choices unlock on the final page. Left/right changes pages, 1-4 selects a
choice, and Escape stops narration. Narration uses the browser's own voices
and remains optional. Leaving Arcade, hiding the tab, or receiving a shell
pause cancels it.

`index.html` contains the full game, styling, and text, with no remote assets
or libraries. It also opens directly as a downloaded file. The Home control
returns to the Arcade shell when embedded and to `../index.html` when opened
from its directory. The game has no account, API key, online mode, or shared
control transport.

## Current writing and progress saves

Release 2.6.1 rewrites every scene with shorter sentences, household problems,
and deadpan family dialogue. The four gift paths, 124 scenes, 30 decisions per
complete run, and eight endings are preserved. Earlier supplies, answers,
helpers, and repairs still affect later scenes. Random prose padding and the
old blanket word-substitution pass are no longer part of displayed text.
Canonical current prose and label mappings live in `GROUNDED_A`, `GROUNDED_B`,
and `GROUNDED_STORY` inside the same HTML file. Edit those effective definitions.

Reading pages contain at most 70 words. The pager also measures available
space and splits shorter on small screens, keeping paragraph or sentence
boundaries when possible. Every word remains available, and choices stay
locked until the final page of a scene. Reading position uses a word anchor
so changing the screen size does not lose your place.

Progress saves automatically after choices, page changes, Back, and leaving
or hiding the game. A small Save button and status show whether persistence
worked. Reopening offers Continue or New Adventure; replacing an unfinished
run requires confirmation. The save contains the exact director recipe,
scene, state/inventory, full Back history, and reading anchor. Continue does
not reserve a fresh recipe. The versioned snapshot is validated by replaying
its choices and comparing every history/state snapshot; invalid, corrupt,
oversized, or incompatible saves cannot silently become a different story.

The standalone local mirror uses `logan.operationGiggle.progress.v1` in
localStorage. When served inside Arcade, the registered `adventure` adapter
also participates in ArcadeSave and the shell's Continue flow. Actual storage
writes are checked before the page says Saved. If storage is blocked, the
page says Cannot save here and remains playable for that session. This is
browser/device-local progress, not an account or cloud-sync feature.

Run recipes still use `logan.operationGiggle.director.v2`, falling back to
sessionStorage or memory. That record tracks replay variety independently
of progress saves. Story version is `household-2026-10-08-v1`; future changes
that invalidate saved state need an explicit compatible migration or a new
version with a clear refusal to load old snapshots.

The diagnostic APIs remain `__LOGAN_ADVENTURE__` and `__LOGAN_CYOA_DEBUG__`.

The import review fixed state/content mismatches for ribbon and button choices,
missing moon and kitchen referents, prior-answer callbacks, shoe recovery,
acorn loan outcomes, hiding options, and a cover too small for the portrait.
The story graph and deterministic recipe/Back behavior are unchanged.

Verification commands from the Arcade repository root:

```sh
node --test adventure/story.test.mjs adventure/save.test.mjs
node adventure/browser.test.mjs
node adventure/save.browser.test.mjs
```

The browser checks cover portrait, landscape, desktop, real progress reload,
Continue/New/Restart, corrupt and blocked storage, shared save recovery,
word anchors across resizing, text preservation,
measured fit, choices, exact Back, Restart, and narration lifecycle using the
same browser runtime as the other Arcade tests. Physical device voices still
depend on the device/browser; gameplay works without speech synthesis.
