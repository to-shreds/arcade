# TV

Arcade owns this small TorBox activity. It has a preset alphabetized Shows/Movies list, season and episode selectors, native video controls, and automatic next episode. There is no search interface, multiplayer transport, shared room, save adapter, or source table.

Play immediately opens a full-window video surface and requests browser fullscreen during the user's tap. If browser or Android WebView fullscreen is unavailable, the video still fills the available activity window. One persistent video element is retained through source changes and episode transitions. Some browsers require **Tap to play** for initial playback or the next episode; the activity shows that control when autoplay is denied.

## Library

`catalog.mjs` is the maintained preset list. Its source/interpretation record is exported as `CATALOG_SCOPE`. The checked release cutoff is **October 8, 2026**. The current list contains **183 titles**, consisting of four shows and 179 movies:

| Group | Count | Scope |
| --- | ---: | --- |
| Shows | 4 | Elena of Avalor (2016), The Fairly OddParents (2001), The Smurfs (1981), Teenage Mutant Ninja Turtles (1987) |
| Walt Disney Animation Studios | 64 | Complete released studio feature canon through Moana 2 and Zootopia 2 |
| Pixar | 31 | Complete released feature catalog through Hoppers and Toy Story 5 |
| Disney Features | 79 | Disney-branded animated theatrical, direct-to-video, and television feature movies, including DisneyToon sequels and Tinker Bell films |
| Family Movies | 5 | Original Jumanji (1995), the Night at the Museum live-action trilogy, and Night at the Museum: Kahmunrah Rises Again (2022) |

The Disney interpretation excludes standalone short films, episode/sing-along collections, live-action remakes, predominantly live-action hybrids, licensed Studio Ghibli releases, and acquired Fox/Marvel/Lucasfilm back catalogs. The names and years in the list come from the recorded official studio sources; the exact IMDb identities are verified against the existing player's metadata service. Titles are selectable presets, not a guarantee that a playable TorBox copy exists.

Known catalog/provider limits:

- Cinemeta reports earlier production years for Cinderella II (2001 instead of its 2002 release), Mickey's House of Villains (2001 instead of 2002), and Springtime with Roo (2003 instead of 2004). It also uses alternate titles for Bambi II and The Lion King 1½. The preset preserves official names and years. The existing backend's title/source matching safeguards remain authoritative and may reject some versions with inconsistent metadata.
- Fairly OddParents and Smurfs catalog numbering can identify individual cartoon segments rather than combined broadcast episodes. Combined multi-episode files are never guessed as an individual episode. An unavailable segment is reported clearly instead of silently playing the wrong episode.
- The Rolie Polie Olie DVD movies are omitted because their otherwise verified IMDb entries were not accessible through Cinemeta during review.

## Connection and key storage

TV reuses the current TorBox player's existing HTTPS control service at `https://torbox-web-player-key.onrender.com`. Its public APIs provide metadata, title source lookup, verified TorBox cache checks, preparation, and expiring playback tickets. Source providers receive title identity rather than the TorBox credential. TorBox media plays directly in the browser.

The API key is entered through a password field, cleared from the form after submission, and sent in the HTTPS login body. It is never committed, included in a page URL, stored in plain local/session storage, included in an Arcade save/export, or shared with a game room. A separate opaque session token uses the `arcade-tv.session.v1` session-storage namespace. If storage is unavailable, the current visit can still connect in memory.

Optional **Remember encrypted on this device** stores an AES-GCM ciphertext and a non-extractable Web Crypto key in the separate `arcade-tv-key-vault` IndexedDB database. Remember is off by default. This protects against copying plaintext out of ordinary browser storage; it does not protect against malicious code running in the same browser origin or someone who controls the unlocked device. No browser encryption should be described as making an embedded account secret inaccessible to that browser.

As in the current full player, the existing service holds the key temporarily in process session memory. This is browser-only *persistent* storage, not a promise that the key never leaves the browser. TorBox may also embed the account key in an owner CDN URL visible to the owner's browser network stack. The activity does not persist or export playback URLs. Disconnect clears the session token and serialized vault records and requests backend session revocation. When network access is blocked, it only clears the local state; any existing backend session expires independently.

The existing backend currently allows the deployed GitHub Pages origin, `https://to-shreds.github.io`. TV runs at the online Arcade. A downloaded/local copy provides an **Open TV in the online Arcade** link instead of trying a forbidden API origin. The Android online mode already uses that hosted origin. TV requires internet and is unavailable while Nearby/offline network isolation is active. The static interface can be included in the offline snapshot, but video is not downloaded for offline viewing. Forget remains available without making external requests.

## Playback and recovery

Automatic Play and auto-next use only cached, browser-compatible source candidates. Cache preparation checks are bounded to 22 seconds overall and at most eight candidates. Failed media can try at most two alternative ready copies. Unknown availability never silently starts an uncached download.

When the preset has an eligible uncached browser-friendly source, **Prepare & play** is an explicit action. It asks TorBox to add that source and checks its status for up to five minutes. It is shown only after automatic cached playback cannot open a copy. Canceling or going Back stops polling and playback requests; an already accepted account preparation may continue in TorBox.

Next episode follows released metadata in season/episode order, including season boundaries. Specials can be selected separately and do not interrupt the regular series order. Movies stop when they finish; the activity does not automatically play a different movie. Auto-next never prepares an uncached episode without a tap. If the backend session expires, TV asks to connect again. Reopening/reloading TV reconnects a remembered encrypted key.

Newer actions invalidate older metadata, playback, source preparation, and login completions. Late sign-in responses are revoked when the page remains alive. Disconnect cancels active work, removes media, clears form values, and prevents an older operation from restoring authentication or a remembered key. Home uses Arcade's existing shell bridge, and pagehide removes the media source.

## Verification

Run the meaningful client logic tests with:

```sh
node --test tv/core.test.mjs
```

The suite checks exact preset identities, season-boundary next episodes, future/special/duplicate episode filtering, cached-only source ordering, supported-file matching, combined-file ambiguity, bounded file selection, trusted media addresses, opaque browser session state, cancellation, and late login completion after sign-out.

Run the independent UI/media integration suite with:

```sh
node tools/test-family-activities.mjs
```

The integration fixtures use the actual browser UI and a local synthetic video behind intercepted HTTPS API/media routes. They exercise the client and shell without a real TorBox credential. These fixtures cannot establish live title availability, real TorBox CDN playback, or physical-device fullscreen behavior. No live key was supplied for this implementation. The existing backend's deployed version and deployment constraints are tracked in the canonical TorBox project's handoff; this activity does not deploy or alter that service.

Official TorBox API contract reviewed for this integration: [Main API](https://api-docs.torbox.app/) and [Swagger UI](https://api.torbox.app/docs). The service's existing cached-only creation and token-based download-link behavior agree with those public API contracts. TV calls the existing private control service rather than reviving the full player's previously abandoned direct-browser source rewrite.
