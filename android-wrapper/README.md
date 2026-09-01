# Arcade Android Wrapper

Version 2.4.0 is the remote-first Android player for the Arcade at:

`https://to-shreds.github.io/arcade/`

Normal HTML, CSS, JavaScript, metadata, image, and audio updates are published through the repository and GitHub Pages. They do not require an APK rebuild or reinstall.

## Online and offline behavior

The wrapper verifies actual access to the hosted `offline-manifest.json` instead of trusting Android's network-connected flag. When that manifest is reachable and valid, the app opens the hosted Arcade. The page keeps the GitHub Pages origin in both online and offline operation, so local storage, autosaves, preferences, and statistics continue to use the same origin.

At the same time, the wrapper updates a private app-managed archive under Android internal storage:

1. It validates the manifest schema, paths, file counts, byte sizes, and SHA-256 hashes.
2. It reuses unchanged files from the current validated archive.
3. It downloads changed files into a unique staging directory with connection and read timeouts.
4. It verifies every staged file before activation.
5. It promotes the complete staged directory atomically while preserving the prior complete archive as a rollback copy.

If the manifest probe fails, a page cannot finish rendering within ten seconds, GitHub Pages returns a main-page error, or an online load otherwise fails, the wrapper serves the last validated archive at the same GitHub Pages URLs. A partial or corrupt update is discarded and never replaces the last working copy. The older user-selected folder workflow remains available as a secondary editing and recovery option.

Android 7.0 and newer also route service-worker requests through the native offline responder. Android 6.0 uses normal WebView request interception because its public service-worker client API is unavailable.

The site service worker independently maintains an integrity-checked browser snapshot. It stages each release into a unique cache, changes the active marker only after the entire snapshot validates, keeps one prior rollback snapshot, and serves the active snapshot cache-first. The web Arcade reports preparation progress and only labels the browser Offline Ready after the complete manifest has validated.

The persistent web shell remains loaded while games open in its same-origin game viewport. Normal game launches therefore do not replace the WebView document or disconnect a Nearby Arcade session. The shell asks the native wrapper only to apply a game's orientation preference. Android Back and game Home requests are delegated to the shell first, with direct-game pages retaining the older safe return-to-index fallback.

If the hosted shell or an embedded game document cannot load, the wrapper may reopen the validated app-managed archive. Ordinary missing images, audio, scripts, or other subresources do not tear down an otherwise healthy WebView.

While a Nearby Arcade session is active, the wrapper cancels and pauses native
manifest and archive network work so the local session does not create Internet
traffic. Archive refresh resumes safely after Nearby disconnects.

`ArcadeNative.hasOfflineArchive()` reports ready only when the current WebView
is actually bound to a validated archive from the exact current generation. A
remote-bound page must instead finish the browser service worker's verified
Offline Ready flow; an unrelated native archive cannot make that page claim it
is prepared.

Live QR scanning uses the standard browser camera API. The wrapper grants camera or microphone access only to the trusted GitHub Pages and `arcade.local` origins, after the corresponding Android runtime permission is approved. QR image/file import remains available when a device has no usable camera.

## Offline manifest

Generate the release manifest only after all hosted source and assets are final:

```bash
node tools/generate-offline-manifest.mjs --version 2.4.0+20260901.N
```

The generator reads enabled entries from `catalog.json`, requires each game folder to be a direct child of the repository root, recursively includes its runtime files and the shared `multiplayer/` runtime, and records the exact byte length and SHA-256 hash of every file. It also includes the PWA manifest and install icons. Increment the manifest release ID whenever hosted content changes. Commit `offline-manifest.json` with the exact files it describes. Run `node tools/test-offline-runtime.mjs` after generation to verify every byte/hash, PWA asset, static local import, and the Nearby no-network guard.

## Building

The application ID is `com.familyarcade.platform`. The project targets Android SDK 35 and supports Android 6.0 (API 23) and newer.

Open the project in Android Studio and build the `release` variant, or use `build-local.sh` with:

- JDK 17 or newer
- Android SDK platform 35
- Android build-tools 35.0.0
- The private Arcade release signing keystore

Private signing keys and passwords must stay outside this public repository. Configure them locally:

```bash
export ARCADE_KEYSTORE_PATH=/private/path/arcade-release.jks
export ARCADE_KEYSTORE_PASSWORD='...'
export ARCADE_KEY_ALIAS=arcade
export ARCADE_KEY_PASSWORD='...'
./build-local.sh
```

`ARCADE_KEY_ALIAS` defaults to `arcade`, and `ARCADE_KEY_PASSWORD` defaults to the keystore password. As a reusable alternative, place the private files at:

```text
private-signing/arcade-release.p12
private-signing/signing.properties
```

Both the Gradle release build and `build-local.sh` detect that ignored local
directory automatically. A private signing bundle may be unpacked at the
repository root to install those files. Never commit or publish the bundle,
keystore, or properties file.

The local build script signs and verifies a temporary APK first, then atomically publishes the verified result to:

`app/build/outputs/apk/release/Arcade.apk`

Arcade 2.3.0 established the current release signing identity. An installation
signed with an older identity must be uninstalled once before 2.3.0 or later can
be installed. Arcade 2.4.0 preserves that identity and updates 2.3.0 in place.
Keep the private signing bundle safe so later releases continue to update
without another uninstall.

For a repository release, copy that verified APK to the repository's stable `releases/` location using the versioned filename. Do not commit the keystore, passwords, Gradle caches, or transient build directories.

## Release order

1. Finish and test all web and backend changes.
2. Generate and verify `offline-manifest.json` from those final files.
3. Build and verify the APK from the final Android source.
4. Copy the verified APK into `releases/`.
5. Commit and push source, manifest, documentation, backend source, and APK together.
6. Verify the pushed commit, GitHub Pages deployment, manifest, and downloadable APK.
