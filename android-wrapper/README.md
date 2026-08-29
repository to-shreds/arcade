# Arcade Wrapper Source

This project builds the content-agnostic Android Arcade player and manager. Individual games are not bundled into the APK.

The application ID is `com.familyarcade.platform`, so this platform can be installed alongside the legacy `com.familyarcade.app` wrapper while it is being verified.

Open the project in Android Studio and build the `release` variant, or run `build-local.sh` with JDK 17 or newer, Android SDK platform 35, and Android build-tools 35.0.0 installed.

Private signing keys and passwords are intentionally excluded from this public repository. To create a signed release, set `ARCADE_KEYSTORE_PATH` and `ARCADE_KEYSTORE_PASSWORD` in your local environment. You may also set `ARCADE_KEY_ALIAS` and `ARCADE_KEY_PASSWORD`; the alias defaults to `arcade`, and the key password defaults to the keystore password. Never commit the signing key or its credentials.

Normal game, metadata, icon, audio, HTML, CSS, and JavaScript changes belong in the external `Arcade` folder and never require this project to be rebuilt.

Version 2.1.0 adds a native, offline text-to-speech bridge for arcade games while preserving the external-folder recovery and WebView hardening introduced in version 2.0.1. A deleted, recreated, revoked, or temporarily unavailable Arcade folder returns to a native recovery screen instead of crashing. WebView renderer loss is recovered without clearing web storage, stale WebViews are fully torn down, and catalog reads are cached for each load to avoid repeated Storage Access Framework queries.

For routine content updates, overwrite the contents of the selected external `Arcade` folder while keeping that folder itself in place. If a file manager replaces the folder object, the app will ask you to select the new `Arcade` folder once. Neither workflow requires uninstalling the APK.
