# Arcade 2.6.0 verification

The change imports and repairs Operation Giggle as the solo Logan and Jenkins
activity, and adds a solo preset-only TV client. The prior 43 entries retain
their online modes, room rules, assets, saves, and notifications. The catalog
now contains 45 enabled entries; Backyard Baseball remains disabled.

## Adventure review

The import is from the canonical `Misc/AdventureGame` main-branch HTML blob
`5f76ab431d5cb3211d39f3728ba95bfae6367679`. Arcade now owns the maintained
source in `adventure/index.html`; the old folder is an historical import.

Three review passes covered story/state continuity, engine structure and
replay, and browser/mobile lifecycle. Surgical fixes correct ribbon/button
inventory, missing scene referents, callbacks to unchosen events, shoe and
acorn outcomes, hiding/cover details, and the opening introduction order.
The graph remains 124 scenes, eight positive endings, and 30 decisions per
complete route.

Seven source tests passed, including 5,000 deterministic complete routes that
cover every scene and ending. Browser checks passed full routes at 1440x900,
390x844, 320x568, and 844x390. Text pages fit without page scrolling and preserve
words. Final-page choice gating, exact Back/replay, Restart, multi-page speech,
pause/hide/resize/exit cancellation, direct offline opening, unavailable speech,
and blocked storage were checked. Independent shell checks confirmed Home and
browser Back keep the same shell instance and stop pending narration.

## TV

The preset catalog contains 183 verified IMDb identities: four original shows
and 179 movies. It covers the complete released WDAS/Pixar feature catalogs,
broad Disney animated sequels/features/TV movies, Jumanji (1995), and all four
Night at the Museum films. `tv/catalog.mjs` records scope, cutoff, and official
catalog sources. The UI is alphabetized and has no search.

Twelve client tests passed for identity protection, released episode order,
next-season transitions, trusted media URLs, explicit uncached preparation,
key/session separation, late login revocation, cancellation, alternate cached
sources, exact file selection, and bounded preparation. Independent Chromium integration passed at desktop, mobile shell, narrow
portrait with fullscreen denied, short landscape with autoplay denied, and
blocked local/session storage. A real generated VP9 WebM played and naturally
ended; the UI advanced S1E1 to S1E2 to S2E1 using the same video element.
Fullscreen intent/fallback, tap-to-play, title ordering, metadata cancellation,
media removal, Home/shell preservation, and late login revocation passed.
Vault checks verified ciphertext, non-extractable key/export refusal,
Remember/reconnect, Forget, and absence of plaintext keys in ordinary storage
or Arcade save state. Local/Nearby mode made zero backend requests, including
Forget with an existing session. These are deterministic browser fixtures,
not live TorBox playback.

Key persistence is TV-specific encrypted IndexedDB with a non-extractable
AES-GCM device key. The shared TorBox backend holds the active API key in
process memory. Tokens/keys/media URLs are excluded from Arcade saves and rooms.
The encrypted browser vault does not defend against same-origin malicious
JavaScript or use of an unlocked browser. TorBox owner CDN links can carry
account credentials, matching the existing full player.

Live keyless probes confirmed the current TorBox backend responds at /healthz
(version 1.1.0) and allows the production GitHub Pages origin. It rejects
localhost and the native local-archive origin. Those copies show the hosted
Arcade link. No backend allowlist or service was changed. TV needs Internet;
Nearby public-network isolation is retained. No TorBox API key was provided,
so no real account, title availability, video/audio codec, or stream playback
verification is claimed. Three supplementary movie years differ in Cinemeta,
which can affect strict source matching: Cinderella II, House of Villains,
and Springtime with Roo. The official display years and exact identities are
retained. This does not change the full TorBox player.

## Existing behavior and packaging

All 187 Worker tests and 109 transport/client tests passed. The existing local
UI browser suite passed keyboard/cursor/emoji saves, Bowling/Time/Blackjack,
Make 10, Maze, Simon, Checkers, Mini Golf, and short-landscape controls/boards.
The shell suite passed catalog/filter/Back/Forward/settings/session checks
at four viewport sizes, plus a full offline snapshot, offline reload, all 45
tiles, Paint and Home. Static Home routing, native keyboard and Android wrapper
source checks passed. Offline file sizes/hashes and atomic snapshot behavior
passed. The retained APKs were not rebuilt; no physical Android/iOS testing is
claimed. Real Nearby RTC and the full prior paired-flow matrix remain the
verified 2.5.0 baseline; this release does not change their implementation.

Reproduce with `npm run test:family`, `node tools/test-shell-navigation.mjs`,
`node tools/test-native-keyboard.mjs`, `node tools/test-android-wrapper.mjs`,
`node tools/test-offline-runtime.mjs`, `node tools/test-shell-browser.mjs`,
`node tools/test-local-ui-browser.mjs`, `node --test multiplayer/test/*.test.mjs`,
and `npm test` in `cloudflare/chess-worker`. Browser dependencies must be
installed; browser artifacts are retained by CI.

The final offline release contains 356 files and 18,057,228 bytes, with all
lengths and SHA-256 hashes verified. The downloadable archive is generated from
this manifest and independently rechecks each packaged file.
