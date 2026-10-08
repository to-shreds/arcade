# Arcade 2.6.1 Adventure checks

Benchmark: 2026-10-08. Baseline: published Arcade 2.6.0 at
`77f06e5d859931c469eff26640f7442f17453304`.

## Resulting behavior

Every Adventure scene now uses concise household prose and deadpan dialogue.
Across the same 64 deterministic recipe states, rendered scenes average 75.5
words, compared with 105.3 before (28.3% less text). Every reading page contains
at most 70 words and can split earlier to fit its viewport. The 124-scene graph,
30 decisions per run, eight endings, conditions, and inventory/state effects
match the baseline. Existing choice consequences and two rotating side detours
remain; random padding no longer makes scenes longer.

Versioned progress captures the exact recipe, scene, inventory/state, full Back
history, and reading word anchor. The game saves after choices/page changes,
Back, and lifecycle exits. Continue/New Adventure works both in the Arcade and
standalone. Restart protects an unfinished run. The ArcadeSave adapter supports
the shell Continue flow, while a guarded local mirror permits standalone saves.
The page verifies actual browser persistence before displaying Saved.

## Verification

- **11 source checks passed.** Includes an exact branch/condition/effect
  fingerprint against the original graph; 5,000 complete deterministic routes
  visiting every scene and ending; conditional ribbon/button/answer/shoe
  consequences; 240 validated save round trips at depths 0, 1, 8, 17, and 30
  across 48 recipes; corrupt/version/forged-state/history/prototype rejection;
  word-preserving 70-word pagination.
- **Four complete browser routes passed:** 1440x900, 390x844, 320x568, and
  844x390. Every text page fit, every word remained, choices waited for the last
  page, Back and replay preserved state, and each route took 30 decisions.
- **Ten independent save browser checks passed.** Real reloads preserved exact
  scene text, recipe, acquired inventory, current page, and Back history;
  resize/reload preserved word position; Continue/New/Restart cancellation
  protected saves; JSON adapter round trips and actual IndexedDB-only recovery
  worked; a pending Continue prompt could not overwrite progress; completed
  endings resumed and went Back; bad saves were rejected; denied storage never
  falsely showed Saved; Home saved and stopped narration.
- **13 family integration records passed.** Existing TV password/vault,
  fullscreen/autoplay fallbacks, real WebM automatic episode advances, key
  isolation, and no Nearby requests still passed. Adventure Home/reopen/Continue
  and browser Back preserved the shell.
- **Actual offline PWA passed.** The complete refreshed snapshot loaded all 45
  tiles without Internet, launched Adventure, advanced a choice, and returned
  Home without JavaScript errors.
- Native keyboard, persistent-shell navigation, Android wrapper source, and
  offline hash/runtime audits passed. The current snapshot is
  `2.6.1+20261008.1`, 356 files and 18,161,617 bytes.

The baseline full GitHub CI also passed both web and Nearby jobs
([run 37735074617](https://github.com/to-shreds/arcade/actions/runs/37735074617)).
Exact new publication/CI results and downloadable artifact identity belong in
ProjectStatus, rather than assuming a deployment from this file.

## Reproducible checks

```sh
node --test adventure/story.test.mjs adventure/save.test.mjs
node adventure/browser.test.mjs
node adventure/save.browser.test.mjs
node tools/test-family-activities.mjs
node tools/test-family-activities.mjs --offline-only
node tools/test-native-keyboard.mjs
node tools/test-shell-navigation.mjs
node tools/test-android-wrapper.mjs
node tools/test-offline-runtime.mjs
```

Evidence is generated under `test-results/adventure`, `adventure-save`, and
`family-activities`. No physical Android/iOS voice test or real TorBox account
playback is claimed. Saves are local to the browser/device and may be removed
when browser data is cleared. Existing APKs and TorBox backend are unchanged.
