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

Run recipes use `logan.operationGiggle.director.v2` in localStorage, falling
back to sessionStorage or memory if storage is unavailable. This stores
replay history rather than an in-progress save. Reload starts a fresh story;
Back within a run restores the previous decision and its exact state. The
content is finite, so recipes reduce repeats without promising unique scenes
forever.

Effective story text overrides live in `READING_LEVEL_TEXT`, title overrides
in `READING_LEVEL_TITLES`, and label overrides in
`READING_LEVEL_CHOICE_LABELS`. Update an effective override when it exists.
The diagnostic APIs are `__LOGAN_ADVENTURE__` and `__LOGAN_CYOA_DEBUG__`.

The import review fixed state/content mismatches for ribbon and button choices,
missing moon and kitchen referents, prior-answer callbacks, shoe recovery,
acorn loan outcomes, hiding options, and a cover too small for the portrait.
The story graph and deterministic recipe/Back behavior are unchanged.

Verification commands from the Arcade repository root:

```sh
node --test adventure/story.test.mjs
node adventure/browser.test.mjs
```

The browser check covers portrait, landscape, desktop, text preservation,
measured fit, choices, exact Back, Restart, and narration lifecycle using the
same browser runtime as the other Arcade tests. Physical device voices still
depend on the device/browser; gameplay works without speech synthesis.
