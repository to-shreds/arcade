# Family Arcade

The production arcade is served from this repository at
[to-shreds.github.io/arcade](https://to-shreds.github.io/arcade/).

GitHub is the content source of truth. Each game lives in a self-contained
folder with its entry page, icon, and `game.json` metadata. `catalog.json`
powers the central menu, and the generated offline manifest describes the
complete web release.

## Repository layout

- `index.html`, `catalog.json`, and shared `arcade-*` files: web arcade shell
- game folders: self-contained games and activities
- `android-wrapper/`: Android wrapper source and reproducible build helper
- `cloudflare/chess-worker/`: Arcade multiplayer Worker and Durable Object source
- `tools/`: release and offline-manifest utilities
- `releases/`: intentionally retained, installable release APKs
- `licenses/`: project and third-party notices
- `CHANGELOG.md`: release history and user-visible changes

## Online and offline operation

The Android app ordinarily opens the GitHub Pages production site, so web
game updates do not require a new APK. It also stages and validates a complete
app-managed snapshot of the site. Only a fully downloaded, hash-verified
snapshot becomes the last-known-good offline copy. If Pages is unreachable,
the connection is captive, or an update fails partway through, the wrapper
falls back to the previous complete snapshot while preserving WebView storage,
game saves, preferences, and statistics.

The generated manifest must be refreshed whenever deployable web content
changes:

```sh
node tools/generate-offline-manifest.mjs --version 2.3.0+20260901.6
```

## Building Android

See `android-wrapper/README.md`. Private signing keys and passwords are never
stored in this public repository. The retained APK in `releases/` is built
from the same source revision as the release commit.

## Online multiplayer

The browser contains no Cloudflare credential. It connects only to the public
Worker endpoint. The Worker keeps Chess authoritative and provides reusable,
versioned rooms, presence, reconnection, seat ownership, and room chat for the
other online games. Backend source, tests, and safe Wrangler configuration live
under `cloudflare/chess-worker/`; deployment credentials remain in Cloudflare
or the operator's environment.
